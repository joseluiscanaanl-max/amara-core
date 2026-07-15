import { IdentityService } from '../application/services/identity.service';

describe('IdentityService', () => {
  const service = new IdentityService();

  it('accepts a request for an OTP', () => {
    const result = service.requestOtp({ phone: '+528331234567' });

    expect(result).toEqual({
      success: true,
      data: {
        phone: '+528331234567',
        status: 'OTP_REQUEST_ACCEPTED',
      },
    });
  });
});