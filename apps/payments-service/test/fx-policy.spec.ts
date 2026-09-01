import { randomUUID } from 'crypto';
import { quoteTransfer } from '../src/transfers/domain/fx-quote';
import { TransferStatus } from '../src/transfers/domain/transfer-status';
import { Transfer } from '../src/transfers/entities/transfer.entity';
import { LedgerCommandError } from '../src/transfers/ledger.gateway';
import { TransferPolicyService } from '../src/transfers/transfer-policy.service';

describe('FX quote and deterministic transfer policy', () => {
  const environment = { ...process.env };

  afterEach(() => {
    process.env = { ...environment };
  });

  it('converts with integer half-up arithmetic and produces a persisted quote shape', () => {
    const at = new Date('2026-01-01T00:00:00.000Z');
    const quote = quoteTransfer('10000', 'USD', 'EUR', at);

    expect(quote).toMatchObject({
      destinationAmountMinor: '9200',
      rateNumerator: '1000000',
      rateDenominator: '1087000',
      displayRate: '0.91996320',
      quotedAt: at,
    });
    expect(quote.expiresAt.toISOString()).toBe('2026-01-01T00:15:00.000Z');
  });

  it.each([
    ['TRANSFER_LIMIT_EXCEEDED', { amountMinor: '1000001' }],
    ['RECEIVER_BLOCKED', { receiverReference: 'blocked@example.com' }],
    ['FX_QUOTE_EXPIRED', { fxExpiresAt: new Date('2025-12-31T23:59:59Z') }],
  ])('rejects the real policy path with %s', (code, patch) => {
    process.env.MAX_TRANSFER_AMOUNT = '10000';
    process.env.BLOCKED_RECEIVER_REFERENCES = 'blocked@example.com';
    const transfer = sampleTransfer(patch);

    expect(() => new TransferPolicyService().validate(
      transfer,
      new Date('2026-01-01T00:00:00Z'),
    )).toThrow(expect.objectContaining<Partial<LedgerCommandError>>({ code }));
  });
});

function sampleTransfer(patch: Partial<Transfer>): Transfer {
  return Object.assign(new Transfer(), {
    id: randomUUID(),
    senderUserId: randomUUID(),
    senderWalletId: randomUUID(),
    receiverReference: 'receiver@example.com',
    receiverWalletId: null,
    splitBillShareId: null,
    amountMinor: '10000',
    currency: 'USD',
    destinationAmountMinor: '9200',
    destinationCurrency: 'EUR',
    fxRateNumerator: '1000000',
    fxRateDenominator: '1087000',
    fxDisplayRate: '0.91996320',
    fxQuotedAt: new Date('2026-01-01T00:00:00Z'),
    fxExpiresAt: new Date('2026-01-01T00:15:00Z'),
    status: TransferStatus.Pending,
    idempotencyKey: 'key',
    requestFingerprint: 'a'.repeat(64),
    failureCode: null,
    failureMessage: null,
    retryCount: 0,
    nextRetryAt: null,
    holdMayExist: false,
    lastAttemptAt: null,
    leaseOwner: null,
    leaseUntil: null,
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...patch,
  });
}
