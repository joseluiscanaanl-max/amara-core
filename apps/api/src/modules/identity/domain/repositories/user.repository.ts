export interface IdentityUser {
  id: string;
  phone: string;
  status: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateIdentityUserInput {
  id: string;
  phone: string;
  status: string;
}

export const USER_REPOSITORY = Symbol('USER_REPOSITORY');

export interface UserRepository {
  findByPhone(phone: string): Promise<IdentityUser | null>;

  create(input: CreateIdentityUserInput): Promise<IdentityUser>;
}