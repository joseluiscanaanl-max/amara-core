import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../../common/database.service';

type UpdateProfileInput = {
  householdName: string;
  householdTypeCode?: string;
  estimatedMembers: number;
  originChannelCode?: string;
  referralCode?: string;
};

type CreateMemberInput = {
  firstName: string;
  lastName?: string;
  alias?: string;
  ageRangeCode?: string;
  householdRoleCode?: string;
  isPrimaryResponsible?: boolean;
  isAccountManager?: boolean;
  canAuthorizeDependents?: boolean;
  requiresRepresentative?: boolean;
  representativeMemberCode?: string;
};

@Injectable()
export class HouseholdsService {
  constructor(private readonly db: DatabaseService) {}

  async getByHaid(haid: string): Promise<object> {
    const result = await this.db.query<{
      id: string;
      haid: string;
      household_name: string | null;
      household_type_code: string | null;
      estimated_members: number | null;
      status_code: string;
      masked_phone: string;
      created_at: Date;
      member_count: string;
    }>(
      `SELECT h.id, h.haid, h.household_name, h.household_type_code,
              h.estimated_members, h.status_code, p.masked_phone, h.created_at,
              COUNT(m.id) FILTER (WHERE m.is_active = TRUE)::text AS member_count
       FROM household.households h
       JOIN identity.digital_identities d ON d.household_id = h.id AND d.is_primary = TRUE AND d.is_active = TRUE
       JOIN identity.phones p ON p.digital_identity_id = d.id AND p.is_primary = TRUE AND p.is_active = TRUE
       LEFT JOIN household.members m ON m.household_id = h.id
       WHERE h.haid = $1 AND h.is_active = TRUE
       GROUP BY h.id, p.masked_phone`,
      [haid],
    );
    const household = result.rows[0];
    if (!household) throw new NotFoundException('HOUSEHOLD_NOT_FOUND');
    return {
      success: true,
      data: {
        haid: household.haid,
        householdName: household.household_name,
        householdTypeCode: household.household_type_code,
        estimatedMembers: household.estimated_members,
        memberCount: Number(household.member_count),
        status: household.status_code,
        maskedPhone: household.masked_phone,
        createdAt: household.created_at,
      },
      meta: { timestamp: new Date().toISOString() },
    };
  }

  async updateProfile(haid: string, input: UpdateProfileInput): Promise<object> {
    const name = input.householdName.trim();
    if (name.length < 2 || name.length > 100) throw new BadRequestException('HOUSEHOLD_NAME_INVALID');
    if (!Number.isInteger(input.estimatedMembers) || input.estimatedMembers < 1 || input.estimatedMembers > 20) {
      throw new BadRequestException('HOUSEHOLD_MEMBER_COUNT_INVALID');
    }

    return this.db.transaction(async (client) => {
      const existing = await client.query<{
        id: string;
        status_code: string;
        household_name: string | null;
        version: number;
      }>(
        `SELECT id, status_code, household_name, version
         FROM household.households WHERE haid = $1 AND is_active = TRUE FOR UPDATE`,
        [haid],
      );
      const household = existing.rows[0];
      if (!household) throw new NotFoundException('HOUSEHOLD_NOT_FOUND');

      const updated = await client.query<{ version: number; status_code: string }>(
        `UPDATE household.households
         SET household_name = $2,
             household_type_code = $3,
             estimated_members = $4,
             origin_channel_code = $5,
             referral_code = NULLIF($6, ''),
             status_code = CASE WHEN status_code = 'VERIFIED' THEN 'PROFILE_INCOMPLETE' ELSE status_code END,
             last_activity_at = NOW(),
             updated_at = NOW(),
             version = version + 1
         WHERE id = $1
         RETURNING version, status_code`,
        [
          household.id,
          name,
          input.householdTypeCode ?? null,
          input.estimatedMembers,
          input.originChannelCode ?? null,
          input.referralCode?.trim() ?? '',
        ],
      );

      await this.insertAudit(client, household.id, 'HOUSEHOLD_PROFILE_UPDATED', {
        previousName: household.household_name,
        householdName: name,
        estimatedMembers: input.estimatedMembers,
      });
      await this.insertEvent(client, household.id, haid, 'household.profile_updated', {
        haid,
        status: updated.rows[0].status_code,
      });

      return {
        success: true,
        data: {
          haid,
          status: updated.rows[0].status_code,
          version: updated.rows[0].version,
          nextStep: 'CREATE_PRIMARY_RESPONSIBLE',
        },
        meta: { timestamp: new Date().toISOString() },
      };
    });
  }

  async listMembers(haid: string): Promise<object> {
    const household = await this.findHouseholdId(haid);
    const result = await this.db.query<{
      member_code: string;
      first_name: string;
      last_name: string | null;
      alias: string | null;
      age_range_code: string | null;
      household_role_code: string | null;
      is_primary_responsible: boolean;
      is_account_manager: boolean;
      status_code: string;
    }>(
      `SELECT member_code, first_name, last_name, alias, age_range_code,
              household_role_code, is_primary_responsible, is_account_manager, status_code
       FROM household.members
       WHERE household_id = $1 AND is_active = TRUE
       ORDER BY is_primary_responsible DESC, created_at ASC`,
      [household.id],
    );

    return {
      success: true,
      data: result.rows.map((row) => ({
        memberCode: row.member_code,
        firstName: row.first_name,
        lastName: row.last_name,
        alias: row.alias,
        ageRangeCode: row.age_range_code,
        householdRoleCode: row.household_role_code,
        isPrimaryResponsible: row.is_primary_responsible,
        isAccountManager: row.is_account_manager,
        status: row.status_code,
      })),
      meta: { timestamp: new Date().toISOString() },
    };
  }

  async createMember(haid: string, input: CreateMemberInput): Promise<object> {
    const firstName = input.firstName.trim();
    if (firstName.length < 2 || firstName.length > 100) throw new BadRequestException('MEMBER_NAME_INVALID');

    return this.db.transaction(async (client) => {
      const householdResult = await client.query<{
        id: string;
        status_code: string;
        household_name: string | null;
        estimated_members: number | null;
      }>(
        `SELECT id, status_code, household_name, estimated_members
         FROM household.households WHERE haid = $1 AND is_active = TRUE FOR UPDATE`,
        [haid],
      );
      const household = householdResult.rows[0];
      if (!household) throw new NotFoundException('HOUSEHOLD_NOT_FOUND');
      if (!household.household_name) throw new BadRequestException('HOUSEHOLD_PROFILE_INCOMPLETE');

      const memberCount = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM household.members
         WHERE household_id = $1 AND is_active = TRUE`,
        [household.id],
      );
      const currentCount = Number(memberCount.rows[0].count);
      if (household.estimated_members && currentCount >= household.estimated_members) {
        throw new ConflictException('HOUSEHOLD_MEMBER_LIMIT_REACHED');
      }

      if (input.isPrimaryResponsible) {
        const responsible = await client.query(
          `SELECT 1 FROM household.members
           WHERE household_id = $1 AND is_primary_responsible = TRUE AND is_active = TRUE LIMIT 1`,
          [household.id],
        );
        if (responsible.rowCount) throw new ConflictException('PRIMARY_RESPONSIBLE_ALREADY_EXISTS');
      }

      let representativeId: string | null = null;
      if (input.requiresRepresentative) {
        if (!input.representativeMemberCode) throw new BadRequestException('REPRESENTATIVE_REQUIRED');
        const representative = await client.query<{ id: string }>(
          `SELECT id FROM household.members
           WHERE household_id = $1 AND member_code = $2 AND is_active = TRUE`,
          [household.id, input.representativeMemberCode],
        );
        representativeId = representative.rows[0]?.id ?? null;
        if (!representativeId) throw new BadRequestException('REPRESENTATIVE_NOT_FOUND');
      }

      const sequenceResult = await client.query<{ current_value: string; prefix: string; padding: number }>(
        `UPDATE core.business_sequences
         SET current_value = current_value + 1, updated_at = NOW()
         WHERE sequence_code = 'MEMBER'
         RETURNING current_value, prefix, padding`,
      );
      const sequence = sequenceResult.rows[0];
      if (!sequence) throw new Error('MEMBER sequence is missing');
      const memberCode = `${sequence.prefix}${String(sequence.current_value).padStart(sequence.padding, '0')}`;

      const created = await client.query<{ id: string }>(
        `INSERT INTO household.members
         (member_code, household_id, first_name, last_name, alias, age_range_code,
          household_role_code, is_primary_responsible, is_account_manager,
          can_authorize_dependents, requires_representative, representative_member_id,
          status_code, created_at, updated_at)
         VALUES ($1,$2,$3,NULLIF($4,''),NULLIF($5,''),$6,$7,$8,$9,$10,$11,$12,'ACTIVE',NOW(),NOW())
         RETURNING id`,
        [
          memberCode,
          household.id,
          firstName,
          input.lastName?.trim() ?? '',
          input.alias?.trim() ?? '',
          input.ageRangeCode ?? null,
          input.householdRoleCode ?? null,
          input.isPrimaryResponsible ?? false,
          input.isAccountManager ?? input.isPrimaryResponsible ?? false,
          input.canAuthorizeDependents ?? false,
          input.requiresRepresentative ?? false,
          representativeId,
        ],
      );

      const hasResponsible = input.isPrimaryResponsible
        ? true
        : Boolean((await client.query(
            `SELECT 1 FROM household.members
             WHERE household_id=$1 AND is_primary_responsible=TRUE AND is_active=TRUE LIMIT 1`,
            [household.id],
          )).rowCount);

      const nextCount = currentCount + 1;
      const activate = hasResponsible && Boolean(household.household_name);
      const householdStatus = activate ? 'ACTIVE' : 'PROFILE_INCOMPLETE';
      await client.query(
        `UPDATE household.households
         SET status_code = $2,
             activated_at = CASE WHEN $2='ACTIVE' THEN COALESCE(activated_at,NOW()) ELSE activated_at END,
             last_activity_at = NOW(), updated_at = NOW(), version = version + 1
         WHERE id = $1`,
        [household.id, householdStatus],
      );

      await this.insertAudit(client, created.rows[0].id, 'MEMBER_CREATED', {
        memberCode,
        haid,
        isPrimaryResponsible: input.isPrimaryResponsible ?? false,
      }, 'MEMBER');
      await this.insertEvent(client, household.id, haid, 'member.created', {
        haid,
        memberCode,
        isPrimaryResponsible: input.isPrimaryResponsible ?? false,
      });
      if (activate) {
        await this.insertEvent(client, household.id, haid, 'household.activated', {
          haid,
          primaryMemberCode: input.isPrimaryResponsible ? memberCode : undefined,
          memberCount: nextCount,
        });
      }

      return {
        success: true,
        data: {
          memberCode,
          haid,
          isPrimaryResponsible: input.isPrimaryResponsible ?? false,
          householdStatus,
          memberCount: nextCount,
          nextStep: household.estimated_members && nextCount < household.estimated_members
            ? 'ADD_ANOTHER_MEMBER'
            : 'REGISTRATION_COMPLETE',
        },
        meta: { timestamp: new Date().toISOString() },
      };
    });
  }

  private async findHouseholdId(haid: string): Promise<{ id: string }> {
    const result = await this.db.query<{ id: string }>(
      `SELECT id FROM household.households WHERE haid=$1 AND is_active=TRUE`,
      [haid],
    );
    if (!result.rows[0]) throw new NotFoundException('HOUSEHOLD_NOT_FOUND');
    return result.rows[0];
  }

  private async insertAudit(
    client: { query: (text: string, values?: unknown[]) => Promise<unknown> },
    entityId: string,
    actionCode: string,
    value: object,
    entityType = 'HOUSEHOLD',
  ): Promise<void> {
    await client.query(
      `INSERT INTO audit.audit_events
       (audit_code, actor_type, actor_id, action_code, entity_type, entity_id, new_value, result_code)
       VALUES ($1,'HOUSEHOLD',$2,$3,$4,$2,$5,'SUCCESS')`,
      [`AUD-${randomUUID().slice(0, 8).toUpperCase()}`, entityId, actionCode, entityType, JSON.stringify(value)],
    );
  }

  private async insertEvent(
    client: { query: (text: string, values?: unknown[]) => Promise<unknown> },
    householdId: string,
    haid: string,
    eventType: string,
    payload: object,
  ): Promise<void> {
    await client.query(
      `INSERT INTO core.domain_events
       (event_code,event_type,aggregate_type,aggregate_id,aggregate_business_code,payload,occurred_at)
       VALUES ($1,$2,'HOUSEHOLD',$3,$4,$5,NOW())`,
      [`EVT-${randomUUID().slice(0, 8).toUpperCase()}`, eventType, householdId, haid, JSON.stringify(payload)],
    );
  }
}
