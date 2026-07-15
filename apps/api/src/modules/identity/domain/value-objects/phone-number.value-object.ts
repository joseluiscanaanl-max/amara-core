export class PhoneNumber {
  private constructor(private readonly value: string) {}

  static create(value: string): PhoneNumber {
    const normalized = value.trim();

    if (!/^\+[1-9]\d{7,14}$/.test(normalized)) {
      throw new Error('Invalid E.164 phone number.');
    }

    return new PhoneNumber(normalized);
  }

  toString(): string {
    return this.value;
  }
}