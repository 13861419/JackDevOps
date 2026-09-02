import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { OidcService } from './oidc.service';

@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    OidcService,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AuthModule {}
