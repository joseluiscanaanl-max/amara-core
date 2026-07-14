import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get()
  getHealth(): object {
    return {
      success: true,
      data: {
        service: 'amara-core-api',
        status: 'ok',
        version: '0.1.0',
      },
      meta: { timestamp: new Date().toISOString() },
    };
  }
}
