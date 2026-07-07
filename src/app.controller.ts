import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  @Get()
  health() {
    return { status: 'ok', service: 'omnichat_backend' };
  }

  @Get('health')
  healthCheck() {
    return { status: 'ok' };
  }
}
