import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  Request,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { Request as ExpressRequest } from 'express';
import { ConfigService } from '@nestjs/config';
import { AdminGuard } from './admin.guard';
import { bearer } from './authenticated-request';
import { JwtPrincipalGuard } from './jwt-principal.guard';
import { UpstreamService } from './upstream.service';

@Controller('bff/admin')
@UseGuards(JwtPrincipalGuard, AdminGuard)
export class AdminBffController {
  constructor(
    private readonly upstream: UpstreamService,
    private readonly config: ConfigService,
  ) {}

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

  @Get('traces')
  async traces() {
    const baseUrl = this.config.get<string>('JAEGER_QUERY_URL', 'http://jaeger:16686');
    try {
      const response = await fetch(
        `${baseUrl}/api/traces?service=payments-service&limit=20`,
        { signal: AbortSignal.timeout(3_000) },
      );
      if (!response.ok) throw new Error(`Jaeger returned ${response.status}`);
      const body = (await response.json()) as { data?: unknown[] };
      return summarizeTraces(body.data ?? []);
    } catch {
      throw new ServiceUnavailableException('Tracing backend is unavailable');
    }
  }
}

export function summarizeTraces(values: unknown[]) {
  return values.map((value) => {
    const trace = value as { traceID?: string; spans?: Array<Record<string, unknown>> };
    const spans = trace.spans ?? [];
    const starts = spans.map((span) => Number(span.startTime ?? 0));
    const ends = spans.map((span) => Number(span.startTime ?? 0) + Number(span.duration ?? 0));
    const tags = spans.flatMap((span) => Array.isArray(span.tags) ? span.tags as Array<Record<string, unknown>> : []);
    const transfer = tags.find((tag) => ['transfer.id', 'transferId'].includes(String(tag.key)));
    const error = tags.some((tag) => String(tag.key) === 'error' && Boolean(tag.value));
    const sagaSteps = spans
      .filter((span) => String(span.operationName ?? '').startsWith('saga.'))
      .map((span) => ({
        step: String(span.operationName).slice('saga.'.length),
        durationMs: Math.round(Number(span.duration ?? 0) / 1_000),
      }));
    return {
      traceId: trace.traceID ?? '',
      operation: String(spans[0]?.operationName ?? 'unknown'),
      startedAt: starts.length ? new Date(Math.min(...starts) / 1_000).toISOString() : null,
      durationMs: starts.length ? Math.round((Math.max(...ends) - Math.min(...starts)) / 1_000) : 0,
      transferId: transfer ? String(transfer.value) : null,
      status: error ? 'ERROR' : 'OK',
      spanCount: spans.length,
      sagaSteps,
    };
  });
}
