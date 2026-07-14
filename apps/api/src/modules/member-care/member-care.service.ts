import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../../common/database.service';

type PreferenceInput = { categoryCode: string; valueCode?: string; valueText?: string };
type RestrictionInput = {
  typeCode: string;
  subject: string;
  description?: string;
  declaredSeverityCode?: string;
  crossContaminationRisk?: boolean;
  consentAccepted: boolean;
  noticeVersion: string;
};

@Injectable()
export class MemberCareService {
  constructor(private readonly db: DatabaseService) {}

  async getProfile(haid: string, memberCode: string): Promise<object> {
    const member = await this.findMember(haid, memberCode);
    const preferences = await this.db.query(`SELECT preference_code,category_code,value_code,value_text,source_code,status_code FROM household.preferences WHERE member_id=$1 AND is_active=TRUE ORDER BY created_at`, [member.id]);
    const restrictions = await this.db.query(`SELECT restriction_code,restriction_type_code,subject,description,declared_severity_code,cross_contamination_risk,review_status_code,operational_alert,status_code FROM household.restrictions WHERE member_id=$1 AND is_active=TRUE ORDER BY created_at`, [member.id]);
    return { success: true, data: { memberCode, preferences: preferences.rows, restrictions: restrictions.rows }, meta: { timestamp: new Date().toISOString() } };
  }

  async addPreference(haid: string, memberCode: string, input: PreferenceInput): Promise<object> {
    if (!input.categoryCode?.trim()) throw new BadRequestException('PREFERENCE_CATEGORY_REQUIRED');
    if (!input.valueCode?.trim() && !input.valueText?.trim()) throw new BadRequestException('PREFERENCE_VALUE_REQUIRED');
    return this.db.transaction(async (client) => {
      const member = await this.findMemberWithClient(client, haid, memberCode);
      const code = await this.nextCode(client, 'PREFERENCE');
      const id = randomUUID();
      await client.query(`INSERT INTO household.preferences(id,preference_code,household_id,member_id,category_code,value_code,value_text,source_code,status_code) VALUES($1,$2,$3,$4,$5,NULLIF($6,''),NULLIF($7,''),'DECLARED','ACTIVE')`, [id, code, member.household_id, member.id, input.categoryCode.trim(), input.valueCode?.trim() ?? '', input.valueText?.trim() ?? '']);
      await this.audit(client, member.household_id, id, 'MEMBER_PREFERENCE_CREATED', 'PREFERENCE', { haid, memberCode, preferenceCode: code, categoryCode: input.categoryCode });
      await this.event(client, member.household_id, haid, 'member.preference_added', { memberCode, preferenceCode: code });
      return { success: true, data: { preferenceCode: code, source: 'DECLARED' }, meta: { timestamp: new Date().toISOString() } };
    });
  }

  async addRestriction(haid: string, memberCode: string, input: RestrictionInput): Promise<object> {
    if (!input.consentAccepted) throw new BadRequestException('SENSITIVE_DATA_CONSENT_REQUIRED');
    if (!input.typeCode?.trim() || !input.subject?.trim()) throw new BadRequestException('RESTRICTION_DATA_REQUIRED');
    if (!input.noticeVersion?.trim()) throw new BadRequestException('CONSENT_NOTICE_VERSION_REQUIRED');
    return this.db.transaction(async (client) => {
      const member = await this.findMemberWithClient(client, haid, memberCode);
      const consentCode = await this.nextCode(client, 'CONSENT');
      const consentId = randomUUID();
      await client.query(`INSERT INTO household.consents(id,consent_code,household_id,member_id,consent_type_code,notice_version,accepted,channel_code,granted_at,status_code) VALUES($1,$2,$3,$4,'NUTRITIONAL_DATA_PROCESSING',$5,TRUE,'WEB_MOBILE',NOW(),'ACTIVE')`, [consentId, consentCode, member.household_id, member.id, input.noticeVersion.trim()]);
      const restrictionCode = await this.nextCode(client, 'RESTRICTION');
      const restrictionId = randomUUID();
      const alert = input.typeCode === 'ALLERGY' || Boolean(input.crossContaminationRisk);
      await client.query(`INSERT INTO household.restrictions(id,restriction_code,household_id,member_id,consent_id,restriction_type_code,subject,description,declared_severity_code,cross_contamination_risk,source_code,review_status_code,operational_alert,status_code) VALUES($1,$2,$3,$4,$5,$6,$7,NULLIF($8,''),$9,$10,'DECLARED','REVIEW_REQUIRED',$11,'ACTIVE')`, [restrictionId, restrictionCode, member.household_id, member.id, consentId, input.typeCode.trim(), input.subject.trim(), input.description?.trim() ?? '', input.declaredSeverityCode ?? null, input.crossContaminationRisk ?? false, alert]);
      await this.audit(client, member.household_id, restrictionId, 'MEMBER_RESTRICTION_CREATED', 'RESTRICTION', { haid, memberCode, restrictionCode, operationalAlert: alert });
      await this.event(client, member.household_id, haid, 'member.restriction_added', { memberCode, restrictionCode, reviewStatus: 'REVIEW_REQUIRED', operationalAlert: alert });
      return { success: true, data: { restrictionCode, consentCode, reviewStatus: 'REVIEW_REQUIRED', operationalAlert: alert }, meta: { timestamp: new Date().toISOString() } };
    });
  }

  private async findMember(haid: string, memberCode: string) {
    const result = await this.db.query<{ id: string; household_id: string }>(`SELECT m.id,m.household_id FROM household.members m JOIN household.households h ON h.id=m.household_id WHERE h.haid=$1 AND m.member_code=$2 AND h.is_active=TRUE AND m.is_active=TRUE`, [haid, memberCode]);
    if (!result.rows[0]) throw new NotFoundException('MEMBER_NOT_IN_HOUSEHOLD');
    return result.rows[0];
  }

  private async findMemberWithClient(client: { query: Function }, haid: string, memberCode: string) {
    const result = await client.query(`SELECT m.id,m.household_id FROM household.members m JOIN household.households h ON h.id=m.household_id WHERE h.haid=$1 AND m.member_code=$2 AND h.is_active=TRUE AND m.is_active=TRUE FOR UPDATE`, [haid, memberCode]);
    if (!result.rows[0]) throw new NotFoundException('MEMBER_NOT_IN_HOUSEHOLD');
    return result.rows[0] as { id: string; household_id: string };
  }

  private async nextCode(client: { query: Function }, sequenceCode: string): Promise<string> {
    const result = await client.query(`UPDATE core.business_sequences SET current_value=current_value+1,updated_at=NOW() WHERE sequence_code=$1 RETURNING current_value,prefix,padding`, [sequenceCode]);
    const row = result.rows[0];
    if (!row) throw new Error(`${sequenceCode} sequence is missing`);
    return `${row.prefix}${String(row.current_value).padStart(row.padding, '0')}`;
  }

  private async audit(client: { query: Function }, actorId: string, entityId: string, action: string, entityType: string, value: object) {
    await client.query(`INSERT INTO audit.audit_events(audit_code,actor_type,actor_id,action_code,entity_type,entity_id,new_value,result_code) VALUES($1,'HOUSEHOLD',$2,$3,$4,$5,$6,'SUCCESS')`, [`AUD-${randomUUID().slice(0,8).toUpperCase()}`, actorId, action, entityType, entityId, JSON.stringify(value)]);
  }

  private async event(client: { query: Function }, householdId: string, haid: string, eventType: string, payload: object) {
    await client.query(`INSERT INTO core.domain_events(event_code,event_type,aggregate_type,aggregate_id,aggregate_business_code,payload,occurred_at) VALUES($1,$2,'HOUSEHOLD',$3,$4,$5,NOW())`, [`EVT-${randomUUID().slice(0,8).toUpperCase()}`, eventType, householdId, haid, JSON.stringify(payload)]);
  }
}
