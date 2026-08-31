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
  payload: Record<string, unknown>;
}

export function parseIntegrationEvent(value: unknown): IntegrationEventEnvelope {
  if (typeof value !== 'object' || value === null) throw new Error('Invalid event envelope');
  const event = value as Partial<IntegrationEventEnvelope>;
  if (
    typeof event.eventId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(event.eventId) ||
    typeof event.eventType !== 'string' ||
    !Number.isInteger(event.schemaVersion) ||
    Number(event.schemaVersion) < 1 ||
    typeof event.occurredAt !== 'string' ||
    Number.isNaN(Date.parse(event.occurredAt)) ||
    typeof event.producer !== 'string' ||
    typeof event.aggregate !== 'object' ||
    event.aggregate === null ||
    typeof event.aggregate.type !== 'string' ||
    typeof event.aggregate.id !== 'string' ||
    !Number.isInteger(event.aggregate.version) ||
    Number(event.aggregate.version) < 1 ||
    typeof event.payload !== 'object' ||
    event.payload === null
  ) {
    throw new Error('Invalid event envelope');
  }
  return event as IntegrationEventEnvelope;
}

export function assertTrustedIntegrationEvent(
  event: IntegrationEventEnvelope,
  routingKey: string,
): void {
  const ledger =
    event.producer === 'ledger-service' &&
    event.eventType.startsWith('ledger.wallet.') &&
    routingKey.startsWith('ledger.');
  const payments =
    event.producer === 'payments-service' &&
    event.eventType.startsWith('payments.') &&
    routingKey.startsWith('payments.');
  if (!ledger && !payments) {
    throw new Error('Untrusted producer, event type or routing key combination');
  }
}
