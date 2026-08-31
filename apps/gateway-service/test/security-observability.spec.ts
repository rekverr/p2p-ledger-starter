import { context, propagation, trace, TraceFlags } from '@opentelemetry/api';
import { LoginRateLimitGuard } from '../src/login-rate-limit.guard';
import { JsonLogger } from '../src/observability/json-logger';
import { injectTraceHeaders } from '../src/observability/propagation';

describe('gateway security and observability', () => {
  const originalFetch = global.fetch;
  const originalEnvironment = { ...process.env };

  afterEach(() => {
    global.fetch = originalFetch;
    process.env = { ...originalEnvironment };
    propagation.disable();
    jest.restoreAllMocks();
  });

  it('rate limits login independently from authentication correctness', () => {
    process.env.LOGIN_RATE_LIMIT_MAX = '1';
    const guard = new LoginRateLimitGuard();
    const request = { ip: '203.0.113.20', socket: { remoteAddress: '203.0.113.20' } };
    const execution = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as never;

    expect(guard.canActivate(execution)).toBe(true);
    expect(() => guard.canActivate(execution)).toThrow(
      expect.objectContaining({ status: 429 }),
    );
  });

  it('propagates W3C trace context to upstream services', () => {
    propagation.setGlobalPropagator({
      fields: () => ['traceparent'],
      inject: (ctx, carrier, setter) => {
        const span = trace.getSpanContext(ctx);
        if (span) {
          setter.set(
            carrier,
            'traceparent',
            `00-${span.traceId}-${span.spanId}-01`,
          );
        }
      },
      extract: (ctx) => ctx,
    });
    const spanContext = {
      traceId: '11111111111111111111111111111111',
      spanId: '2222222222222222',
      traceFlags: TraceFlags.SAMPLED,
      isRemote: false,
    };

    const headers = injectTraceHeaders(
      {},
      trace.setSpanContext(context.active(), spanContext),
    );

    expect(headers).toEqual({
      traceparent:
        '00-11111111111111111111111111111111-2222222222222222-01',
    });
  });

  it('redacts credentials from structured logs', () => {
    const output = jest.spyOn(process.stdout, 'write').mockReturnValue(true);
    new JsonLogger('gateway-service').log({
      password: 'plain-text',
      authorization: 'Bearer signed-token',
      transferId: 'transfer-1',
    });

    const record = JSON.parse(String(output.mock.calls[0][0])) as {
      fields: Record<string, string>;
    };
    expect(record.fields).toMatchObject({
      password: '[REDACTED]',
      authorization: '[REDACTED]',
      transferId: 'transfer-1',
    });
  });
});
