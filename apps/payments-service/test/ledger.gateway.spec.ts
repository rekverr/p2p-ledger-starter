import { randomUUID } from 'crypto';
import { TransferStatus } from '../src/transfers/domain/transfer-status';
import { Transfer } from '../src/transfers/entities/transfer.entity';
import {
  LedgerCommandError,
  LedgerHttpClient,
} from '../src/transfers/ledger.gateway';

describe('LedgerHttpClient resilience', () => {
  const originalEnvironment = { ...process.env };

  afterEach(() => {
    jest.restoreAllMocks();
    process.env = { ...originalEnvironment };
  });

  beforeEach(() => {
    process.env.PAYMENTS_SERVICE_TOKEN = 'test-service-token';
  });

  it('bounds retries for retryable responses', async () => {
    process.env.LEDGER_HTTP_MAX_ATTEMPTS = '2';
    process.env.LEDGER_HTTP_BACKOFF_MS = '0';
    process.env.LEDGER_CIRCUIT_FAILURE_THRESHOLD = '10';
    const request = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ message: 'temporary failure' }), {
        status: 503,
        headers: { 'content-type': 'application/json' },
      }),
    );

    await expect(new LedgerHttpClient().validate(transfer())).rejects.toMatchObject({
      code: 'LEDGER_HTTP_503',
      kind: 'retryable',
    });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('opens the circuit after the configured consecutive failure threshold', async () => {
    process.env.LEDGER_HTTP_MAX_ATTEMPTS = '1';
    process.env.LEDGER_CIRCUIT_FAILURE_THRESHOLD = '1';
    process.env.LEDGER_CIRCUIT_COOLDOWN_MS = '60000';
    const request = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ message: 'down' }), { status: 503 }),
    );
    const client = new LedgerHttpClient();

    await expect(client.validate(transfer())).rejects.toBeInstanceOf(
      LedgerCommandError,
    );
    await expect(client.validate(transfer())).rejects.toMatchObject({
      code: 'LEDGER_CIRCUIT_OPEN',
    });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('aborts a timed-out request and classifies it as ambiguous/retryable', async () => {
    process.env.LEDGER_HTTP_MAX_ATTEMPTS = '1';
    process.env.LEDGER_HTTP_TIMEOUT_MS = '5';
    process.env.LEDGER_CIRCUIT_FAILURE_THRESHOLD = '10';
    jest.spyOn(global, 'fetch').mockImplementation((_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const error = new Error('aborted');
          error.name = 'AbortError';
          reject(error);
        });
      }),
    );

    await expect(new LedgerHttpClient().validate(transfer())).rejects.toMatchObject({
      code: 'LEDGER_TIMEOUT',
      kind: 'retryable',
      ambiguous: true,
    });
  });
});

function transfer(): Transfer {
  return {
    id: randomUUID(),
    senderUserId: randomUUID(),
    senderWalletId: randomUUID(),
    receiverReference: 'receiver@example.com',
    receiverWalletId: null,
    amountMinor: '1000',
    currency: 'USD',
    destinationAmountMinor: '920',
    destinationCurrency: 'EUR',
    fxRateNumerator: '1000000',
    fxRateDenominator: '1087000',
    fxDisplayRate: '0.91996320',
    fxQuotedAt: new Date(),
    fxExpiresAt: new Date(Date.now() + 900_000),
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
  };
}
