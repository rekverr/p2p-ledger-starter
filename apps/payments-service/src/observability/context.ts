import { AsyncLocalStorage } from 'async_hooks';

interface RequestContext {
  correlationId: string;
  traceCarrier?: { traceparent?: string; tracestate?: string };
}

const storage = new AsyncLocalStorage<RequestContext>();

export function withRequestContext<T>(correlationId: string, callback: () => T, traceCarrier?: RequestContext['traceCarrier']): T {
  return storage.run({ correlationId, traceCarrier }, callback);
}

export function currentTraceCarrier(): RequestContext['traceCarrier'] {
  return storage.getStore()?.traceCarrier;
}

export function currentCorrelationId(): string | undefined {
  return storage.getStore()?.correlationId;
}
