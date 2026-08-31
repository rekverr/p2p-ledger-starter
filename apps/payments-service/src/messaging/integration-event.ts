export interface PaymentIntegrationEvent {
  eventId: string;
  eventType: string;
  schemaVersion: number;
  occurredAt: string;
  producer: 'payments-service';
  correlationId: string;
  traceId: string | null;
  aggregate: {
    type: 'Transfer';
    id: string;
    version: number;
  };
  payload: {
    senderUserId: string;
    senderWalletId: string;
    receiverWalletId: string;
    amountMinor: string;
    currency: string;
    status: 'Completed';
  };
}
