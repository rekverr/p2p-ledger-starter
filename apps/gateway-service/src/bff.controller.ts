import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { Request as ExpressRequest } from 'express';
import { bearer } from './authenticated-request';
import { AuthenticatedRequest } from './authenticated-request';
import { JwtPrincipalGuard } from './jwt-principal.guard';
import { UpstreamService } from './upstream.service';

@Controller('bff')
@UseGuards(JwtPrincipalGuard)
export class BffController {
  constructor(private readonly upstream: UpstreamService) {}

  @Get('dashboard')
  async dashboard(@Request() request: AuthenticatedRequest) {
    const authorization = bearer(request);
    const [wallets, activity, splitBills] = await Promise.all([
      this.upstream.request('ledger', '/wallets', { authorization }),
      this.upstream.request('notifications', '/activity?limit=20', {
        authorization,
      }),
      this.upstream.request('payments', '/split-bills', { authorization }),
    ]);
    return { me: request.user, wallets, activity, splitBills };
  }

  @Get('me')
  me(@Request() request: AuthenticatedRequest) {
    return request.user;
  }

  @Get('wallets')
  wallets(@Request() request: ExpressRequest) {
    return this.upstream.request('ledger', '/wallets', {
      authorization: bearer(request),
    });
  }

  @Post('transfers')
  createTransfer(
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Request() request: ExpressRequest,
  ) {
    return this.upstream.request('payments', '/transfers', {
      method: 'POST',
      authorization: bearer(request),
      idempotencyKey,
      body,
    });
  }

  @Get('transfers/:id')
  transfer(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Request() request: ExpressRequest,
  ) {
    return this.upstream.request('payments', `/transfers/${id}`, {
      authorization: bearer(request),
    });
  }

  @Get('activity')
  activity(
    @Query() query: Record<string, string | string[]>,
    @Request() request: ExpressRequest,
  ) {
    const allowed = new URLSearchParams();
    for (const name of ['limit', 'cursor', 'eventType']) {
      const value = query[name];
      if (typeof value === 'string') allowed.set(name, value);
    }
    const suffix = allowed.size > 0 ? `?${allowed.toString()}` : '';
    return this.upstream.request('notifications', `/activity${suffix}`, {
      authorization: bearer(request),
    });
  }

  @Get('split-bills')
  splitBills(@Request() request: ExpressRequest) {
    return this.upstream.request('payments', '/split-bills', {
      authorization: bearer(request),
    });
  }

  @Post('split-bills')
  createSplitBill(
    @Body() body: unknown,
    @Request() request: ExpressRequest,
  ) {
    return this.upstream.request('payments', '/split-bills', {
      method: 'POST',
      authorization: bearer(request),
      body,
    });
  }

  @Get('split-bills/:id')
  splitBill(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Request() request: ExpressRequest,
  ) {
    return this.upstream.request('payments', `/split-bills/${id}`, {
      authorization: bearer(request),
    });
  }

  @Post('split-bills/:billId/shares/:shareId/pay')
  payShare(
    @Param('billId', new ParseUUIDPipe()) billId: string,
    @Param('shareId', new ParseUUIDPipe()) shareId: string,
    @Body() body: unknown,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Request() request: ExpressRequest,
  ) {
    return this.upstream.request(
      'payments',
      `/split-bills/${billId}/shares/${shareId}/pay`,
      {
        method: 'POST',
        authorization: bearer(request),
        idempotencyKey,
        body,
      },
    );
  }
}
