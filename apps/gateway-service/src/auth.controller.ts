import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { UpstreamService } from './upstream.service';
import { LoginRateLimitGuard } from './login-rate-limit.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly upstream: UpstreamService) {}

  @Post('login')
  @UseGuards(LoginRateLimitGuard)
  login(@Body() body: unknown) {
    return this.upstream.request('ledger', '/auth/login', {
      method: 'POST',
      body,
    });
  }

  @Post('register')
  register(@Body() body: unknown) {
    return this.upstream.request('ledger', '/auth/register', {
      method: 'POST',
      body,
    });
  }

  @Post('refresh')
  refresh(@Body() body: unknown) {
    return this.upstream.request('ledger', '/auth/refresh', {
      method: 'POST',
      body,
    });
  }
}
