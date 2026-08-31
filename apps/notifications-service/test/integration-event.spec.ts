import {
  assertTrustedIntegrationEvent,
  parseIntegrationEvent,
} from '../src/messaging/integration-event';

describe('integration event contract', () => {
  it('requires a versioned envelope with aggregate identity', () => {
    expect(() => parseIntegrationEvent({ eventId: 'incomplete' })).toThrow(
      'Invalid event envelope',
    );
  });
});

describe('integration event producer trust', () => {
  it('rejects a producer/routing-key mismatch', () => {
    const event = parseIntegrationEvent({
      eventId: 'b3c34a63-528d-4a44-91cc-599a34422ed0',
      eventType: 'payments.transfer.Completed',
      schemaVersion: 1,
      occurredAt: new Date().toISOString(),
      producer: 'payments-service',
      correlationId: null,
      traceId: null,
      aggregate: { type: 'Transfer', id: 'transfer-1', version: 1 },
      payload: {},
    });

    expect(() => assertTrustedIntegrationEvent(event, 'ledger.wallet.changed.v1'))
      .toThrow('Untrusted producer');
  });
});
