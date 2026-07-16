import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../../common/database/database.service';
import type {
  CreatedHousehold,
  Household,
  HouseholdMembership,
} from '../../domain/interfaces/household.interface';
import type {
  CreateHouseholdInput,
  HouseholdRepository,
} from '../../domain/repositories/household.repository';

interface HouseholdRow {
  id: string;
  name: string;
  status: string;
  created_by_user_id: string;
  created_at: Date;
  updated_at: Date;
}

interface MembershipRow {
  id: string;
  household_id: string;
  user_id: string;
  role_code: string;
  status: string;
  joined_at: Date;
  created_at: Date;
  updated_at: Date;
}

@Injectable()
export class PostgresHouseholdRepository
  implements HouseholdRepository
{
  constructor(private readonly database: DatabaseService) {}

  async create(
    input: CreateHouseholdInput,
  ): Promise<CreatedHousehold> {
    const client = await this.database.getClient();

    try {
      await client.query('BEGIN');

      const householdResult = await client.query<HouseholdRow>(
        `
          INSERT INTO household.households (
            id,
            name,
            status,
            created_by_user_id
          )
          VALUES ($1, $2, 'ACTIVE', $3)
          RETURNING
            id,
            name,
            status,
            created_by_user_id,
            created_at,
            updated_at
        `,
        [
          input.id,
          input.name,
          input.createdByUserId,
        ],
      );

      const membershipResult =
        await client.query<MembershipRow>(
          `
            INSERT INTO household.members (
              id,
              household_id,
              user_id,
              role_code,
              status
            )
            VALUES ($1, $2, $3, 'OWNER', 'ACTIVE')
            RETURNING
              id,
              household_id,
              user_id,
              role_code,
              status,
              joined_at,
              created_at,
              updated_at
          `,
          [
            input.membershipId,
            input.id,
            input.createdByUserId,
          ],
        );

      await client.query('COMMIT');

      const householdRow = householdResult.rows[0];
      const membershipRow = membershipResult.rows[0];

      if (!householdRow || !membershipRow) {
        throw new Error(
          'No fue posible crear el hogar y su membresía.',
        );
      }

      return {
        household: this.mapHousehold(householdRow),
        membership: this.mapMembership(membershipRow),
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async findById(id: string): Promise<Household | null> {
    const result = await this.database.query<HouseholdRow>(
      `
        SELECT
          id,
          name,
          status,
          created_by_user_id,
          created_at,
          updated_at
        FROM household.households
        WHERE id = $1
        LIMIT 1
      `,
      [id],
    );

    const row = result.rows[0];

    return row ? this.mapHousehold(row) : null;
  }

  private mapHousehold(row: HouseholdRow): Household {
    return {
      id: row.id,
      name: row.name,
      status: row.status,
      createdByUserId: row.created_by_user_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapMembership(
    row: MembershipRow,
  ): HouseholdMembership {
    return {
      id: row.id,
      householdId: row.household_id,
      userId: row.user_id,
      roleCode: row.role_code,
      status: row.status,
      joinedAt: row.joined_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}