export interface Household {
  id: string;
  name: string;
  status: string;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface HouseholdMembership {
  id: string;
  householdId: string;
  userId: string;
  roleCode: string;
  status: string;
  joinedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatedHousehold {
  household: Household;
  membership: HouseholdMembership;
}