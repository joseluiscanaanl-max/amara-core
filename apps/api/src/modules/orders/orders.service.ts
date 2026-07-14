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

type CreateOrderInput = {
  clientRequestId: string;
  haid: string;
  locationCode: string;
  serviceDate: string;
  deliveryWindowStart: string;
  deliveryWindowEnd: string;
  notes?: string;
  items: Array<{ dishCode: string; quantity: number }>;
};

type MenuItemRow = {
  id: string;
  dish_id: string;
  recipe_version_id: string;
  dish_code: string;
  dish_name: string;
  presentation_name: string;
  price: string;
  capacity: number;
  reserved_quantity: number;
  sold_quantity: number;
};

@Injectable()
export class OrdersService {
  constructor(private readonly db: DatabaseService) {}

  private async nextOrderCode(client: PoolClient): Promise<string> {
    const result = await client.query<{ current_value: string; prefix: string; padding: number }>(
      `UPDATE core.business_sequences
       SET current_value=current_value+1, updated_at=NOW()
       WHERE sequence_code='ORDER'
       RETURNING current_value,prefix,padding`,
    );
    const row = result.rows[0];
    if (!row) throw new Error('ORDER sequence missing');
    return `${row.prefix}${String(row.current_value).padStart(row.padding, '0')}`;
  }

  async createScheduled(input: CreateOrderInput) {
    const duplicateDish = input.items.find(
      (item, index) => input.items.findIndex((other) => other.dishCode === item.dishCode) !== index,
    );
    if (duplicateDish) throw new BadRequestException('DUPLICATE_DISH_IN_ORDER');

    const start = new Date(input.deliveryWindowStart);
    const end = new Date(input.deliveryWindowEnd);
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) {
      throw new BadRequestException('INVALID_DELIVERY_WINDOW');
    }
    const minutes = (end.getTime() - start.getTime()) / 60000;
    if (minutes < 30 || minutes > 180) throw new BadRequestException('INVALID_DELIVERY_WINDOW_LENGTH');

    return this.db.transaction(async (client) => {
      const existing = await client.query<{ order_code: string }>(
        `SELECT order_code FROM commerce.orders WHERE client_request_id=$1`,
        [input.clientRequestId],
      );
      if (existing.rows[0]) return this.getWithClient(client, existing.rows[0].order_code);

      const context = await client.query<{
        household_id: string;
        location_id: string;
        market_id: string;
        zone_id: string;
        cpp_id: string;
        timezone: string;
        delivery_fee: string;
        minimum_order: string;
      }>(
        `SELECT h.id household_id,l.id location_id,lc.market_id,lc.zone_id,lc.cpp_id,
                m.timezone,lc.delivery_fee::text,lc.minimum_order::text
         FROM household.households h
         JOIN household.locations l ON l.household_id=h.id AND l.location_code=$2 AND l.is_active=TRUE
         JOIN territory.location_coverage lc ON lc.location_id=l.id AND lc.status_code='ACTIVE' AND lc.is_covered=TRUE
         JOIN territory.markets m ON m.id=lc.market_id
         JOIN territory.service_zones z ON z.id=lc.zone_id AND z.status_code='ACTIVE'
         JOIN operations.cpp c ON c.id=lc.cpp_id AND c.status_code='ACTIVE'
         WHERE h.haid=$1 AND h.is_active=TRUE
         ORDER BY lc.evaluated_at DESC LIMIT 1`,
        [input.haid, input.locationCode],
      );
      const ctx = context.rows[0];
      if (!ctx) throw new NotFoundException('ACTIVE_COVERED_LOCATION_NOT_FOUND');

      const dateCheck = await client.query<{ valid: boolean }>(
        `SELECT (($1::timestamptz AT TIME ZONE $4)::date=$3::date
                 AND ($2::timestamptz AT TIME ZONE $4)::date=$3::date) valid`,
        [input.deliveryWindowStart, input.deliveryWindowEnd, input.serviceDate, ctx.timezone],
      );
      if (!dateCheck.rows[0]?.valid) throw new BadRequestException('WINDOW_OUTSIDE_SERVICE_DATE');
      if (end <= new Date()) throw new BadRequestException('DELIVERY_WINDOW_IN_PAST');

      const menu = await client.query<{ id: string; menu_code: string; order_cutoff_at: Date | null }>(
        `SELECT id,menu_code,order_cutoff_at
         FROM menu.weekly_menus
         WHERE cpp_id=$1 AND status_code='PUBLISHED' AND $2::date BETWEEN starts_on AND ends_on
         ORDER BY published_at DESC LIMIT 1
         FOR UPDATE`,
        [ctx.cpp_id, input.serviceDate],
      );
      const menuRow = menu.rows[0];
      if (!menuRow) throw new NotFoundException('PUBLISHED_MENU_NOT_FOUND');
      if (menuRow.order_cutoff_at && new Date(menuRow.order_cutoff_at) <= new Date()) {
        throw new UnprocessableEntityException('ORDER_CUTOFF_PASSED');
      }

      const lockedItems: MenuItemRow[] = [];
      for (const requested of input.items) {
        const result = await client.query<MenuItemRow>(
          `SELECT i.id,i.dish_id,i.recipe_version_id,d.dish_code,d.name dish_name,
                  i.presentation_name,i.price::text,i.capacity,i.reserved_quantity,i.sold_quantity
           FROM menu.weekly_menu_items i
           JOIN menu.dishes d ON d.id=i.dish_id
           WHERE i.weekly_menu_id=$1 AND i.service_date=$2::date
             AND d.dish_code=$3 AND i.status_code='AVAILABLE'
           FOR UPDATE OF i`,
          [menuRow.id, input.serviceDate, requested.dishCode],
        );
        const item = result.rows[0];
        if (!item) throw new NotFoundException(`MENU_ITEM_NOT_FOUND:${requested.dishCode}`);
        const available = item.capacity - item.reserved_quantity - item.sold_quantity;
        if (requested.quantity > available) {
          throw new ConflictException(`INSUFFICIENT_MENU_CAPACITY:${requested.dishCode}`);
        }
        lockedItems.push(item);
      }

      const subtotal = input.items.reduce((sum, requested) => {
        const item = lockedItems.find((candidate) => candidate.dish_code === requested.dishCode)!;
        return sum + Number(item.price) * requested.quantity;
      }, 0);
      const deliveryFee = Number(ctx.delivery_fee ?? 0);
      const minimumOrder = Number(ctx.minimum_order ?? 0);
      if (subtotal < minimumOrder) {
        throw new UnprocessableEntityException(`MINIMUM_ORDER_NOT_REACHED:${minimumOrder.toFixed(2)}`);
      }
      const total = subtotal + deliveryFee;
      const orderCode = await this.nextOrderCode(client);
      const orderId = randomUUID();

      await client.query(
        `INSERT INTO commerce.orders(
           id,order_code,client_request_id,household_id,location_id,market_id,zone_id,cpp_id,
           weekly_menu_id,service_date,delivery_window_start,delivery_window_end,status_code,
           subtotal,delivery_fee,total,notes,confirmed_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'CONFIRMED',$13,$14,$15,$16,NOW())`,
        [
          orderId,
          orderCode,
          input.clientRequestId,
          ctx.household_id,
          ctx.location_id,
          ctx.market_id,
          ctx.zone_id,
          ctx.cpp_id,
          menuRow.id,
          input.serviceDate,
          input.deliveryWindowStart,
          input.deliveryWindowEnd,
          subtotal.toFixed(2),
          deliveryFee.toFixed(2),
          total.toFixed(2),
          input.notes?.trim() || null,
        ],
      );

      for (const requested of input.items) {
        const item = lockedItems.find((candidate) => candidate.dish_code === requested.dishCode)!;
        const lineTotal = Number(item.price) * requested.quantity;
        await client.query(
          `INSERT INTO commerce.order_items(
             id,order_id,weekly_menu_item_id,dish_id,recipe_version_id,dish_name_snapshot,
             presentation_snapshot,unit_price,quantity,line_total)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            randomUUID(),
            orderId,
            item.id,
            item.dish_id,
            item.recipe_version_id,
            item.dish_name,
            item.presentation_name,
            item.price,
            requested.quantity,
            lineTotal.toFixed(2),
          ],
        );
        await client.query(
          `UPDATE menu.weekly_menu_items
           SET reserved_quantity=reserved_quantity+$2
           WHERE id=$1`,
          [item.id, requested.quantity],
        );
      }

      await client.query(
        `INSERT INTO audit.audit_events(
           id,audit_code,actor_type,actor_id,action_code,module_code,entity_type,entity_id,
           entity_business_code,new_value,result_code,occurred_at)
         VALUES($1,$2,'HOUSEHOLD',$3,'ORDER_CONFIRMED','ORDERS','ORDER',$4,$5,$6,'SUCCESS',NOW())`,
        [
          randomUUID(),
          `AUD-${randomUUID().slice(0, 8)}`,
          ctx.household_id,
          orderId,
          orderCode,
          JSON.stringify({
            haid: input.haid,
            locationCode: input.locationCode,
            serviceDate: input.serviceDate,
            subtotal,
            deliveryFee,
            total,
          }),
        ],
      );
      await client.query(
        `INSERT INTO core.domain_events(
           id,event_code,event_type,event_version,aggregate_type,aggregate_id,
           aggregate_business_code,actor_type,actor_id,payload,status_code,occurred_at)
         VALUES($1,$2,'order.confirmed',1,'ORDER',$3,$4,'HOUSEHOLD',$5,$6,'PENDING',NOW())`,
        [
          randomUUID(),
          `EVT-${randomUUID().slice(0, 8)}`,
          orderId,
          orderCode,
          ctx.household_id,
          JSON.stringify({ orderCode, haid: input.haid, cppId: ctx.cpp_id, serviceDate: input.serviceDate }),
        ],
      );

      return this.getWithClient(client, orderCode);
    });
  }

  async listForHousehold(haid: string) {
    const result = await this.db.query(
      `SELECT o.order_code,o.service_date,o.delivery_window_start,o.delivery_window_end,
              o.status_code,o.subtotal::text,o.delivery_fee::text,o.total::text,
              l.location_code,l.alias location_alias,c.cpp_code
       FROM commerce.orders o
       JOIN household.households h ON h.id=o.household_id
       JOIN household.locations l ON l.id=o.location_id
       JOIN operations.cpp c ON c.id=o.cpp_id
       WHERE h.haid=$1
       ORDER BY o.created_at DESC`,
      [haid],
    );
    return {
      success: true,
      data: result.rows.map((row: any) => ({
        orderCode: row.order_code,
        serviceDate: row.service_date,
        deliveryWindowStart: row.delivery_window_start,
        deliveryWindowEnd: row.delivery_window_end,
        status: row.status_code,
        subtotal: Number(row.subtotal),
        deliveryFee: Number(row.delivery_fee),
        total: Number(row.total),
        locationCode: row.location_code,
        locationAlias: row.location_alias,
        cppCode: row.cpp_code,
      })),
      meta: { timestamp: new Date().toISOString() },
    };
  }

  async get(orderCode: string) {
    return this.db.transaction((client) => this.getWithClient(client, orderCode));
  }

  private async getWithClient(client: PoolClient, orderCode: string) {
    const order = await client.query(
      `SELECT o.id,o.order_code,o.service_date,o.delivery_window_start,o.delivery_window_end,
              o.status_code,o.subtotal::text,o.delivery_fee::text,o.total::text,o.notes,
              h.haid,l.location_code,l.alias location_alias,c.cpp_code,z.zone_code
       FROM commerce.orders o
       JOIN household.households h ON h.id=o.household_id
       JOIN household.locations l ON l.id=o.location_id
       JOIN operations.cpp c ON c.id=o.cpp_id
       JOIN territory.service_zones z ON z.id=o.zone_id
       WHERE o.order_code=$1`,
      [orderCode],
    );
    const row: any = order.rows[0];
    if (!row) throw new NotFoundException('ORDER_NOT_FOUND');
    const items = await client.query(
      `SELECT dish_name_snapshot,presentation_snapshot,unit_price::text,quantity,line_total::text
       FROM commerce.order_items WHERE order_id=$1 ORDER BY created_at`,
      [row.id],
    );
    return {
      success: true,
      data: {
        orderCode: row.order_code,
        haid: row.haid,
        locationCode: row.location_code,
        locationAlias: row.location_alias,
        cppCode: row.cpp_code,
        zoneCode: row.zone_code,
        serviceDate: row.service_date,
        deliveryWindowStart: row.delivery_window_start,
        deliveryWindowEnd: row.delivery_window_end,
        status: row.status_code,
        subtotal: Number(row.subtotal),
        deliveryFee: Number(row.delivery_fee),
        total: Number(row.total),
        notes: row.notes,
        items: items.rows.map((item: any) => ({
          name: item.dish_name_snapshot,
          presentation: item.presentation_snapshot,
          unitPrice: Number(item.unit_price),
          quantity: item.quantity,
          lineTotal: Number(item.line_total),
        })),
      },
      meta: { timestamp: new Date().toISOString() },
    };
  }
}
