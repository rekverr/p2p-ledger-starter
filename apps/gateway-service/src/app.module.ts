import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { BffController } from './bff.controller';
import { AdminBffController } from './admin-bff.controller';
import { JwtPrincipalGuard } from './jwt-principal.guard';
import { AdminGuard } from './admin.guard';
import { UpstreamService } from './upstream.service';
import { ObservabilityModule } from './observability/observability.module';
import { LoginRateLimitGuard } from './login-rate-limit.guard';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    JwtModule.register({}),
    ObservabilityModule,
  ],
  controllers: [AuthController, BffController, AdminBffController],
  providers: [
    UpstreamService,
    JwtPrincipalGuard,
    AdminGuard,
    LoginRateLimitGuard,
  ],
})
export class AppModule {}
