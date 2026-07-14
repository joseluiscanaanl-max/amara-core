import { BadRequestException, ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PoolClient } from 'pg';
import { DatabaseService } from '../../common/database.service';

type RouteListInput = { cppCode?: string; serviceDate?: string; status?: string };
type CreateRouteInput = {
  cppCode: string; serviceDate: string; deliveryWindowStart: string; deliveryWindowEnd: string;
  hostUserCode?: string; vehicleCode?: string; maxStops?: number; orderCodes?: string[]; notes?: string;
};
type AddStopInput = { orderCode: string; stopSequence?: number; estimatedArrivalAt?: string };
type PublishInput = { hostUserCode?: string; vehicleCode?: string };
type ArriveInput = { latitude?: number; longitude?: number; waitingMinutes?: number; notes?: string };
type CompleteInput = { receiverName: string; receiverType: string; latitude?: number; longitude?: number; evidence?: Record<string, unknown>; notes?: string };
type FailInput = { reasonCode: string; notes: string; evidence?: Record<string, unknown> };
type IncidentInput = { categoryCode: string; severity: string; description: string; evidence?: Record<string, unknown>; reportedByUserCode?: string };

@Injectable()
export class LogisticsService {
  constructor(private readonly db: DatabaseService) {}

  private assertDate(value: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException('INVALID_SERVICE_DATE');
  }

  private assertWindow(startValue: string, endValue: string) {
    const start = new Date(startValue); const end = new Date(endValue);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      throw new BadRequestException('INVALID_DELIVERY_WINDOW');
    }
  }

  private async nextCode(client: PoolClient, sequenceCode: string): Promise<string> {
    const result = await client.query<{ current_value: string; prefix: string; padding: number }>(
      `UPDATE core.business_sequences SET current_value=current_value+1,updated_at=NOW()
       WHERE sequence_code=$1 RETURNING current_value,prefix,padding`, [sequenceCode],
    );
    const row = result.rows[0]; if (!row) throw new Error(`${sequenceCode} sequence missing`);
    return `${row.prefix}${String(row.current_value).padStart(row.padding, '0')}`;
  }

  private async resolveUser(client: PoolClient, userCode?: string): Promise<string | null> {
    if (!userCode) return null;
    const result = await client.query<{ id: string }>(
      `SELECT id FROM core.internal_users WHERE user_code=$1 AND is_active=TRUE`, [userCode],
    );
    if (!result.rows[0]) throw new NotFoundException('LOGISTICS_USER_NOT_FOUND');
    return result.rows[0].id;
  }

  private async resolveVehicle(client: PoolClient, cppId: string, vehicleCode?: string): Promise<string | null> {
    if (!vehicleCode) return null;
    const result = await client.query<{ id: string; capacity_orders: number }>(
      `SELECT id,capacity_orders FROM logistics.vehicles
       WHERE vehicle_code=$1 AND cpp_id=$2 AND status_code='ACTIVE'`, [vehicleCode, cppId],
    );
    if (!result.rows[0]) throw new NotFoundException('VEHICLE_NOT_FOUND');
    return result.rows[0].id;
  }

  async createRoute(input: CreateRouteInput) {
    this.assertDate(input.serviceDate); this.assertWindow(input.deliveryWindowStart, input.deliveryWindowEnd);
    return this.db.transaction(async (client) => {
      const cppResult = await client.query<{ id: string }>(
        `SELECT id FROM operations.cpp WHERE cpp_code=$1 AND status_code='ACTIVE'`, [input.cppCode],
      );
      const cpp = cppResult.rows[0]; if (!cpp) throw new NotFoundException('CPP_NOT_FOUND');
      const hostId = await this.resolveUser(client, input.hostUserCode);
      const vehicleId = await this.resolveVehicle(client, cpp.id, input.vehicleCode);
      const routeId = randomUUID(); const routeCode = await this.nextCode(client, 'ROUTE');
      await client.query(
        `INSERT INTO logistics.routes(id,route_code,cpp_id,service_date,delivery_window_start,delivery_window_end,
          host_user_id,vehicle_id,max_stops,status_code,notes)
         VALUES($1,$2,$3,$4::date,$5::timestamptz,$6::timestamptz,$7,$8,$9,'DRAFT',$10)`,
        [routeId, routeCode, cpp.id, input.serviceDate, input.deliveryWindowStart, input.deliveryWindowEnd,
          hostId, vehicleId, input.maxStops ?? 20, input.notes ?? null],
      );
      for (const orderCode of input.orderCodes ?? []) await this.addStopWithClient(client, routeCode, { orderCode });
      await this.auditAndEvent(client, { action: 'ROUTE_CREATED', eventType: 'logistics.route_created', entityType: 'ROUTE', entityId: routeId, businessCode: routeCode,
        payload: { routeCode, cppCode: input.cppCode, serviceDate: input.serviceDate } });
      return this.getRouteWithClient(client, routeCode);
    });
  }

  async listRoutes(input: RouteListInput) {
    if (input.serviceDate) this.assertDate(input.serviceDate);
    return this.db.transaction(async (client) => {
      const params: unknown[] = []; const filters: string[] = [];
      const add = (fragment: string, value: unknown) => { params.push(value); filters.push(fragment.replace('?', `$${params.length}`)); };
      if (input.cppCode) add('c.cpp_code=?', input.cppCode);
      if (input.serviceDate) add('r.service_date=?::date', input.serviceDate);
      if (input.status) add('r.status_code=?', input.status);
      const result = await client.query(
        `SELECT r.route_code,r.service_date,r.delivery_window_start,r.delivery_window_end,r.status_code,
                r.max_stops,r.started_at,r.completed_at,c.cpp_code,u.user_code host_user_code,v.vehicle_code,
                COUNT(s.id)::int stop_count,
                COUNT(s.id) FILTER (WHERE s.status_code='DELIVERED')::int delivered_count,
                COUNT(s.id) FILTER (WHERE s.status_code='FAILED')::int failed_count
         FROM logistics.routes r JOIN operations.cpp c ON c.id=r.cpp_id
         LEFT JOIN core.internal_users u ON u.id=r.host_user_id
         LEFT JOIN logistics.vehicles v ON v.id=r.vehicle_id
         LEFT JOIN logistics.route_stops s ON s.route_id=r.id
         ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}
         GROUP BY r.id,c.cpp_code,u.user_code,v.vehicle_code ORDER BY r.service_date,r.delivery_window_start,r.route_code`, params,
      );
      return { success: true, data: result.rows.map((r: any) => ({ routeCode: r.route_code, cppCode: r.cpp_code,
        serviceDate: r.service_date, deliveryWindowStart: r.delivery_window_start, deliveryWindowEnd: r.delivery_window_end,
        status: r.status_code, hostUserCode: r.host_user_code, vehicleCode: r.vehicle_code, maxStops: r.max_stops,
        stopCount: Number(r.stop_count), deliveredCount: Number(r.delivered_count), failedCount: Number(r.failed_count),
        startedAt: r.started_at, completedAt: r.completed_at })), meta: { timestamp: new Date().toISOString() } };
    });
  }

  async getRoute(code: string) { return this.db.transaction((client) => this.getRouteWithClient(client, code)); }

  async addStop(code: string, input: AddStopInput) {
    return this.db.transaction((client) => this.addStopWithClient(client, code, input));
  }

  private async addStopWithClient(client: PoolClient, code: string, input: AddStopInput) {
    const routeResult = await client.query<{ id: string; cpp_id: string; service_date: string; status_code: string; max_stops: number; delivery_window_start: string; delivery_window_end: string }>(
      `SELECT id,cpp_id,service_date,status_code,max_stops,delivery_window_start,delivery_window_end
       FROM logistics.routes WHERE route_code=$1 FOR UPDATE`, [code],
    );
    const route = routeResult.rows[0]; if (!route) throw new NotFoundException('ROUTE_NOT_FOUND');
    if (route.status_code !== 'DRAFT') throw new ConflictException('ROUTE_NOT_EDITABLE');
    const count = await client.query<{ count: number; max_sequence: number }>(
      `SELECT COUNT(*)::int count,COALESCE(MAX(stop_sequence),0)::int max_sequence FROM logistics.route_stops WHERE route_id=$1`, [route.id],
    );
    if (Number(count.rows[0].count) >= Number(route.max_stops)) throw new UnprocessableEntityException('ROUTE_CAPACITY_EXCEEDED');
    const orderResult = await client.query<any>(
      `SELECT o.id,o.household_id,o.location_id,o.cpp_id,o.service_date,o.delivery_window_start,o.delivery_window_end,o.status_code,
              po.id packing_order_id,po.status_code packing_status
       FROM commerce.orders o JOIN packing.packing_orders po ON po.order_id=o.id
       WHERE o.order_code=$1 FOR UPDATE OF o,po`, [input.orderCode],
    );
    const order = orderResult.rows[0]; if (!order) throw new NotFoundException('ORDER_NOT_FOUND');
    if (order.packing_status !== 'READY_FOR_LOGISTICS' || order.status_code !== 'PACKED') throw new ConflictException('ORDER_NOT_READY_FOR_LOGISTICS');
    if (order.cpp_id !== route.cpp_id || String(order.service_date).slice(0,10) !== String(route.service_date).slice(0,10)) {
      throw new UnprocessableEntityException('ORDER_ROUTE_SCOPE_MISMATCH');
    }
    const orderStart = new Date(order.delivery_window_start); const orderEnd = new Date(order.delivery_window_end);
    const routeStart = new Date(route.delivery_window_start); const routeEnd = new Date(route.delivery_window_end);
    if (orderStart < routeStart || orderEnd > routeEnd) throw new UnprocessableEntityException('ORDER_OUTSIDE_ROUTE_WINDOW');
    const stopId = randomUUID(); const deliveryId = randomUUID(); const deliveryCode = await this.nextCode(client, 'DELIVERY');
    const sequence = input.stopSequence ?? Number(count.rows[0].max_sequence) + 1;
    await client.query(
      `INSERT INTO logistics.route_stops(id,route_id,order_id,packing_order_id,location_id,stop_sequence,estimated_arrival_at,status_code)
       VALUES($1,$2,$3,$4,$5,$6,$7::timestamptz,'ASSIGNED')`,
      [stopId, route.id, order.id, order.packing_order_id, order.location_id, sequence, input.estimatedArrivalAt ?? null],
    );
    await client.query(
      `INSERT INTO logistics.deliveries(id,delivery_code,route_stop_id,order_id,household_id,location_id,cpp_id,status_code)
       VALUES($1,$2,$3,$4,$5,$6,$7,'ASSIGNED')`,
      [deliveryId, deliveryCode, stopId, order.id, order.household_id, order.location_id, order.cpp_id],
    );
    await client.query(`UPDATE commerce.orders SET status_code='ASSIGNED_TO_ROUTE',updated_at=NOW(),version=version+1 WHERE id=$1`, [order.id]);
    await this.auditAndEvent(client, { action: 'ROUTE_STOP_ADDED', eventType: 'logistics.stop_added', entityType: 'ROUTE_STOP', entityId: stopId,
      businessCode: code, payload: { routeCode: code, orderCode: input.orderCode, deliveryCode, stopSequence: sequence } });
    return this.getRouteWithClient(client, code);
  }

  async publishRoute(code: string, input: PublishInput) {
    return this.db.transaction(async (client) => {
      const routeResult = await client.query<{ id: string; cpp_id: string; status_code: string }>(
        `SELECT id,cpp_id,status_code FROM logistics.routes WHERE route_code=$1 FOR UPDATE`, [code],
      );
      const route = routeResult.rows[0]; if (!route) throw new NotFoundException('ROUTE_NOT_FOUND');
      if (route.status_code !== 'DRAFT') throw new ConflictException('ROUTE_NOT_PUBLISHABLE');
      const stops = await client.query<{ count: number }>(`SELECT COUNT(*)::int count FROM logistics.route_stops WHERE route_id=$1`, [route.id]);
      if (Number(stops.rows[0].count) === 0) throw new UnprocessableEntityException('ROUTE_HAS_NO_STOPS');
      const hostId = await this.resolveUser(client, input.hostUserCode);
      const vehicleId = await this.resolveVehicle(client, route.cpp_id, input.vehicleCode);
      await client.query(
        `UPDATE logistics.routes SET status_code='PUBLISHED',host_user_id=COALESCE($2,host_user_id),vehicle_id=COALESCE($3,vehicle_id),
         published_at=NOW(),updated_at=NOW(),version=version+1 WHERE id=$1`, [route.id, hostId, vehicleId],
      );
      await this.auditAndEvent(client, { action: 'ROUTE_PUBLISHED', eventType: 'logistics.route_published', entityType: 'ROUTE', entityId: route.id,
        businessCode: code, payload: { routeCode: code } });
      return this.getRouteWithClient(client, code);
    });
  }

  async startRoute(code: string) {
    return this.db.transaction(async (client) => {
      const result = await client.query<{ id: string; status_code: string }>(
        `SELECT id,status_code FROM logistics.routes WHERE route_code=$1 FOR UPDATE`, [code],
      );
      const route = result.rows[0]; if (!route) throw new NotFoundException('ROUTE_NOT_FOUND');
      if (route.status_code !== 'PUBLISHED') throw new ConflictException('ROUTE_NOT_STARTABLE');
      await client.query(`UPDATE logistics.routes SET status_code='IN_PROGRESS',started_at=NOW(),updated_at=NOW(),version=version+1 WHERE id=$1`, [route.id]);
      await client.query(`UPDATE logistics.route_stops SET status_code='IN_ROUTE',updated_at=NOW(),version=version+1 WHERE route_id=$1 AND status_code='ASSIGNED'`, [route.id]);
      await client.query(`UPDATE logistics.deliveries d SET status_code='IN_TRANSIT',departure_at=NOW(),updated_at=NOW(),version=version+1 FROM logistics.route_stops s WHERE d.route_stop_id=s.id AND s.route_id=$1`, [route.id]);
      await client.query(`UPDATE commerce.orders o SET status_code='IN_TRANSIT',updated_at=NOW(),version=version+1 FROM logistics.route_stops s WHERE s.order_id=o.id AND s.route_id=$1`, [route.id]);
      await client.query(`UPDATE packing.packing_orders po SET status_code='DISPATCHED',updated_at=NOW(),version=version+1 FROM logistics.route_stops s WHERE s.packing_order_id=po.id AND s.route_id=$1`, [route.id]);
      await this.auditAndEvent(client, { action: 'ROUTE_STARTED', eventType: 'logistics.route_started', entityType: 'ROUTE', entityId: route.id,
        businessCode: code, payload: { routeCode: code } });
      return this.getRouteWithClient(client, code);
    });
  }

  async arrive(code: string, stopId: string, input: ArriveInput) {
    return this.db.transaction(async (client) => {
      const stop = await this.lockStop(client, code, stopId);
      if (!['IN_ROUTE', 'ASSIGNED'].includes(stop.status_code)) throw new ConflictException('STOP_NOT_ARRIVABLE');
      await client.query(`UPDATE logistics.route_stops SET status_code='ARRIVED',arrived_at=NOW(),waiting_minutes=$2,notes=COALESCE($3,notes),updated_at=NOW(),version=version+1 WHERE id=$1`,
        [stop.id, input.waitingMinutes ?? 0, input.notes ?? null]);
      await client.query(`UPDATE logistics.deliveries SET status_code='ARRIVED',arrival_at=NOW(),arrival_latitude=$2,arrival_longitude=$3,updated_at=NOW(),version=version+1 WHERE route_stop_id=$1`,
        [stop.id, input.latitude ?? null, input.longitude ?? null]);
      await this.auditAndEvent(client, { action: 'DELIVERY_ARRIVED', eventType: 'logistics.delivery_arrived', entityType: 'ROUTE_STOP', entityId: stop.id,
        businessCode: code, payload: { routeCode: code, stopId, latitude: input.latitude ?? null, longitude: input.longitude ?? null } });
      return this.getRouteWithClient(client, code);
    });
  }

  async completeDelivery(code: string, stopId: string, input: CompleteInput) {
    return this.db.transaction(async (client) => {
      const stop = await this.lockStop(client, code, stopId);
      if (!['ARRIVED', 'IN_ROUTE'].includes(stop.status_code)) throw new ConflictException('STOP_NOT_COMPLETABLE');
      await client.query(`UPDATE logistics.route_stops SET status_code='DELIVERED',completed_at=NOW(),notes=COALESCE($2,notes),updated_at=NOW(),version=version+1 WHERE id=$1`, [stop.id, input.notes ?? null]);
      await client.query(`UPDATE logistics.deliveries SET status_code='DELIVERED',delivered_at=NOW(),delivery_latitude=$2,delivery_longitude=$3,
        receiver_name=$4,receiver_type_code=$5,evidence=$6::jsonb,updated_at=NOW(),version=version+1 WHERE route_stop_id=$1`,
        [stop.id, input.latitude ?? null, input.longitude ?? null, input.receiverName, input.receiverType, JSON.stringify(input.evidence ?? {})]);
      await client.query(`UPDATE commerce.orders SET status_code='DELIVERED',updated_at=NOW(),version=version+1 WHERE id=$1`, [stop.order_id]);
      await this.auditAndEvent(client, { action: 'DELIVERY_COMPLETED', eventType: 'logistics.delivery_completed', entityType: 'DELIVERY', entityId: stop.delivery_id,
        businessCode: stop.delivery_code, payload: { routeCode: code, stopId, deliveryCode: stop.delivery_code, receiverType: input.receiverType } });
      await this.finishRouteIfFinal(client, stop.route_id);
      return this.getRouteWithClient(client, code);
    });
  }

  async failDelivery(code: string, stopId: string, input: FailInput) {
    return this.db.transaction(async (client) => {
      const stop = await this.lockStop(client, code, stopId);
      if (['DELIVERED', 'FAILED'].includes(stop.status_code)) throw new ConflictException('STOP_ALREADY_FINAL');
      await client.query(`UPDATE logistics.route_stops SET status_code='FAILED',completed_at=NOW(),notes=$2,updated_at=NOW(),version=version+1 WHERE id=$1`, [stop.id, input.notes]);
      await client.query(`UPDATE logistics.deliveries SET status_code='FAILED',failure_reason_code=$2,failure_notes=$3,evidence=$4::jsonb,updated_at=NOW(),version=version+1 WHERE route_stop_id=$1`,
        [stop.id, input.reasonCode, input.notes, JSON.stringify(input.evidence ?? {})]);
      await client.query(`UPDATE commerce.orders SET status_code='DELIVERY_FAILED',updated_at=NOW(),version=version+1 WHERE id=$1`, [stop.order_id]);
      await this.auditAndEvent(client, { action: 'DELIVERY_FAILED', eventType: 'logistics.delivery_failed', entityType: 'DELIVERY', entityId: stop.delivery_id,
        businessCode: stop.delivery_code, payload: { routeCode: code, stopId, deliveryCode: stop.delivery_code, reasonCode: input.reasonCode } });
      await this.finishRouteIfFinal(client, stop.route_id);
      return this.getRouteWithClient(client, code);
    });
  }

  async reportIncident(code: string, stopId: string, input: IncidentInput) {
    return this.db.transaction(async (client) => {
      const stop = await this.lockStop(client, code, stopId);
      const userId = await this.resolveUser(client, input.reportedByUserCode);
      const incidentCode = await this.nextCode(client, 'DELIVERY_INCIDENT');
      const incidentId = randomUUID();
      await client.query(`INSERT INTO logistics.delivery_incidents(id,incident_code,delivery_id,category_code,severity_code,description,evidence,reported_by)
        VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`,
        [incidentId, incidentCode, stop.delivery_id, input.categoryCode, input.severity, input.description, JSON.stringify(input.evidence ?? {}), userId]);
      await this.auditAndEvent(client, { action: 'DELIVERY_INCIDENT_REPORTED', eventType: 'logistics.delivery_incident_reported', entityType: 'DELIVERY_INCIDENT', entityId: incidentId,
        businessCode: incidentCode, payload: { routeCode: code, stopId, incidentCode, categoryCode: input.categoryCode, severity: input.severity } });
      return { success: true, data: { incidentCode, status: 'OPEN' }, meta: { timestamp: new Date().toISOString() } };
    });
  }

  private async lockStop(client: PoolClient, routeCode: string, stopId: string) {
    const result = await client.query<any>(
      `SELECT s.id,s.route_id,s.order_id,s.status_code,d.id delivery_id,d.delivery_code,r.status_code route_status
       FROM logistics.route_stops s JOIN logistics.routes r ON r.id=s.route_id
       JOIN logistics.deliveries d ON d.route_stop_id=s.id
       WHERE r.route_code=$1 AND s.id=$2::uuid FOR UPDATE OF s,d,r`, [routeCode, stopId],
    );
    const row = result.rows[0]; if (!row) throw new NotFoundException('ROUTE_STOP_NOT_FOUND');
    if (row.route_status !== 'IN_PROGRESS') throw new ConflictException('ROUTE_NOT_IN_PROGRESS');
    return row;
  }

  private async finishRouteIfFinal(client: PoolClient, routeId: string) {
    const result = await client.query<{ pending: number }>(
      `SELECT COUNT(*) FILTER (WHERE status_code NOT IN ('DELIVERED','FAILED'))::int pending FROM logistics.route_stops WHERE route_id=$1`, [routeId],
    );
    if (Number(result.rows[0]?.pending ?? 0) === 0) {
      await client.query(`UPDATE logistics.routes SET status_code='COMPLETED',completed_at=NOW(),updated_at=NOW(),version=version+1 WHERE id=$1`, [routeId]);
    }
  }

  private async getRouteWithClient(client: PoolClient, code: string) {
    const header = await client.query<any>(
      `SELECT r.id,r.route_code,r.service_date,r.delivery_window_start,r.delivery_window_end,r.status_code,r.max_stops,
              r.published_at,r.started_at,r.completed_at,r.notes,c.cpp_code,u.user_code host_user_code,v.vehicle_code
       FROM logistics.routes r JOIN operations.cpp c ON c.id=r.cpp_id
       LEFT JOIN core.internal_users u ON u.id=r.host_user_id LEFT JOIN logistics.vehicles v ON v.id=r.vehicle_id
       WHERE r.route_code=$1`, [code],
    );
    const route = header.rows[0]; if (!route) throw new NotFoundException('ROUTE_NOT_FOUND');
    const stops = await client.query<any>(
      `SELECT s.id stop_id,s.stop_sequence,s.estimated_arrival_at,s.arrived_at,s.completed_at,s.status_code,s.waiting_minutes,s.notes,
              d.delivery_code,d.status_code delivery_status,d.receiver_name,d.receiver_type_code,d.failure_reason_code,d.failure_notes,
              o.order_code,h.haid,h.household_name,l.location_code,l.alias location_alias,l.street,l.exterior_number,l.interior_number,
              l.colony_name,l.postal_code,l.city,l.state_name,l.references_text,l.access_latitude,l.access_longitude,
              COALESCE((SELECT json_agg(json_build_object('incidentCode',i.incident_code,'categoryCode',i.category_code,'severity',i.severity_code,
                'description',i.description,'status',i.status_code,'reportedAt',i.reported_at) ORDER BY i.reported_at)
                FROM logistics.delivery_incidents i WHERE i.delivery_id=d.id),'[]'::json) incidents
       FROM logistics.route_stops s JOIN logistics.deliveries d ON d.route_stop_id=s.id
       JOIN commerce.orders o ON o.id=s.order_id JOIN household.households h ON h.id=o.household_id
       JOIN household.locations l ON l.id=s.location_id WHERE s.route_id=$1 ORDER BY s.stop_sequence`, [route.id],
    );
    return { success: true, data: { routeCode: route.route_code, cppCode: route.cpp_code, serviceDate: route.service_date,
      deliveryWindowStart: route.delivery_window_start, deliveryWindowEnd: route.delivery_window_end, status: route.status_code,
      hostUserCode: route.host_user_code, vehicleCode: route.vehicle_code, maxStops: route.max_stops,
      publishedAt: route.published_at, startedAt: route.started_at, completedAt: route.completed_at, notes: route.notes,
      stops: stops.rows.map((s: any) => ({ stopId: s.stop_id, sequence: s.stop_sequence, orderCode: s.order_code,
        deliveryCode: s.delivery_code, status: s.status_code, deliveryStatus: s.delivery_status, estimatedArrivalAt: s.estimated_arrival_at,
        arrivedAt: s.arrived_at, completedAt: s.completed_at, waitingMinutes: s.waiting_minutes, haid: s.haid,
        householdName: s.household_name, receiverName: s.receiver_name, receiverType: s.receiver_type_code,
        failureReasonCode: s.failure_reason_code, failureNotes: s.failure_notes, incidents: s.incidents,
        location: { code: s.location_code, alias: s.location_alias, street: s.street, exteriorNumber: s.exterior_number,
          interiorNumber: s.interior_number, neighborhood: s.colony_name, postalCode: s.postal_code, city: s.city,
          stateName: s.state_name, references: s.references_text, accessLatitude: s.access_latitude, accessLongitude: s.access_longitude } }))
    }, meta: { timestamp: new Date().toISOString() } };
  }

  private async auditAndEvent(client: PoolClient, input: { action: string; eventType: string; entityType: string; entityId: string; businessCode: string; payload: Record<string, unknown> }) {
    await client.query(`INSERT INTO audit.audit_events(id,audit_code,actor_type,action_code,module_code,entity_type,entity_id,entity_business_code,new_value,result_code,occurred_at)
      VALUES($1,$2,'SYSTEM',$3,'LOGISTICS',$4,$5,$6,$7,'SUCCESS',NOW())`,
      [randomUUID(), `AUD-${randomUUID()}`, input.action, input.entityType, input.entityId, input.businessCode, JSON.stringify(input.payload)]);
    await client.query(`INSERT INTO core.domain_events(id,event_code,event_type,event_version,aggregate_type,aggregate_id,aggregate_business_code,payload,status_code,occurred_at)
      VALUES($1,$2,$3,1,$4,$5,$6,$7,'PENDING',NOW())`,
      [randomUUID(), `EVT-${randomUUID()}`, input.eventType, input.entityType, input.entityId, input.businessCode, JSON.stringify(input.payload)]);
  }
}
