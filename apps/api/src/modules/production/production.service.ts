import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../common/database.service';

type ListInput = { cppCode?: string; serviceDate?: string; status?: string };
type StartInput = { responsibleUserCode?: string; scheduledStartAt?: string };
type CompleteInput = {
  actualQuantity: number;
  wasteQuantity?: number;
  wasteReasonCode?: string;
  notes?: string;
  expiresAt?: string;
};

@Injectable()
export class ProductionService {
  constructor(private readonly db: DatabaseService) {}

  private async nextCode(client: PoolClient, sequenceCode: string): Promise<string> {
    const result = await client.query<{ current_value: string; prefix: string; padding: number }>(
      `UPDATE core.business_sequences
       SET current_value=current_value+1,updated_at=NOW()
       WHERE sequence_code=$1
       RETURNING current_value,prefix,padding`,
      [sequenceCode],
    );
    const row = result.rows[0];
    if (!row) throw new Error(`${sequenceCode} sequence missing`);
    return `${row.prefix}${String(row.current_value).padStart(row.padding, '0')}`;
  }

  async releaseMasterOrder(ompCode: string) {
    return this.db.transaction(async (client) => {
      const masterResult = await client.query<{
        id: string;
        cpp_id: string;
        service_date: string;
        status_code: string;
      }>(
        `SELECT id,cpp_id,service_date,status_code
         FROM planning.master_production_orders
         WHERE omp_code=$1 FOR UPDATE`,
        [ompCode],
      );
      const master = masterResult.rows[0];
      if (!master) throw new NotFoundException('MASTER_PRODUCTION_ORDER_NOT_FOUND');
      if (master.status_code !== 'APPROVED') {
        throw new ConflictException('MASTER_PRODUCTION_ORDER_NOT_RELEASABLE');
      }

      const alerts = await client.query<{ count: number }>(
        `SELECT COUNT(*)::int count FROM planning.planning_alerts
         WHERE master_order_id=$1 AND status_code='OPEN' AND severity_code IN ('HIGH','CRITICAL')`,
        [master.id],
      );
      if (Number(alerts.rows[0]?.count ?? 0) > 0) {
        throw new UnprocessableEntityException('MASTER_ORDER_HAS_BLOCKING_ALERTS');
      }

      const lines = await client.query<{
        id: string;
        dish_id: string;
        recipe_version_id: string;
        dish_code: string;
        dish_name_snapshot: string;
        presentation_snapshot: string;
        production_required_quantity: number;
      }>(
        `SELECT id,dish_id,recipe_version_id,dish_code,dish_name_snapshot,
                presentation_snapshot,production_required_quantity
         FROM planning.production_demand_lines
         WHERE master_order_id=$1 AND production_required_quantity > 0
         ORDER BY dish_name_snapshot,presentation_snapshot
         FOR UPDATE`,
        [master.id],
      );
      if (!lines.rows.length) throw new UnprocessableEntityException('MASTER_ORDER_HAS_NO_PRODUCTION_LINES');

      for (const line of lines.rows) {
        const code = await this.nextCode(client, 'PRODUCTION_ORDER');
        await client.query(
          `INSERT INTO production.production_orders(
             id,production_order_code,master_order_id,demand_line_id,cpp_id,service_date,
             dish_id,recipe_version_id,dish_code,dish_name_snapshot,presentation_snapshot,
             planned_quantity,status_code)
           VALUES($1,$2,$3,$4,$5,$6::date,$7,$8,$9,$10,$11,$12,'READY')`,
          [
            randomUUID(), code, master.id, line.id, master.cpp_id, master.service_date,
            line.dish_id, line.recipe_version_id, line.dish_code, line.dish_name_snapshot,
            line.presentation_snapshot, Number(line.production_required_quantity),
          ],
        );
        await client.query(
          `UPDATE planning.production_demand_lines SET status_code='RELEASED' WHERE id=$1`,
          [line.id],
        );
      }

      await client.query(
        `UPDATE planning.master_production_orders
         SET status_code='RELEASED',updated_at=NOW(),version=version+1
         WHERE id=$1`,
        [master.id],
      );
      await this.auditAndEvent(client, {
        action: 'MASTER_PRODUCTION_ORDER_RELEASED',
        eventType: 'production.master_order_released',
        entityType: 'MASTER_PRODUCTION_ORDER',
        entityId: master.id,
        businessCode: ompCode,
        payload: { ompCode, productionOrderCount: lines.rows.length },
      });

      return this.listWithClient(client, { masterOrderId: master.id });
    });
  }

  async listOrders(input: ListInput) {
    if (input.serviceDate && !/^\d{4}-\d{2}-\d{2}$/.test(input.serviceDate)) {
      throw new BadRequestException('INVALID_SERVICE_DATE');
    }
    return this.db.transaction((client) => this.listWithClient(client, input));
  }

  private async listWithClient(
    client: PoolClient,
    input: ListInput & { masterOrderId?: string },
  ) {
    const params: unknown[] = [];
    const filters: string[] = [];
    const add = (sql: string, value: unknown) => {
      params.push(value);
      filters.push(sql.replace('?', `$${params.length}`));
    };
    if (input.masterOrderId) add('po.master_order_id=?', input.masterOrderId);
    if (input.cppCode) add('c.cpp_code=?', input.cppCode);
    if (input.serviceDate) add('po.service_date=?::date', input.serviceDate);
    if (input.status) add('po.status_code=?', input.status);

    const result = await client.query(
      `SELECT po.production_order_code,po.service_date,po.dish_code,po.dish_name_snapshot,
              po.presentation_snapshot,po.planned_quantity,po.actual_quantity,po.waste_quantity,
              po.status_code,po.scheduled_start_at,po.started_at,po.completed_at,po.notes,
              c.cpp_code,m.omp_code,pl.lot_code,pl.status_code lot_status
       FROM production.production_orders po
       JOIN operations.cpp c ON c.id=po.cpp_id
       JOIN planning.master_production_orders m ON m.id=po.master_order_id
       LEFT JOIN production.production_lots pl ON pl.production_order_id=po.id
       ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}
       ORDER BY po.service_date,po.dish_name_snapshot,po.presentation_snapshot`,
      params,
    );
    return {
      success: true,
      data: result.rows.map((row: any) => ({
        productionOrderCode: row.production_order_code,
        masterOrderCode: row.omp_code,
        cppCode: row.cpp_code,
        serviceDate: row.service_date,
        dishCode: row.dish_code,
        dishName: row.dish_name_snapshot,
        presentation: row.presentation_snapshot,
        plannedQuantity: Number(row.planned_quantity),
        actualQuantity: row.actual_quantity === null ? null : Number(row.actual_quantity),
        wasteQuantity: Number(row.waste_quantity),
        status: row.status_code,
        scheduledStartAt: row.scheduled_start_at,
        startedAt: row.started_at,
        completedAt: row.completed_at,
        notes: row.notes,
        lotCode: row.lot_code,
        lotStatus: row.lot_status,
      })),
      meta: { timestamp: new Date().toISOString() },
    };
  }

  async getOrder(productionOrderCode: string) {
    return this.db.transaction((client) => this.getOrderWithClient(client, productionOrderCode));
  }

  async startOrder(productionOrderCode: string, input: StartInput) {
    return this.db.transaction(async (client) => {
      const order = await client.query<{ id: string; status_code: string; master_order_id: string }>(
        `SELECT id,status_code,master_order_id FROM production.production_orders
         WHERE production_order_code=$1 FOR UPDATE`,
        [productionOrderCode],
      );
      const row = order.rows[0];
      if (!row) throw new NotFoundException('PRODUCTION_ORDER_NOT_FOUND');
      if (row.status_code !== 'READY') throw new ConflictException('PRODUCTION_ORDER_NOT_STARTABLE');

      let responsibleUserId: string | null = null;
      if (input.responsibleUserCode) {
        const user = await client.query<{ id: string }>(
          `SELECT id FROM core.internal_users WHERE user_code=$1 AND is_active=TRUE`,
          [input.responsibleUserCode],
        );
        if (!user.rows[0]) throw new NotFoundException('RESPONSIBLE_USER_NOT_FOUND');
        responsibleUserId = user.rows[0].id;
      }
      if (input.scheduledStartAt && !Number.isFinite(new Date(input.scheduledStartAt).getTime())) {
        throw new BadRequestException('INVALID_SCHEDULED_START');
      }

      await client.query(
        `UPDATE production.production_orders
         SET status_code='IN_PROGRESS',responsible_user_id=$2,
             scheduled_start_at=COALESCE($3::timestamptz,scheduled_start_at),
             started_at=NOW(),updated_at=NOW(),version=version+1
         WHERE id=$1`,
        [row.id, responsibleUserId, input.scheduledStartAt ?? null],
      );
      await client.query(
        `UPDATE planning.master_production_orders
         SET status_code='IN_PROGRESS',updated_at=NOW(),version=version+1
         WHERE id=$1 AND status_code='RELEASED'`,
        [row.master_order_id],
      );
      await this.auditAndEvent(client, {
        action: 'PRODUCTION_ORDER_STARTED',
        eventType: 'production.order_started',
        entityType: 'PRODUCTION_ORDER',
        entityId: row.id,
        businessCode: productionOrderCode,
        payload: { productionOrderCode, responsibleUserCode: input.responsibleUserCode ?? null },
      });
      return this.getOrderWithClient(client, productionOrderCode);
    });
  }

  async completeOrder(productionOrderCode: string, input: CompleteInput) {
    const waste = input.wasteQuantity ?? 0;
    if (waste > input.actualQuantity) throw new BadRequestException('WASTE_EXCEEDS_ACTUAL_QUANTITY');
    if (waste > 0 && !input.wasteReasonCode) throw new BadRequestException('WASTE_REASON_REQUIRED');
    if (input.expiresAt && !Number.isFinite(new Date(input.expiresAt).getTime())) {
      throw new BadRequestException('INVALID_EXPIRATION_DATE');
    }

    return this.db.transaction(async (client) => {
      const order = await client.query<{
        id: string;
        status_code: string;
        master_order_id: string;
        cpp_id: string;
        dish_id: string;
        recipe_version_id: string;
        service_date: string;
        planned_quantity: number;
      }>(
        `SELECT id,status_code,master_order_id,cpp_id,dish_id,recipe_version_id,
                service_date,planned_quantity
         FROM production.production_orders
         WHERE production_order_code=$1 FOR UPDATE`,
        [productionOrderCode],
      );
      const row = order.rows[0];
      if (!row) throw new NotFoundException('PRODUCTION_ORDER_NOT_FOUND');
      if (row.status_code !== 'IN_PROGRESS') throw new ConflictException('PRODUCTION_ORDER_NOT_COMPLETABLE');

      const lotCode = await this.nextCode(client, 'PRODUCTION_LOT');
      const lotId = randomUUID();
      const usableQuantity = input.actualQuantity - waste;
      if (usableQuantity <= 0) throw new UnprocessableEntityException('NO_USABLE_PRODUCTION_QUANTITY');

      await client.query(
        `UPDATE production.production_orders
         SET status_code='COMPLETED',actual_quantity=$2,waste_quantity=$3,notes=$4,
             completed_at=NOW(),updated_at=NOW(),version=version+1
         WHERE id=$1`,
        [row.id, input.actualQuantity, waste, input.notes ?? null],
      );
      await client.query(
        `INSERT INTO production.production_lots(
           id,lot_code,production_order_id,cpp_id,dish_id,recipe_version_id,service_date,
           quantity_produced,quantity_available,quantity_rejected,status_code,produced_at,
           expires_at,traceability)
         VALUES($1,$2,$3,$4,$5,$6,$7::date,$8,0,0,'PENDING_QUALITY',NOW(),$9::timestamptz,$10)`,
        [
          lotId, lotCode, row.id, row.cpp_id, row.dish_id, row.recipe_version_id,
          row.service_date, usableQuantity, input.expiresAt ?? null,
          JSON.stringify({ plannedQuantity: Number(row.planned_quantity), actualQuantity: input.actualQuantity, waste }),
        ],
      );
      if (waste > 0) {
        await client.query(
          `INSERT INTO production.production_waste(
             id,production_order_id,lot_id,quantity,reason_code,notes)
           VALUES($1,$2,$3,$4,$5,$6)`,
          [randomUUID(), row.id, lotId, waste, input.wasteReasonCode, input.notes ?? null],
        );
      }

      const remaining = await client.query<{ count: number }>(
        `SELECT COUNT(*)::int count FROM production.production_orders
         WHERE master_order_id=$1 AND status_code <> 'COMPLETED'`,
        [row.master_order_id],
      );
      if (Number(remaining.rows[0]?.count ?? 0) === 0) {
        await client.query(
          `UPDATE planning.master_production_orders
           SET status_code='COMPLETED',updated_at=NOW(),version=version+1 WHERE id=$1`,
          [row.master_order_id],
        );
      }

      await this.auditAndEvent(client, {
        action: 'PRODUCTION_ORDER_COMPLETED',
        eventType: 'production.lot_created',
        entityType: 'PRODUCTION_LOT',
        entityId: lotId,
        businessCode: lotCode,
        payload: {
          productionOrderCode, lotCode, plannedQuantity: Number(row.planned_quantity),
          actualQuantity: input.actualQuantity, usableQuantity, waste,
        },
      });
      return this.getLotWithClient(client, lotCode);
    });
  }

  async getLot(lotCode: string) {
    return this.db.transaction((client) => this.getLotWithClient(client, lotCode));
  }

  private async getOrderWithClient(client: PoolClient, code: string) {
    const result = await client.query(
      `SELECT po.id,po.production_order_code,po.service_date,po.dish_code,
              po.dish_name_snapshot,po.presentation_snapshot,po.planned_quantity,
              po.actual_quantity,po.waste_quantity,po.status_code,po.scheduled_start_at,
              po.started_at,po.completed_at,po.notes,c.cpp_code,m.omp_code,u.user_code,
              pl.lot_code,pl.status_code lot_status
       FROM production.production_orders po
       JOIN operations.cpp c ON c.id=po.cpp_id
       JOIN planning.master_production_orders m ON m.id=po.master_order_id
       LEFT JOIN core.internal_users u ON u.id=po.responsible_user_id
       LEFT JOIN production.production_lots pl ON pl.production_order_id=po.id
       WHERE po.production_order_code=$1`,
      [code],
    );
    const row: any = result.rows[0];
    if (!row) throw new NotFoundException('PRODUCTION_ORDER_NOT_FOUND');
    return {
      success: true,
      data: {
        productionOrderCode: row.production_order_code,
        masterOrderCode: row.omp_code,
        cppCode: row.cpp_code,
        serviceDate: row.service_date,
        dishCode: row.dish_code,
        dishName: row.dish_name_snapshot,
        presentation: row.presentation_snapshot,
        plannedQuantity: Number(row.planned_quantity),
        actualQuantity: row.actual_quantity === null ? null : Number(row.actual_quantity),
        wasteQuantity: Number(row.waste_quantity),
        status: row.status_code,
        scheduledStartAt: row.scheduled_start_at,
        startedAt: row.started_at,
        completedAt: row.completed_at,
        responsibleUserCode: row.user_code,
        notes: row.notes,
        lotCode: row.lot_code,
        lotStatus: row.lot_status,
      },
      meta: { timestamp: new Date().toISOString() },
    };
  }

  private async getLotWithClient(client: PoolClient, lotCode: string) {
    const result = await client.query(
      `SELECT pl.id,pl.lot_code,pl.service_date,pl.quantity_produced,pl.quantity_available,
              pl.quantity_rejected,pl.status_code,pl.produced_at,pl.expires_at,pl.traceability,
              po.production_order_code,po.dish_code,po.dish_name_snapshot,
              po.presentation_snapshot,c.cpp_code
       FROM production.production_lots pl
       JOIN production.production_orders po ON po.id=pl.production_order_id
       JOIN operations.cpp c ON c.id=pl.cpp_id
       WHERE pl.lot_code=$1`,
      [lotCode],
    );
    const row: any = result.rows[0];
    if (!row) throw new NotFoundException('PRODUCTION_LOT_NOT_FOUND');
    return {
      success: true,
      data: {
        lotCode: row.lot_code,
        productionOrderCode: row.production_order_code,
        cppCode: row.cpp_code,
        serviceDate: row.service_date,
        dishCode: row.dish_code,
        dishName: row.dish_name_snapshot,
        presentation: row.presentation_snapshot,
        quantityProduced: Number(row.quantity_produced),
        quantityAvailable: Number(row.quantity_available),
        quantityRejected: Number(row.quantity_rejected),
        status: row.status_code,
        producedAt: row.produced_at,
        expiresAt: row.expires_at,
        traceability: row.traceability,
      },
      meta: { timestamp: new Date().toISOString() },
    };
  }

  private async auditAndEvent(
    client: PoolClient,
    input: {
      action: string;
      eventType: string;
      entityType: string;
      entityId: string;
      businessCode: string;
      payload: Record<string, unknown>;
    },
  ) {
    await client.query(
      `INSERT INTO audit.audit_events(
         id,audit_code,actor_type,action_code,module_code,entity_type,entity_id,
         entity_business_code,new_value,result_code,occurred_at)
       VALUES($1,$2,'SYSTEM',$3,'PRODUCTION',$4,$5,$6,$7,'SUCCESS',NOW())`,
      [
        randomUUID(), `AUD-${randomUUID().slice(0, 8)}`, input.action, input.entityType,
        input.entityId, input.businessCode, JSON.stringify(input.payload),
      ],
    );
    await client.query(
      `INSERT INTO core.domain_events(
         id,event_code,event_type,event_version,aggregate_type,aggregate_id,
         aggregate_business_code,actor_type,payload,status_code,occurred_at)
       VALUES($1,$2,$3,1,$4,$5,$6,'SYSTEM',$7,'PENDING',NOW())`,
      [
        randomUUID(), `EVT-${randomUUID().slice(0, 8)}`, input.eventType,
        input.entityType, input.entityId, input.businessCode, JSON.stringify(input.payload),
      ],
    );
  }
}
