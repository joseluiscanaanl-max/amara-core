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

type ListLotsInput = { cppCode?: string; serviceDate?: string; status?: string };
type OpenInspectionInput = { inspectorUserCode?: string };
type RecordCheckInput = {
  checkCode: string;
  result: 'PASS' | 'FAIL' | 'NOT_APPLICABLE';
  numericValue?: number;
  textValue?: string;
  unitCode?: string;
  notes?: string;
  evidence?: Record<string, unknown>;
  checkedByUserCode?: string;
};
type DecideInput = {
  decision: 'APPROVE' | 'PARTIAL_RELEASE' | 'REJECT' | 'HOLD';
  approvedQuantity?: number;
  rejectedQuantity?: number;
  reason?: string;
  inspectorUserCode?: string;
};

@Injectable()
export class QualityService {
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
    if (!result.rows[0]) throw new NotFoundException('QUALITY_USER_NOT_FOUND');
    return result.rows[0].id;
  }

  async listLots(input: ListLotsInput) {
    if (input.serviceDate && !/^\d{4}-\d{2}-\d{2}$/.test(input.serviceDate)) {
      throw new BadRequestException('INVALID_SERVICE_DATE');
    }
    return this.db.transaction(async (client) => {
      const params: unknown[] = [];
      const filters: string[] = [];
      const add = (fragment: string, value: unknown) => {
        params.push(value);
        filters.push(fragment.replace('?', `$${params.length}`));
      };
      if (input.cppCode) add('c.cpp_code=?', input.cppCode);
      if (input.serviceDate) add('pl.service_date=?::date', input.serviceDate);
      if (input.status) add('pl.status_code=?', input.status);
      else filters.push(`pl.status_code IN ('PENDING_QUALITY','IN_QUALITY','ON_HOLD','PARTIALLY_RELEASED','APPROVED','REJECTED')`);

      const result = await client.query(
        `SELECT pl.lot_code,pl.service_date,pl.quantity_produced,pl.quantity_available,
                pl.quantity_rejected,pl.status_code,pl.produced_at,pl.expires_at,
                po.production_order_code,po.dish_code,po.dish_name_snapshot,
                po.presentation_snapshot,c.cpp_code,
                qi.inspection_code,qi.status_code inspection_status,qi.decision_code
         FROM production.production_lots pl
         JOIN production.production_orders po ON po.id=pl.production_order_id
         JOIN operations.cpp c ON c.id=pl.cpp_id
         LEFT JOIN LATERAL (
           SELECT inspection_code,status_code,decision_code
           FROM quality.inspections
           WHERE lot_id=pl.id
           ORDER BY opened_at DESC LIMIT 1
         ) qi ON TRUE
         ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''}
         ORDER BY pl.service_date,po.dish_name_snapshot,pl.produced_at`,
        params,
      );
      return {
        success: true,
        data: result.rows.map((row: any) => this.mapLot(row)),
        meta: { timestamp: new Date().toISOString() },
      };
    });
  }

  async getLot(lotCode: string) {
    return this.db.transaction((client) => this.getLotWithClient(client, lotCode));
  }

  async openInspection(lotCode: string, input: OpenInspectionInput) {
    return this.db.transaction(async (client) => {
      const lotResult = await client.query<{ id: string; cpp_id: string; status_code: string }>(
        `SELECT id,cpp_id,status_code FROM production.production_lots
         WHERE lot_code=$1 FOR UPDATE`,
        [lotCode],
      );
      const lot = lotResult.rows[0];
      if (!lot) throw new NotFoundException('PRODUCTION_LOT_NOT_FOUND');
      if (!['PENDING_QUALITY', 'ON_HOLD'].includes(lot.status_code)) {
        throw new ConflictException('LOT_NOT_AVAILABLE_FOR_INSPECTION');
      }

      const existing = await client.query<{ inspection_code: string }>(
        `SELECT inspection_code FROM quality.inspections
         WHERE lot_id=$1 AND status_code IN ('OPEN','ON_HOLD')
         ORDER BY opened_at DESC LIMIT 1`,
        [lot.id],
      );
      if (existing.rows[0]) return this.getInspectionWithClient(client, existing.rows[0].inspection_code);

      const inspectorId = await this.resolveUser(client, input.inspectorUserCode);
      const inspectionCode = await this.nextCode(client, 'QUALITY_INSPECTION');
      const inspectionId = randomUUID();
      await client.query(
        `INSERT INTO quality.inspections(
           id,inspection_code,lot_id,cpp_id,status_code,inspector_user_id)
         VALUES($1,$2,$3,$4,'OPEN',$5)`,
        [inspectionId, inspectionCode, lot.id, lot.cpp_id, inspectorId],
      );
      await client.query(
        `UPDATE production.production_lots
         SET status_code='IN_QUALITY',updated_at=NOW(),version=version+1
         WHERE id=$1`,
        [lot.id],
      );
      await this.auditAndEvent(client, {
        action: 'QUALITY_INSPECTION_OPENED',
        eventType: 'quality.inspection_opened',
        entityType: 'QUALITY_INSPECTION',
        entityId: inspectionId,
        businessCode: inspectionCode,
        payload: { inspectionCode, lotCode, inspectorUserCode: input.inspectorUserCode ?? null },
      });
      return this.getInspectionWithClient(client, inspectionCode);
    });
  }

  async getInspection(inspectionCode: string) {
    return this.db.transaction((client) => this.getInspectionWithClient(client, inspectionCode));
  }

  async recordCheck(inspectionCode: string, input: RecordCheckInput) {
    return this.db.transaction(async (client) => {
      const inspectionResult = await client.query<{ id: string; status_code: string }>(
        `SELECT id,status_code FROM quality.inspections
         WHERE inspection_code=$1 FOR UPDATE`,
        [inspectionCode],
      );
      const inspection = inspectionResult.rows[0];
      if (!inspection) throw new NotFoundException('QUALITY_INSPECTION_NOT_FOUND');
      if (!['OPEN', 'ON_HOLD'].includes(inspection.status_code)) throw new ConflictException('QUALITY_INSPECTION_NOT_EDITABLE');

      const definitionResult = await client.query<{
        id: string;
        value_type: string;
        unit_code: string | null;
        is_mandatory: boolean;
      }>(
        `SELECT id,value_type,unit_code,is_mandatory
         FROM quality.checklist_definitions
         WHERE check_code=$1 AND is_active=TRUE`,
        [input.checkCode],
      );
      const definition = definitionResult.rows[0];
      if (!definition) throw new NotFoundException('QUALITY_CHECK_NOT_FOUND');
      if (definition.is_mandatory && input.result === 'NOT_APPLICABLE') {
        throw new UnprocessableEntityException('MANDATORY_CHECK_CANNOT_BE_NOT_APPLICABLE');
      }
      if (definition.value_type === 'NUMERIC' && input.numericValue === undefined) {
        throw new BadRequestException('NUMERIC_VALUE_REQUIRED');
      }

      const checkedBy = await this.resolveUser(client, input.checkedByUserCode);
      await client.query(
        `INSERT INTO quality.inspection_checks(
           id,inspection_id,checklist_definition_id,result_code,numeric_value,text_value,
           unit_code,notes,evidence,checked_by,checked_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
         ON CONFLICT (inspection_id,checklist_definition_id)
         DO UPDATE SET result_code=EXCLUDED.result_code,numeric_value=EXCLUDED.numeric_value,
           text_value=EXCLUDED.text_value,unit_code=EXCLUDED.unit_code,notes=EXCLUDED.notes,
           evidence=EXCLUDED.evidence,checked_by=EXCLUDED.checked_by,checked_at=NOW(),
           version=quality.inspection_checks.version+1`,
        [
          randomUUID(), inspection.id, definition.id, input.result,
          input.numericValue ?? null, input.textValue ?? null,
          input.unitCode ?? definition.unit_code, input.notes ?? null,
          JSON.stringify(input.evidence ?? {}), checkedBy,
        ],
      );
      await this.auditAndEvent(client, {
        action: 'QUALITY_CHECK_RECORDED',
        eventType: 'quality.check_recorded',
        entityType: 'QUALITY_INSPECTION',
        entityId: inspection.id,
        businessCode: inspectionCode,
        payload: { inspectionCode, checkCode: input.checkCode, result: input.result },
      });
      return this.getInspectionWithClient(client, inspectionCode);
    });
  }

  async decide(inspectionCode: string, input: DecideInput) {
    return this.db.transaction(async (client) => {
      const result = await client.query<{
        id: string;
        lot_id: string;
        status_code: string;
        lot_code: string;
        quantity_produced: number;
      }>(
        `SELECT qi.id,qi.lot_id,qi.status_code,pl.lot_code,pl.quantity_produced
         FROM quality.inspections qi
         JOIN production.production_lots pl ON pl.id=qi.lot_id
         WHERE qi.inspection_code=$1 FOR UPDATE OF qi,pl`,
        [inspectionCode],
      );
      const inspection = result.rows[0];
      if (!inspection) throw new NotFoundException('QUALITY_INSPECTION_NOT_FOUND');
      if (!['OPEN', 'ON_HOLD'].includes(inspection.status_code)) {
        throw new ConflictException('QUALITY_INSPECTION_ALREADY_DECIDED');
      }

      const inspectorId = await this.resolveUser(client, input.inspectorUserCode);
      const produced = Number(inspection.quantity_produced);

      if (input.decision === 'HOLD') {
        if (!input.reason) throw new BadRequestException('HOLD_REASON_REQUIRED');
        await client.query(
          `UPDATE quality.inspections
           SET status_code='ON_HOLD',decision_code='HOLD',hold_reason=$2,
               inspector_user_id=COALESCE($3,inspector_user_id),updated_at=NOW(),version=version+1
           WHERE id=$1`,
          [inspection.id, input.reason, inspectorId],
        );
        await client.query(
          `UPDATE production.production_lots
           SET status_code='ON_HOLD',quantity_available=0,updated_at=NOW(),version=version+1
           WHERE id=$1`,
          [inspection.lot_id],
        );
        await this.auditAndEvent(client, {
          action: 'QUALITY_LOT_HELD', eventType: 'quality.lot_held', entityType: 'PRODUCTION_LOT',
          entityId: inspection.lot_id, businessCode: inspection.lot_code,
          payload: { inspectionCode, lotCode: inspection.lot_code, reason: input.reason },
        });
        return this.getInspectionWithClient(client, inspectionCode);
      }

      const checks = await client.query<{
        check_code: string;
        label: string;
        is_mandatory: boolean;
        result_code: string | null;
      }>(
        `SELECT d.check_code,d.label,d.is_mandatory,c.result_code
         FROM quality.checklist_definitions d
         LEFT JOIN quality.inspection_checks c
           ON c.checklist_definition_id=d.id AND c.inspection_id=$1
         WHERE d.is_active=TRUE ORDER BY d.sort_order`,
        [inspection.id],
      );
      const missingMandatory = checks.rows.filter((check) => check.is_mandatory && !check.result_code);
      if (missingMandatory.length) {
        throw new UnprocessableEntityException({
          code: 'MANDATORY_QUALITY_CHECKS_MISSING',
          checks: missingMandatory.map((check) => check.check_code),
        });
      }
      const failedMandatory = checks.rows.filter(
        (check) => check.is_mandatory && check.result_code === 'FAIL',
      );

      let approved = 0;
      let rejected = 0;
      let lotStatus = '';
      let inspectionStatus = 'DECIDED';

      if (input.decision === 'APPROVE') {
        if (failedMandatory.length) throw new UnprocessableEntityException('FAILED_MANDATORY_CHECKS_BLOCK_APPROVAL');
        approved = produced;
        rejected = 0;
        lotStatus = 'APPROVED';
      } else if (input.decision === 'PARTIAL_RELEASE') {
        if (failedMandatory.length) throw new UnprocessableEntityException('FAILED_MANDATORY_CHECKS_BLOCK_RELEASE');
        approved = Number(input.approvedQuantity ?? 0);
        rejected = Number(input.rejectedQuantity ?? produced - approved);
        if (approved <= 0 || rejected <= 0 || approved + rejected !== produced) {
          throw new BadRequestException('INVALID_PARTIAL_RELEASE_QUANTITIES');
        }
        lotStatus = 'PARTIALLY_RELEASED';
      } else {
        approved = 0;
        rejected = produced;
        lotStatus = 'REJECTED';
        if (!input.reason && failedMandatory.length === 0) {
          throw new BadRequestException('REJECTION_REASON_REQUIRED');
        }
      }

      await client.query(
        `UPDATE quality.inspections
         SET status_code=$2,decision_code=$3,approved_quantity=$4,rejected_quantity=$5,
             decision_reason=$6,inspector_user_id=COALESCE($7,inspector_user_id),
             decided_at=NOW(),updated_at=NOW(),version=version+1
         WHERE id=$1`,
        [inspection.id, inspectionStatus, input.decision, approved, rejected, input.reason ?? null, inspectorId],
      );
      await client.query(
        `UPDATE production.production_lots
         SET status_code=$2,quantity_available=$3,quantity_rejected=$4,
             updated_at=NOW(),version=version+1
         WHERE id=$1`,
        [inspection.lot_id, lotStatus, approved, rejected],
      );
      await this.auditAndEvent(client, {
        action: `QUALITY_${input.decision}`,
        eventType: `quality.${input.decision.toLowerCase()}`,
        entityType: 'PRODUCTION_LOT', entityId: inspection.lot_id,
        businessCode: inspection.lot_code,
        payload: { inspectionCode, lotCode: inspection.lot_code, approvedQuantity: approved, rejectedQuantity: rejected, reason: input.reason ?? null },
      });
      return this.getInspectionWithClient(client, inspectionCode);
    });
  }

  private async getLotWithClient(client: PoolClient, lotCode: string) {
    const result = await client.query(
      `SELECT pl.id,pl.lot_code,pl.service_date,pl.quantity_produced,pl.quantity_available,
              pl.quantity_rejected,pl.status_code,pl.produced_at,pl.expires_at,
              po.production_order_code,po.dish_code,po.dish_name_snapshot,
              po.presentation_snapshot,c.cpp_code,
              qi.inspection_code,qi.status_code inspection_status,qi.decision_code
       FROM production.production_lots pl
       JOIN production.production_orders po ON po.id=pl.production_order_id
       JOIN operations.cpp c ON c.id=pl.cpp_id
       LEFT JOIN LATERAL (
         SELECT inspection_code,status_code,decision_code
         FROM quality.inspections WHERE lot_id=pl.id ORDER BY opened_at DESC LIMIT 1
       ) qi ON TRUE
       WHERE pl.lot_code=$1`,
      [lotCode],
    );
    const row: any = result.rows[0];
    if (!row) throw new NotFoundException('PRODUCTION_LOT_NOT_FOUND');
    return { success: true, data: this.mapLot(row), meta: { timestamp: new Date().toISOString() } };
  }

  private mapLot(row: any) {
    return {
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
      inspectionCode: row.inspection_code,
      inspectionStatus: row.inspection_status,
      decision: row.decision_code,
    };
  }

  private async getInspectionWithClient(client: PoolClient, inspectionCode: string) {
    const inspectionResult = await client.query(
      `SELECT qi.id,qi.inspection_code,qi.status_code,qi.decision_code,
              qi.approved_quantity,qi.rejected_quantity,qi.hold_reason,qi.decision_reason,
              qi.opened_at,qi.decided_at,u.user_code inspector_user_code,
              pl.lot_code,pl.quantity_produced,pl.quantity_available,pl.quantity_rejected,
              pl.status_code lot_status,po.dish_code,po.dish_name_snapshot,po.presentation_snapshot,
              po.service_date,c.cpp_code
       FROM quality.inspections qi
       JOIN production.production_lots pl ON pl.id=qi.lot_id
       JOIN production.production_orders po ON po.id=pl.production_order_id
       JOIN operations.cpp c ON c.id=qi.cpp_id
       LEFT JOIN core.internal_users u ON u.id=qi.inspector_user_id
       WHERE qi.inspection_code=$1`,
      [inspectionCode],
    );
    const row: any = inspectionResult.rows[0];
    if (!row) throw new NotFoundException('QUALITY_INSPECTION_NOT_FOUND');

    const checks = await client.query(
      `SELECT d.check_code,d.label,d.description,d.value_type,d.unit_code default_unit,
              d.is_mandatory,d.sort_order,c.result_code,c.numeric_value,c.text_value,
              c.unit_code,c.notes,c.evidence,c.checked_at,u.user_code checked_by_user_code
       FROM quality.checklist_definitions d
       LEFT JOIN quality.inspection_checks c
         ON c.checklist_definition_id=d.id AND c.inspection_id=$1
       LEFT JOIN core.internal_users u ON u.id=c.checked_by
       WHERE d.is_active=TRUE ORDER BY d.sort_order`,
      [row.id],
    );

    return {
      success: true,
      data: {
        inspectionCode: row.inspection_code,
        status: row.status_code,
        decision: row.decision_code,
        approvedQuantity: Number(row.approved_quantity),
        rejectedQuantity: Number(row.rejected_quantity),
        holdReason: row.hold_reason,
        decisionReason: row.decision_reason,
        openedAt: row.opened_at,
        decidedAt: row.decided_at,
        inspectorUserCode: row.inspector_user_code,
        lot: {
          lotCode: row.lot_code,
          cppCode: row.cpp_code,
          serviceDate: row.service_date,
          dishCode: row.dish_code,
          dishName: row.dish_name_snapshot,
          presentation: row.presentation_snapshot,
          quantityProduced: Number(row.quantity_produced),
          quantityAvailable: Number(row.quantity_available),
          quantityRejected: Number(row.quantity_rejected),
          status: row.lot_status,
        },
        checks: checks.rows.map((check: any) => ({
          checkCode: check.check_code,
          label: check.label,
          description: check.description,
          valueType: check.value_type,
          defaultUnit: check.default_unit,
          mandatory: check.is_mandatory,
          result: check.result_code,
          numericValue: check.numeric_value === null ? null : Number(check.numeric_value),
          textValue: check.text_value,
          unitCode: check.unit_code,
          notes: check.notes,
          evidence: check.evidence,
          checkedAt: check.checked_at,
          checkedByUserCode: check.checked_by_user_code,
        })),
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
       VALUES($1,$2,'SYSTEM',$3,'QUALITY',$4,$5,$6,$7,'SUCCESS',NOW())`,
      [randomUUID(), `AUD-${randomUUID().slice(0, 8)}`, input.action, input.entityType,
       input.entityId, input.businessCode, JSON.stringify(input.payload)],
    );
    await client.query(
      `INSERT INTO core.domain_events(
         id,event_code,event_type,event_version,aggregate_type,aggregate_id,
         aggregate_business_code,actor_type,payload,status_code,occurred_at)
       VALUES($1,$2,$3,1,$4,$5,$6,'SYSTEM',$7,'PENDING',NOW())`,
      [randomUUID(), `EVT-${randomUUID().slice(0, 8)}`, input.eventType,
       input.entityType, input.entityId, input.businessCode, JSON.stringify(input.payload)],
    );
  }
}
