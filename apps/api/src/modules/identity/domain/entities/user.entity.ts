export type UserStatus = 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'ARCHIVED';

export interface UserProps {
  id: string;
  phone: string;
  status: UserStatus;
  createdAt: Date;
  updatedAt: Date;
}

export class User {
  private constructor(private readonly props: UserProps) {}

  static create(props: UserProps): User {
    return new User(props);
  }

  get id(): string {
    return this.props.id;
  }

  get phone(): string {
    return this.props.phone;
  }

  get status(): UserStatus {
    return this.props.status;
  }
}