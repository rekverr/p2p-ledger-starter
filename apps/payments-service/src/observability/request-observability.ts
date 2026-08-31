import { randomUUID } from 'crypto';
import { context, propagation, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import { NextFunction, Request, Response } from 'express';
import { withRequestContext } from './context';
import { MetricsService } from './metrics.service';

const SAFE_CORRELATION_ID = /^[A-Za-z0-9._:-]{1,100}$/;

export function requestObservability(metrics: MetricsService, service: string) {
  return (request: Request, response: Response, next: NextFunction): void => {
    const supplied = request.header('x-correlation-id');
    const correlationId = supplied && SAFE_CORRELATION_ID.test(supplied) ? supplied : randomUUID();
    response.setHeader('x-correlation-id', correlationId);
    const started = process.hrtime.bigint();
    const active = context.active();
    const extracted = propagation.extract(active, request.headers);
    const remoteTraceId = trace.getSpanContext(extracted)?.traceId;
    const activeTraceId = trace.getSpan(active)?.spanContext().traceId;
    const boundarySpan = remoteTraceId && remoteTraceId !== activeTraceId
      ? trace.getTracer(service).startSpan(`${request.method} ${request.path}`, { kind: SpanKind.SERVER }, extracted)
      : undefined;
    const requestContext = boundarySpan ? trace.setSpan(extracted, boundarySpan) : active;
    const traceCarrier: Record<string, string> = {};
    propagation.inject(requestContext, traceCarrier);
    context.with(requestContext, () => withRequestContext(correlationId, () => {
      response.on('finish', () => {
        const route = routeTemplate(request);
        const seconds = Number(process.hrtime.bigint() - started) / 1_000_000_000;
        const labels = { method: request.method, route };
        metrics.httpRequests.inc({ ...labels, status_code: String(response.statusCode) });
        metrics.httpDuration.observe(labels, seconds);
        if (response.statusCode >= 400) metrics.httpErrors.inc(labels);
        const traceId = boundarySpan?.spanContext().traceId ?? activeTraceId;
        boundarySpan?.setAttributes({ 'http.request.method': request.method, 'http.response.status_code': response.statusCode });
        if (response.statusCode >= 500) boundarySpan?.setStatus({ code: SpanStatusCode.ERROR });
        boundarySpan?.end();
        process.stdout.write(JSON.stringify({
          timestamp: new Date().toISOString(),
          level: response.statusCode >= 500 ? 'error' : 'info',
          service,
          event: 'http_request_completed',
          traceId,
          correlationId,
          method: request.method,
          route,
          statusCode: response.statusCode,
          durationMs: Math.round(seconds * 1000),
        }) + '\n');
      });
      next();
    }, traceCarrier));
  };
}

function routeTemplate(request: Request): string {
  const path = request.route?.path;
  if (typeof path !== 'string') return 'unmatched';
  return (request.baseUrl || '') + path;
}
