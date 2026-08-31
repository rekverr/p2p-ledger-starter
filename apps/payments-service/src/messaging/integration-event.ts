export interface PaymentIntegrationEvent {
  eventId: string;
  eventType: string;
  schemaVersion: number;
  occurredAt: string;
  producer: 'payments-service';
  correlationId: string;
  traceId: string | null;
  aggregate: {
    type: 'Transfer' | 'SplitBill' | 'SplitBillShare';
    id: string;
    version: number;
  };
  payload: Record<string, unknown>;
}
