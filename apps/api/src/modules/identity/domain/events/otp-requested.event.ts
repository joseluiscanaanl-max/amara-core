export interface OtpRequestedEvent {
  eventName: 'identity.otp_requested';
  phone: string;
  occurredAt: string;
}