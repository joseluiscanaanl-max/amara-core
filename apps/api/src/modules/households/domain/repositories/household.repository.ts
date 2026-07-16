import type {
  CreatedHousehold,
  Household,
} from '../interfaces/household.interface';

export interface CreateHouseholdInput {
  id: string;
  name: string;
  createdByUserId: string;
  membershipId: string;
}

export const HOUSEHOLD_REPOSITORY = Symbol(
  'HOUSEHOLD_REPOSITORY',
);

export interface HouseholdRepository {
  create(
    input: CreateHouseholdInput,
  ): Promise<CreatedHousehold>;

  findById(id: string): Promise<Household | null>;
}