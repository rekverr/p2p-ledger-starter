import { Body, Controller, Post } from '@nestjs/common';
import { UpstreamService } from './upstream.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly upstream: UpstreamService) {}

  @Post('login')
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
}
