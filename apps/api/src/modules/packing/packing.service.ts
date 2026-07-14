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
type StartInput = { responsibleUserCode?: string };
type AllocateInput = { lotCode: string; quantity: number; memberCode?: string; allocatedByUserCode?: string };
type CheckInput = {
  checkCode: string;
  result: 'PASS' | 'FAIL' | 'NOT_APPLICABLE';
  notes?: string;
  evidence?: Record<string, unknown>;
  checkedByUserCode?: string;
};
type CloseInput = { notes?: string; responsibleUserCode?: string };

@Injectable()
export class PackingService {
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

  private async resolveUser(client: PoolClient, userCode?: string): Promise<string | null> {
    if (!userCode) return null;
    const result = await client.query<{ id: string }>(
      `SELECT id FROM core.internal_users WHERE user_code=$1 AND is_active=TRUE`,
      [userCode],
    );
    if (!result.rows[0]) throw new NotFoundException('PACKING_USER_NOT_FOUND');
    return result.rows[0].id;
  }

  async createFromOrder(orderCode: string) {
    return this.db.transaction(async (client) => {
      const orderResult = await client.query<{
        id: string; household_id: string; location_id: string; cpp_id: string;
        service_date: string; status_code: string;
      }>(
        `SELECT id,household_id,location_id,cpp_id,service_date,status_code
         FROM commerce.orders WHERE order_code=$1 FOR UPDATE`,
        [orderCode],
      );
      const order = orderResult.rows[0];
      if (!order) throw new NotFoundException('ORDER_NOT_FOUND');
      if (!['PLANNED', 'IN_PRODUCTION', 'READY_FOR_PACKING'].includes(order.status_code)) {
        throw new ConflictException('ORDER_NOT_ELIGIBLE_FOR_PACKING');
      }

      const existing = await client.query<{ packing_order_code: string }>(
        `SELECT packing_order_code FROM packing.packing_orders WHERE order_id=$1`,
        [order.id],
      );
      if (existing.rows[0]) return this.getWithClient(client, existing.rows[0].packing_order_code);

      const items = await client.query<{
        id: string; dish_id: string; recipe_version_id: string; member_id: string | null;
        dish_name_snapshot: string; presentation_snapshot: string; quantity: number;
      }>(
        `SELECT id,dish_id,recipe_version_id,member_id,dish_name_snapshot,presentation_snapshot,quantity
         FROM commerce.order_items WHERE order_id=$1 ORDER BY dish_name_snapshot,presentation_snapshot`,
        [order.id],
      );
      if (!items.rows.length) throw new UnprocessableEntityException('ORDER_HAS_NO_ITEMS');

      const packingOrderId = randomUUID();
      const packingOrderCode = await this.nextCode(client, 'PACKING_ORDER');
      await client.query(
        `INSERT INTO packing.packing_orders(
           id,packing_order_code,order_id,household_id,location_id,cpp_id,service_date,status_code)
         VALUES($1,$2,$3,$4,$5,$6,$7::date,'PENDING')`,
        [packingOrderId, packingOrderCode, order.id, order.household_id, order.location_id, order.cpp_id, order.service_date],
      );

      for (const item of items.rows) {
        const labelCode = await this.nextCode(client, 'PACKING_LABEL');
        await client.query(
          `INSERT INTO packing.packing_order_items(
             id,packing_order_id,order_item_id,dish_id,recipe_version_id,member_id,
             dish_name_snapshot,presentation_snapshot,required_quantity,label_code,status_code)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'PENDING')`,
          [randomUUID(), packingOrderId, item.id, item.dish_id, item.recipe_version_id, item.member_id,
            item.dish_name_snapshot, item.presentation_snapshot, Number(item.quantity), labelCode],
        );
      }

      await client.query(
        `UPDATE commerce.orders SET status_code='READY_FOR_PACKING',updated_at=NOW(),version=version+1 WHERE id=$1`,
        [order.id],
      );
      await this.auditAndEvent(client, {
        action: 'PACKING_ORDER_CREATED', eventType: 'packing.order_created',
        entityType: 'PACKING_ORDER', entityId: packingOrderId, businessCode: packingOrderCode,
        payload: { packingOrderCode, orderCode, itemCount: items.rows.length },
      });
      return this.getWithClient(client, packingOrderCode);
    });
  }

  async list(input: ListInput) {
    if (input.serviceDate && !/^\d{4}-\d{2}-\d{2}$/.test(input.serviceDate)) {
      throw new BadRequestException('INVALID_SERVICE_DATE');
    }
    return this.db.transaction(async (client) => {
      const params: unknown[] = [];
      const filters: string[] = [];
      const add = (fragment: string, value: unknown) => {
        params.push(value); filters.push(fragment.replace('?', `$${params.length}`));
      };
      if (input.cppCode) add('c.cpp_code=?', input.cppCode);
      if (input.serviceDate) add('po.service_date=?::date', input.serviceDate);
      if (input.status) add('po.status_code=?', input.status);
      const result = await client.query(
        `SELECT po.packing_order_code,po.service_date,po.status_code,po.started_at,po.completed_at,
                o.order_code,h.haid,h.household_name,l.location_code,l.alias location_alias,c.cpp_code,
                COUNT(poi.id)::int item_count,
                COALESCE(SUM(poi.required_quantity),0)::int required_units,
                COALESCE(SUM(poi.allocated_quantity),0)::int allocated_units
         FROM packing.packing_orders po
         JOIN commerce.orders o ON o.id=po.order_id
         JOIN household.households h ON h.id=po.household_id
         JOIN household.locations l ON l.id=po.location_id
         JOIN operations.cpp c ON c.id=po.cpp_id
         LEFT JOIN packing.packing_order_items poi ON poi.packing_order_id=po.id
         ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}
         GROUP BY po.id,o.order_code,h.haid,h.household_name,l.location_code,l.alias,c.cpp_code
         ORDER BY po.service_date,po.created_at`,
        params,
      );
      return { success: true, data: result.rows.map((row: any) => ({
        packingOrderCode: row.packing_order_code, orderCode: row.order_code, haid: row.haid,
        householdName: row.household_name, locationCode: row.location_code,
        locationAlias: row.location_alias, cppCode: row.cpp_code, serviceDate: row.service_date,
        status: row.status_code, itemCount: Number(row.item_count),
        requiredUnits: Number(row.required_units), allocatedUnits: Number(row.allocated_units),
        startedAt: row.started_at, completedAt: row.completed_at,
      })), meta: { timestamp: new Date().toISOString() } };
    });
  }

  async get(code: string) { return this.db.transaction((client) => this.getWithClient(client, code)); }

  async start(code: string, input: StartInput) {
    return this.db.transaction(async (client) => {
      const result = await client.query<{ id: string; status_code: string }>(
        `SELECT id,status_code FROM packing.packing_orders WHERE packing_order_code=$1 FOR UPDATE`, [code],
      );
      const row = result.rows[0];
      if (!row) throw new NotFoundException('PACKING_ORDER_NOT_FOUND');
      if (row.status_code !== 'PENDING') throw new ConflictException('PACKING_ORDER_NOT_STARTABLE');
      const userId = await this.resolveUser(client, input.responsibleUserCode);
      await client.query(
        `UPDATE packing.packing_orders SET status_code='IN_PROGRESS',responsible_user_id=$2,
         started_at=NOW(),updated_at=NOW(),version=version+1 WHERE id=$1`, [row.id, userId],
      );
      await this.auditAndEvent(client, {
        action: 'PACKING_ORDER_STARTED', eventType: 'packing.order_started',
        entityType: 'PACKING_ORDER', entityId: row.id, businessCode: code,
        payload: { packingOrderCode: code, responsibleUserCode: input.responsibleUserCode ?? null },
      });
      return this.getWithClient(client, code);
    });
  }

  async allocateLot(code: string, packingItemId: string, input: AllocateInput) {
    return this.db.transaction(async (client) => {
      const itemResult = await client.query<{
        id: string; packing_order_id: string; status_code: string; dish_id: string; recipe_version_id: string;
        member_id: string | null; required_quantity: number; allocated_quantity: number; cpp_id: string; service_date: string;
        packing_status: string;
      }>(
        `SELECT poi.id,poi.packing_order_id,poi.status_code,poi.dish_id,poi.recipe_version_id,poi.member_id,
                poi.required_quantity,poi.allocated_quantity,po.cpp_id,po.service_date,po.status_code packing_status
         FROM packing.packing_order_items poi
         JOIN packing.packing_orders po ON po.id=poi.packing_order_id
         WHERE po.packing_order_code=$1 AND poi.id=$2::uuid FOR UPDATE OF poi,po`,
        [code, packingItemId],
      );
      const item = itemResult.rows[0];
      if (!item) throw new NotFoundException('PACKING_ITEM_NOT_FOUND');
      if (!['IN_PROGRESS', 'PENDING'].includes(item.packing_status)) throw new ConflictException('PACKING_ORDER_NOT_EDITABLE');
      const remaining = Number(item.required_quantity) - Number(item.allocated_quantity);
      if (input.quantity > remaining) throw new BadRequestException('ALLOCATION_EXCEEDS_REQUIRED_QUANTITY');

      if (input.memberCode) {
        const member = await client.query<{ id: string }>(
          `SELECT m.id FROM household.members m
           JOIN packing.packing_orders po ON po.household_id=m.household_id
           WHERE po.packing_order_code=$1 AND m.member_code=$2 AND m.is_active=TRUE`,
          [code, input.memberCode],
        );
        if (!member.rows[0]) throw new NotFoundException('MEMBER_NOT_IN_HOUSEHOLD');
        await client.query(`UPDATE packing.packing_order_items SET member_id=$2 WHERE id=$1`, [item.id, member.rows[0].id]);
      }

      const lotResult = await client.query<{
        id: string; dish_id: string; recipe_version_id: string; cpp_id: string; service_date: string;
        status_code: string; quantity_available: number;
      }>(
        `SELECT id,dish_id,recipe_version_id,cpp_id,service_date,status_code,quantity_available
         FROM production.production_lots WHERE lot_code=$1 FOR UPDATE`, [input.lotCode],
      );
      const lot = lotResult.rows[0];
      if (!lot) throw new NotFoundException('PRODUCTION_LOT_NOT_FOUND');
      if (!['APPROVED', 'PARTIALLY_RELEASED'].includes(lot.status_code)) throw new ConflictException('LOT_NOT_RELEASED_FOR_PACKING');
      if (lot.cpp_id !== item.cpp_id || String(lot.service_date).slice(0, 10) !== String(item.service_date).slice(0, 10)) {
        throw new UnprocessableEntityException('LOT_CPP_OR_SERVICE_DATE_MISMATCH');
      }
      if (lot.dish_id !== item.dish_id || lot.recipe_version_id !== item.recipe_version_id) {
        throw new UnprocessableEntityException('LOT_NOT_COMPATIBLE_WITH_ORDER_ITEM');
      }
      if (Number(lot.quantity_available) < input.quantity) throw new ConflictException('LOT_INSUFFICIENT_AVAILABLE_QUANTITY');

      const userId = await this.resolveUser(client, input.allocatedByUserCode);
      await client.query(
        `INSERT INTO packing.lot_allocations(id,packing_order_item_id,lot_id,quantity,allocated_by)
         VALUES($1,$2,$3,$4,$5)
         ON CONFLICT (packing_order_item_id,lot_id)
         DO UPDATE SET quantity=packing.lot_allocations.quantity+EXCLUDED.quantity,
           allocated_by=EXCLUDED.allocated_by,allocated_at=NOW()`,
        [randomUUID(), item.id, lot.id, input.quantity, userId],
      );
      await client.query(
        `UPDATE production.production_lots SET quantity_available=quantity_available-$2,
         updated_at=NOW(),version=version+1 WHERE id=$1`, [lot.id, input.quantity],
      );
      await client.query(
        `UPDATE packing.packing_order_items SET allocated_quantity=allocated_quantity+$2,
         status_code=CASE WHEN allocated_quantity+$2=required_quantity THEN 'ALLOCATED' ELSE 'PARTIAL' END,
         updated_at=NOW(),version=version+1 WHERE id=$1`, [item.id, input.quantity],
      );
      await client.query(
        `UPDATE packing.packing_orders SET status_code='IN_PROGRESS',updated_at=NOW(),version=version+1 WHERE id=$1 AND status_code='PENDING'`,
        [item.packing_order_id],
      );
      await this.auditAndEvent(client, {
        action: 'PACKING_LOT_ALLOCATED', eventType: 'packing.lot_allocated',
        entityType: 'PACKING_ORDER_ITEM', entityId: item.id, businessCode: code,
        payload: { packingOrderCode: code, packingItemId, lotCode: input.lotCode, quantity: input.quantity },
      });
      return this.getWithClient(client, code);
    });
  }

  async recordCheck(code: string, input: CheckInput) {
    return this.db.transaction(async (client) => {
      const order = await client.query<{ id: string; status_code: string }>(
        `SELECT id,status_code FROM packing.packing_orders WHERE packing_order_code=$1 FOR UPDATE`, [code],
      );
      if (!order.rows[0]) throw new NotFoundException('PACKING_ORDER_NOT_FOUND');
      if (!['PENDING', 'IN_PROGRESS'].includes(order.rows[0].status_code)) throw new ConflictException('PACKING_ORDER_NOT_EDITABLE');
      const definition = await client.query<{ id: string; is_mandatory: boolean }>(
        `SELECT id,is_mandatory FROM packing.checklist_definitions WHERE check_code=$1 AND is_active=TRUE`, [input.checkCode],
      );
      if (!definition.rows[0]) throw new NotFoundException('PACKING_CHECK_NOT_FOUND');
      if (definition.rows[0].is_mandatory && input.result === 'NOT_APPLICABLE') {
        throw new UnprocessableEntityException('MANDATORY_CHECK_CANNOT_BE_NOT_APPLICABLE');
      }
      const userId = await this.resolveUser(client, input.checkedByUserCode);
      await client.query(
        `INSERT INTO packing.checklist_results(
          id,packing_order_id,checklist_definition_id,result_code,notes,evidence,checked_by)
         VALUES($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (packing_order_id,checklist_definition_id)
         DO UPDATE SET result_code=EXCLUDED.result_code,notes=EXCLUDED.notes,evidence=EXCLUDED.evidence,
           checked_by=EXCLUDED.checked_by,checked_at=NOW(),version=packing.checklist_results.version+1`,
        [randomUUID(), order.rows[0].id, definition.rows[0].id, input.result,
          input.notes ?? null, JSON.stringify(input.evidence ?? {}), userId],
      );
      await this.auditAndEvent(client, {
        action: 'PACKING_CHECK_RECORDED', eventType: 'packing.check_recorded',
        entityType: 'PACKING_ORDER', entityId: order.rows[0].id, businessCode: code,
        payload: { packingOrderCode: code, checkCode: input.checkCode, result: input.result },
      });
      return this.getWithClient(client, code);
    });
  }

  async close(code: string, input: CloseInput) {
    return this.db.transaction(async (client) => {
      const orderResult = await client.query<{ id: string; order_id: string; status_code: string }>(
        `SELECT id,order_id,status_code FROM packing.packing_orders WHERE packing_order_code=$1 FOR UPDATE`, [code],
      );
      const order = orderResult.rows[0];
      if (!order) throw new NotFoundException('PACKING_ORDER_NOT_FOUND');
      if (!['PENDING', 'IN_PROGRESS'].includes(order.status_code)) throw new ConflictException('PACKING_ORDER_NOT_CLOSABLE');

      const incomplete = await client.query<{ count: number }>(
        `SELECT COUNT(*)::int count FROM packing.packing_order_items
         WHERE packing_order_id=$1 AND allocated_quantity<>required_quantity`, [order.id],
      );
      if (Number(incomplete.rows[0]?.count ?? 0) > 0) throw new UnprocessableEntityException('PACKING_ITEMS_INCOMPLETE');

      const checklist = await client.query<{ missing: number; failed: number }>(
        `SELECT
           COUNT(*) FILTER (WHERE d.is_mandatory AND r.id IS NULL)::int missing,
           COUNT(*) FILTER (WHERE d.is_mandatory AND r.result_code<>'PASS')::int failed
         FROM packing.checklist_definitions d
         LEFT JOIN packing.checklist_results r ON r.checklist_definition_id=d.id AND r.packing_order_id=$1
         WHERE d.is_active=TRUE`, [order.id],
      );
      if (Number(checklist.rows[0]?.missing ?? 0) > 0) throw new UnprocessableEntityException('PACKING_MANDATORY_CHECKS_MISSING');
      if (Number(checklist.rows[0]?.failed ?? 0) > 0) throw new UnprocessableEntityException('PACKING_MANDATORY_CHECKS_FAILED');

      const userId = await this.resolveUser(client, input.responsibleUserCode);
      await client.query(
        `UPDATE packing.packing_orders SET status_code='READY_FOR_LOGISTICS',responsible_user_id=COALESCE($2,responsible_user_id),
         notes=$3,completed_at=NOW(),updated_at=NOW(),version=version+1 WHERE id=$1`,
        [order.id, userId, input.notes ?? null],
      );
      await client.query(
        `UPDATE packing.packing_order_items SET status_code='PACKED',updated_at=NOW(),version=version+1
         WHERE packing_order_id=$1`, [order.id],
      );
      await client.query(
        `UPDATE commerce.orders SET status_code='PACKED',updated_at=NOW(),version=version+1 WHERE id=$1`, [order.order_id],
      );
      await this.auditAndEvent(client, {
        action: 'PACKING_ORDER_COMPLETED', eventType: 'packing.order_completed',
        entityType: 'PACKING_ORDER', entityId: order.id, businessCode: code,
        payload: { packingOrderCode: code, status: 'READY_FOR_LOGISTICS' },
      });
      return this.getWithClient(client, code);
    });
  }

  private async getWithClient(client: PoolClient, code: string) {
    const header = await client.query(
      `SELECT po.id,po.packing_order_code,po.service_date,po.status_code,po.started_at,po.completed_at,po.notes,
              o.order_code,h.haid,h.household_name,l.location_code,l.alias location_alias,
              l.street,l.exterior_number,l.interior_number,l.colony_name,l.postal_code,
              c.cpp_code,u.user_code responsible_user_code
       FROM packing.packing_orders po
       JOIN commerce.orders o ON o.id=po.order_id
       JOIN household.households h ON h.id=po.household_id
       JOIN household.locations l ON l.id=po.location_id
       JOIN operations.cpp c ON c.id=po.cpp_id
       LEFT JOIN core.internal_users u ON u.id=po.responsible_user_id
       WHERE po.packing_order_code=$1`, [code],
    );
    const row: any = header.rows[0];
    if (!row) throw new NotFoundException('PACKING_ORDER_NOT_FOUND');

    const items = await client.query(
      `SELECT poi.id packing_item_id,poi.dish_name_snapshot,poi.presentation_snapshot,
              poi.required_quantity,poi.allocated_quantity,poi.label_code,poi.status_code,
              m.member_code,m.first_name,m.alias member_alias,
              COALESCE(json_agg(json_build_object('lotCode',pl.lot_code,'quantity',la.quantity)
                ORDER BY pl.lot_code) FILTER (WHERE la.id IS NOT NULL),'[]'::json) allocations
       FROM packing.packing_order_items poi
       LEFT JOIN household.members m ON m.id=poi.member_id
       LEFT JOIN packing.lot_allocations la ON la.packing_order_item_id=poi.id
       LEFT JOIN production.production_lots pl ON pl.id=la.lot_id
       WHERE poi.packing_order_id=$1
       GROUP BY poi.id,m.member_code,m.first_name,m.alias
       ORDER BY poi.dish_name_snapshot,poi.presentation_snapshot`, [row.id],
    );
    const checks = await client.query(
      `SELECT d.check_code,d.label,d.description,d.is_mandatory,d.sort_order,
              r.result_code,r.notes,r.evidence,r.checked_at
       FROM packing.checklist_definitions d
       LEFT JOIN packing.checklist_results r ON r.checklist_definition_id=d.id AND r.packing_order_id=$1
       WHERE d.is_active=TRUE ORDER BY d.sort_order,d.label`, [row.id],
    );
    return { success: true, data: {
      packingOrderCode: row.packing_order_code, orderCode: row.order_code,
      haid: row.haid, householdName: row.household_name, cppCode: row.cpp_code,
      serviceDate: row.service_date, status: row.status_code,
      responsibleUserCode: row.responsible_user_code, startedAt: row.started_at,
      completedAt: row.completed_at, notes: row.notes,
      location: { code: row.location_code, alias: row.location_alias, street: row.street,
        exteriorNumber: row.exterior_number, interiorNumber: row.interior_number,
        neighborhood: row.colony_name, postalCode: row.postal_code },
      items: items.rows.map((item: any) => ({
        packingItemId: item.packing_item_id, dishName: item.dish_name_snapshot,
        presentation: item.presentation_snapshot, requiredQuantity: Number(item.required_quantity),
        allocatedQuantity: Number(item.allocated_quantity), labelCode: item.label_code,
        status: item.status_code, memberCode: item.member_code,
        memberName: item.member_alias ?? item.first_name ?? null, allocations: item.allocations,
      })),
      checks: checks.rows.map((check: any) => ({ checkCode: check.check_code, label: check.label,
        description: check.description, mandatory: check.is_mandatory, result: check.result_code,
        notes: check.notes, evidence: check.evidence, checkedAt: check.checked_at })),
    }, meta: { timestamp: new Date().toISOString() } };
  }

  private async auditAndEvent(client: PoolClient, input: {
    action: string; eventType: string; entityType: string; entityId: string;
    businessCode: string; payload: Record<string, unknown>;
  }) {
    await client.query(
      `INSERT INTO audit.audit_events(
        id,audit_code,actor_type,action_code,module_code,entity_type,entity_id,
        entity_business_code,new_value,result_code,occurred_at)
       VALUES($1,$2,'SYSTEM',$3,'PACKING',$4,$5,$6,$7,'SUCCESS',NOW())`,
      [randomUUID(), `AUD-${randomUUID()}`, input.action, input.entityType, input.entityId,
        input.businessCode, JSON.stringify(input.payload)],
    );
    await client.query(
      `INSERT INTO core.domain_events(
        id,event_code,event_type,event_version,aggregate_type,aggregate_id,
        aggregate_business_code,payload,status_code,occurred_at)
       VALUES($1,$2,$3,1,$4,$5,$6,$7,'PENDING',NOW())`,
      [randomUUID(), `EVT-${randomUUID()}`, input.eventType, input.entityType,
        input.entityId, input.businessCode, JSON.stringify(input.payload)],
    );
  }
}
