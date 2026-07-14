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

type GenerateInput = {
  cppCode: string;
  serviceDate: string;
  strategicReservePercent?: number;
};

type DemandRow = {
  weekly_menu_item_id: string;
  dish_id: string;
  recipe_version_id: string;
  dish_code: string;
  dish_name: string;
  presentation_name: string;
  confirmed_quantity: number;
  menu_capacity: number;
  reserved_quantity: number;
  sold_quantity: number;
};

@Injectable()
export class PlanningService {
  constructor(private readonly db: DatabaseService) {}

  private async nextCode(client: PoolClient): Promise<string> {
    const result = await client.query<{ current_value: string; prefix: string; padding: number }>(
      `UPDATE core.business_sequences
       SET current_value=current_value+1,updated_at=NOW()
       WHERE sequence_code='MASTER_PRODUCTION_ORDER'
       RETURNING current_value,prefix,padding`,
    );
    const row = result.rows[0];
    if (!row) throw new Error('MASTER_PRODUCTION_ORDER sequence missing');
    return `${row.prefix}${String(row.current_value).padStart(row.padding, '0')}`;
  }

  private validateDate(serviceDate: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(serviceDate)) throw new BadRequestException('INVALID_SERVICE_DATE');
    const value = new Date(`${serviceDate}T00:00:00Z`);
    if (!Number.isFinite(value.getTime())) throw new BadRequestException('INVALID_SERVICE_DATE');
  }

  private async getCpp(client: PoolClient, cppCode: string) {
    const result = await client.query<{ id: string; cpp_code: string; timezone: string }>(
      `SELECT c.id,c.cpp_code,c.timezone
       FROM operations.cpp c
       WHERE c.cpp_code=$1 AND c.status_code='ACTIVE'`,
      [cppCode],
    );
    const cpp = result.rows[0];
    if (!cpp) throw new NotFoundException('CPP_NOT_FOUND');
    return cpp;
  }

  private async demandRows(client: PoolClient, cppId: string, serviceDate: string): Promise<DemandRow[]> {
    const result = await client.query<DemandRow>(
      `SELECT oi.weekly_menu_item_id,oi.dish_id,oi.recipe_version_id,
              d.dish_code,d.name dish_name,wmi.presentation_name,
              SUM(oi.quantity)::int confirmed_quantity,
              wmi.capacity,wmi.reserved_quantity,wmi.sold_quantity
       FROM commerce.orders o
       JOIN commerce.order_items oi ON oi.order_id=o.id
       JOIN menu.weekly_menu_items wmi ON wmi.id=oi.weekly_menu_item_id
       JOIN menu.dishes d ON d.id=oi.dish_id
       WHERE o.cpp_id=$1 AND o.service_date=$2::date
         AND o.status_code IN ('CONFIRMED','PLANNED')
       GROUP BY oi.weekly_menu_item_id,oi.dish_id,oi.recipe_version_id,
                d.dish_code,d.name,wmi.presentation_name,
                wmi.capacity,wmi.reserved_quantity,wmi.sold_quantity
       ORDER BY d.name,wmi.presentation_name`,
      [cppId, serviceDate],
    );
    return result.rows;
  }

  async previewDemand(cppCode: string, serviceDate: string) {
    this.validateDate(serviceDate);
    return this.db.transaction(async (client) => {
      const cpp = await this.getCpp(client, cppCode);
      const rows = await this.demandRows(client, cpp.id, serviceDate);
      const orderCount = await client.query<{ count: number }>(
        `SELECT COUNT(*)::int count FROM commerce.orders
         WHERE cpp_id=$1 AND service_date=$2::date AND status_code IN ('CONFIRMED','PLANNED')`,
        [cpp.id, serviceDate],
      );
      return {
        success: true,
        data: {
          cppCode,
          serviceDate,
          sourceOrderCount: Number(orderCount.rows[0]?.count ?? 0),
          totalConfirmedUnits: rows.reduce((sum, row) => sum + Number(row.confirmed_quantity), 0),
          lines: rows.map((row) => ({
            dishCode: row.dish_code,
            dishName: row.dish_name,
            presentation: row.presentation_name,
            confirmedQuantity: Number(row.confirmed_quantity),
            menuCapacity: Number(row.menu_capacity),
            remainingMenuCapacity:
              Number(row.menu_capacity) - Number(row.reserved_quantity) - Number(row.sold_quantity),
          })),
        },
        meta: { timestamp: new Date().toISOString() },
      };
    });
  }

  async generateMasterOrder(input: GenerateInput) {
    this.validateDate(input.serviceDate);
    const reservePercent = input.strategicReservePercent ?? 0;
    if (reservePercent < 0 || reservePercent > 30) throw new BadRequestException('INVALID_RESERVE_PERCENT');

    return this.db.transaction(async (client) => {
      const cpp = await this.getCpp(client, input.cppCode);
      const existing = await client.query<{ omp_code: string }>(
        `SELECT omp_code FROM planning.master_production_orders
         WHERE cpp_id=$1 AND service_date=$2::date
           AND status_code IN ('DRAFT','APPROVED','RELEASED','IN_PROGRESS')
         FOR UPDATE`,
        [cpp.id, input.serviceDate],
      );
      if (existing.rows[0]) throw new ConflictException(`OPEN_MASTER_ORDER_EXISTS:${existing.rows[0].omp_code}`);

      const rows = await this.demandRows(client, cpp.id, input.serviceDate);
      if (!rows.length) throw new UnprocessableEntityException('NO_CONFIRMED_DEMAND');

      const orderCount = await client.query<{ count: number }>(
        `SELECT COUNT(*)::int count FROM commerce.orders
         WHERE cpp_id=$1 AND service_date=$2::date AND status_code='CONFIRMED'`,
        [cpp.id, input.serviceDate],
      );
      const ompCode = await this.nextCode(client);
      const masterId = randomUUID();
      let confirmedTotal = 0;
      let reserveTotal = 0;
      let productionTotal = 0;

      await client.query(
        `INSERT INTO planning.master_production_orders(
           id,omp_code,cpp_id,service_date,status_code,strategic_reserve_percent,source_order_count)
         VALUES($1,$2,$3,$4,'DRAFT',$5,$6)`,
        [masterId, ompCode, cpp.id, input.serviceDate, reservePercent, Number(orderCount.rows[0]?.count ?? 0)],
      );

      for (const row of rows) {
        const confirmed = Number(row.confirmed_quantity);
        const reserve = Math.ceil((confirmed * reservePercent) / 100);
        const finishedInventory = 0;
        const required = Math.max(0, confirmed + reserve - finishedInventory);
        const remainingAfterPlan = Number(row.menu_capacity) - confirmed - reserve;
        confirmedTotal += confirmed;
        reserveTotal += reserve;
        productionTotal += required;
        const lineId = randomUUID();

        await client.query(
          `INSERT INTO planning.production_demand_lines(
             id,master_order_id,weekly_menu_item_id,dish_id,recipe_version_id,dish_code,
             dish_name_snapshot,presentation_snapshot,confirmed_quantity,
             strategic_reserve_quantity,finished_inventory_quantity,production_required_quantity,
             menu_capacity,capacity_remaining_after_plan)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
          [
            lineId,
            masterId,
            row.weekly_menu_item_id,
            row.dish_id,
            row.recipe_version_id,
            row.dish_code,
            row.dish_name,
            row.presentation_name,
            confirmed,
            reserve,
            finishedInventory,
            required,
            Number(row.menu_capacity),
            remainingAfterPlan,
          ],
        );

        if (remainingAfterPlan < 0) {
          await client.query(
            `INSERT INTO planning.planning_alerts(
               id,master_order_id,demand_line_id,alert_code,severity_code,message,details)
             VALUES($1,$2,$3,'RESERVE_EXCEEDS_MENU_CAPACITY','HIGH',$4,$5)`,
            [
              randomUUID(),
              masterId,
              lineId,
              `La reserva estratégica excede la capacidad del menú para ${row.dish_name}.`,
              JSON.stringify({ confirmed, reserve, menuCapacity: Number(row.menu_capacity) }),
            ],
          );
        }
      }

      await client.query(
        `UPDATE planning.master_production_orders
         SET total_confirmed_units=$2,total_reserve_units=$3,total_production_units=$4,updated_at=NOW()
         WHERE id=$1`,
        [masterId, confirmedTotal, reserveTotal, productionTotal],
      );

      await client.query(
        `INSERT INTO audit.audit_events(
           id,audit_code,actor_type,action_code,module_code,entity_type,entity_id,
           entity_business_code,new_value,result_code,occurred_at)
         VALUES($1,$2,'SYSTEM','MASTER_PRODUCTION_ORDER_GENERATED','PLANNING',
                'MASTER_PRODUCTION_ORDER',$3,$4,$5,'SUCCESS',NOW())`,
        [
          randomUUID(),
          `AUD-${randomUUID().slice(0, 8)}`,
          masterId,
          ompCode,
          JSON.stringify({ cppCode: input.cppCode, serviceDate: input.serviceDate, reservePercent }),
        ],
      );
      await client.query(
        `INSERT INTO core.domain_events(
           id,event_code,event_type,event_version,aggregate_type,aggregate_id,
           aggregate_business_code,actor_type,payload,status_code,occurred_at)
         VALUES($1,$2,'planning.master_order_generated',1,'MASTER_PRODUCTION_ORDER',$3,$4,
                'SYSTEM',$5,'PENDING',NOW())`,
        [
          randomUUID(),
          `EVT-${randomUUID().slice(0, 8)}`,
          masterId,
          ompCode,
          JSON.stringify({ ompCode, cppCode: input.cppCode, serviceDate: input.serviceDate }),
        ],
      );

      return this.getWithClient(client, ompCode);
    });
  }

  async approveMasterOrder(ompCode: string) {
    return this.db.transaction(async (client) => {
      const order = await client.query<{ id: string; status_code: string; cpp_id: string; service_date: string }>(
        `SELECT id,status_code,cpp_id,service_date
         FROM planning.master_production_orders WHERE omp_code=$1 FOR UPDATE`,
        [ompCode],
      );
      const row = order.rows[0];
      if (!row) throw new NotFoundException('MASTER_PRODUCTION_ORDER_NOT_FOUND');
      if (row.status_code !== 'DRAFT') throw new ConflictException('MASTER_PRODUCTION_ORDER_NOT_APPROVABLE');

      const alerts = await client.query<{ count: number }>(
        `SELECT COUNT(*)::int count FROM planning.planning_alerts
         WHERE master_order_id=$1 AND status_code='OPEN' AND severity_code IN ('HIGH','CRITICAL')`,
        [row.id],
      );
      if (Number(alerts.rows[0]?.count ?? 0) > 0) {
        throw new UnprocessableEntityException('MASTER_ORDER_HAS_BLOCKING_ALERTS');
      }

      await client.query(
        `UPDATE planning.master_production_orders
         SET status_code='APPROVED',approved_at=NOW(),updated_at=NOW(),version=version+1
         WHERE id=$1`,
        [row.id],
      );
      await client.query(
        `UPDATE commerce.orders
         SET status_code='PLANNED',updated_at=NOW(),version=version+1
         WHERE cpp_id=$1 AND service_date=$2::date AND status_code='CONFIRMED'`,
        [row.cpp_id, row.service_date],
      );
      await client.query(
        `INSERT INTO core.domain_events(
           id,event_code,event_type,event_version,aggregate_type,aggregate_id,
           aggregate_business_code,actor_type,payload,status_code,occurred_at)
         VALUES($1,$2,'planning.master_order_approved',1,'MASTER_PRODUCTION_ORDER',$3,$4,
                'SYSTEM',$5,'PENDING',NOW())`,
        [randomUUID(), `EVT-${randomUUID().slice(0, 8)}`, row.id, ompCode, JSON.stringify({ ompCode })],
      );
      return this.getWithClient(client, ompCode);
    });
  }

  async getMasterOrder(ompCode: string) {
    return this.db.transaction((client) => this.getWithClient(client, ompCode));
  }

  private async getWithClient(client: PoolClient, ompCode: string) {
    const master = await client.query(
      `SELECT m.id,m.omp_code,m.service_date,m.status_code,m.strategic_reserve_percent,
              m.source_order_count,m.total_confirmed_units,m.total_reserve_units,
              m.total_production_units,m.generated_at,m.approved_at,c.cpp_code
       FROM planning.master_production_orders m
       JOIN operations.cpp c ON c.id=m.cpp_id
       WHERE m.omp_code=$1`,
      [ompCode],
    );
    const row: any = master.rows[0];
    if (!row) throw new NotFoundException('MASTER_PRODUCTION_ORDER_NOT_FOUND');
    const lines = await client.query(
      `SELECT dish_code,dish_name_snapshot,presentation_snapshot,confirmed_quantity,
              strategic_reserve_quantity,finished_inventory_quantity,
              production_required_quantity,menu_capacity,capacity_remaining_after_plan,status_code
       FROM planning.production_demand_lines
       WHERE master_order_id=$1 ORDER BY dish_name_snapshot,presentation_snapshot`,
      [row.id],
    );
    const alerts = await client.query(
      `SELECT alert_code,severity_code,message,details,status_code
       FROM planning.planning_alerts WHERE master_order_id=$1 ORDER BY created_at`,
      [row.id],
    );
    return {
      success: true,
      data: {
        ompCode: row.omp_code,
        cppCode: row.cpp_code,
        serviceDate: row.service_date,
        status: row.status_code,
        strategicReservePercent: Number(row.strategic_reserve_percent),
        sourceOrderCount: Number(row.source_order_count),
        totalConfirmedUnits: Number(row.total_confirmed_units),
        totalReserveUnits: Number(row.total_reserve_units),
        totalProductionUnits: Number(row.total_production_units),
        generatedAt: row.generated_at,
        approvedAt: row.approved_at,
        lines: lines.rows.map((line: any) => ({
          dishCode: line.dish_code,
          dishName: line.dish_name_snapshot,
          presentation: line.presentation_snapshot,
          confirmedQuantity: Number(line.confirmed_quantity),
          strategicReserveQuantity: Number(line.strategic_reserve_quantity),
          finishedInventoryQuantity: Number(line.finished_inventory_quantity),
          productionRequiredQuantity: Number(line.production_required_quantity),
          menuCapacity: Number(line.menu_capacity),
          capacityRemainingAfterPlan: Number(line.capacity_remaining_after_plan),
          status: line.status_code,
        })),
        alerts: alerts.rows.map((alert: any) => ({
          code: alert.alert_code,
          severity: alert.severity_code,
          message: alert.message,
          details: alert.details,
          status: alert.status_code,
        })),
      },
      meta: { timestamp: new Date().toISOString() },
    };
  }
}
