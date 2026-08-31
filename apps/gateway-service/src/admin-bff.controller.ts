import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { Request as ExpressRequest } from 'express';
import { AdminGuard } from './admin.guard';
import { bearer } from './authenticated-request';
import { JwtPrincipalGuard } from './jwt-principal.guard';
import { UpstreamService } from './upstream.service';

@Controller('bff/admin')
@UseGuards(JwtPrincipalGuard, AdminGuard)
export class AdminBffController {
  constructor(private readonly upstream: UpstreamService) {}

  @Get('access')
  access() {
    return { allowed: true };
  }

  @Get('wallets/:id/events')
  events(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Request() request: ExpressRequest,
  ) {
    return this.upstream.request('ledger', `/admin/ledger/wallets/${id}/events`, {
      authorization: bearer(request),
    });
  }

  @Get('wallets/:id/reconciliation')
  walletReconciliation(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Request() request: ExpressRequest,
  ) {
    return this.upstream.request(
      'ledger',
      `/admin/ledger/reconciliation/wallets/${id}`,
      { authorization: bearer(request) },
    );
  }

  @Get('reconciliation/global')
  globalReconciliation(
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Request() request: ExpressRequest,
  ) {
    const query = new URLSearchParams();
    if (from) query.set('from', from);
    if (to) query.set('to', to);
    const suffix = query.size > 0 ? `?${query.toString()}` : '';
    return this.upstream.request(
      'ledger',
      `/admin/ledger/reconciliation/global${suffix}`,
      { authorization: bearer(request) },
    );
  }
}
