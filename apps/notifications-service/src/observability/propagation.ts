import { Context, context, propagation, trace } from '@opentelemetry/api';
import { currentTraceCarrier } from './context';

export interface TraceCarrier {
  traceparent?: string;
  tracestate?: string;
}

export function captureTraceCarrier(activeContext: Context = context.active()): TraceCarrier {
  const carrier: Record<string, string> = {};
  propagation.inject(activeContext, carrier);
  const fallback = currentTraceCarrier();
  return { traceparent: carrier.traceparent ?? fallback?.traceparent, tracestate: carrier.tracestate ?? fallback?.tracestate };
}

export function injectTraceHeaders(
  headers: Record<string, string>,
  activeContext: Context = context.active(),
): Record<string, string> {
  propagation.inject(activeContext, headers);
  return headers;
}

export function extractTraceContext(carrier: Record<string, unknown>): Context {
  return propagation.extract(context.active(), carrier);
}

export function activeTraceId(): string | null {
  return trace.getSpan(context.active())?.spanContext().traceId ?? null;
}
