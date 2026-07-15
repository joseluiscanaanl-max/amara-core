import { User } from '../entities/user.entity';

export const USER_REPOSITORY = Symbol('USER_REPOSITORY');

export interface UserRepository {
  findByPhone(phone: string): Promise<User | null>;
  save(user: User): Promise<void>;
}