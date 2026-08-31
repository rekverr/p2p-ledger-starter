import { JsonObject } from '../event-store/event-store.types';

export interface IntegrationEventEnvelope {
  eventId: string;
  eventType: string;
  schemaVersion: number;
  occurredAt: string;
  producer: string;
  correlationId: string | null;
  traceId: string | null;
  traceparent?: string;
  tracestate?: string;
  aggregate: {
    type: string;
    id: string;
    version: number;
  };
  payload: JsonObject;
}

export function walletRoutingKey(eventType: string, schemaVersion: number): string {
  const normalized = eventType.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
  return `ledger.wallet.${normalized}.v${schemaVersion}`;
}
