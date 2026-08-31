import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/auth.guard';

@Controller('health')
@Public()
export class HealthController {
  @Get()
  check(): { status: string; service: string; time: string } {
    return {
      status: 'ok',
      service: 'jackdevops-server',
      time: new Date().toISOString(),
    };
  }
}
