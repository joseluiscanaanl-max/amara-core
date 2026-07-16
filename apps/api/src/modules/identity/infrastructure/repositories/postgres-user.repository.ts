import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../../../common/database/database.service';
import type {
  CreateIdentityUserInput,
  IdentityUser,
  UserRepository,
} from '../../domain/repositories/user.repository';

interface IdentityUserRow {
  id: string;
  phone_e164: string;
  status_code: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  created_at: Date;
  updated_at: Date;
}

@Injectable()
export class PostgresUserRepository implements UserRepository {
  constructor(private readonly database: DatabaseService) {}

  async findByPhone(phone: string): Promise<IdentityUser | null> {
    const result = await this.database.query<IdentityUserRow>(
      `
        SELECT
          id,
          phone_e164,
          status_code,
          first_name,
          last_name,
          email,
          created_at,
          updated_at
        FROM identity.users
        WHERE phone_e164 = $1
        LIMIT 1
      `,
      [phone],
    );

    const row = result.rows[0];
    return row ? this.map(row) : null;
  }

  async create(
    input: CreateIdentityUserInput,
  ): Promise<IdentityUser> {
    const result = await this.database.query<IdentityUserRow>(
      `
        INSERT INTO identity.users (
          id,
          phone_e164,
          status_code
        )
        VALUES ($1, $2, $3)
        ON CONFLICT (phone_e164)
        DO UPDATE SET
          updated_at = NOW()
        RETURNING
          id,
          phone_e164,
          status_code,
          first_name,
          last_name,
          email,
          created_at,
          updated_at
      `,
      [input.id, input.phone, input.status],
    );

    const row = result.rows[0];

    if (!row) {
      throw new Error('No fue posible crear o recuperar el usuario.');
    }

    return this.map(row);
  }

  private map(row: IdentityUserRow): IdentityUser {
    return {
      id: row.id,
      phone: row.phone_e164,
      status: row.status_code,
      firstName: row.first_name,
      lastName: row.last_name,
      email: row.email,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}