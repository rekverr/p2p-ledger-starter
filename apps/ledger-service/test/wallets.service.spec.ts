import { randomUUID } from 'crypto';
import { StoredEvent } from '../src/event-store/entities/stored-event.entity';
import {
  assertBalancedPostings,
  createLedgerTransaction,
  readPostings,
} from '../src/ledger/domain/ledger-transaction';
import { WalletAggregate } from '../src/wallets/domain/wallet.aggregate';

describe('Wallet aggregate and double-entry journal', () => {
  const walletId = randomUUID();
  const ownerId = randomUUID();

  function stored(
    event: ReturnType<typeof WalletAggregate.createdEvent>,
    streamVersion: number,
  ): StoredEvent {
    return {
      ...event,
      streamId: walletId,
      aggregateType: 'Wallet',
      streamVersion,
      metadata: {},
      correlationId: null,
      traceId: null,
      createdAt: new Date('2026-01-01T00:00:00Z'),
    };
  }

  function opened(): WalletAggregate {
    return WalletAggregate.rehydrate(walletId, [
      stored(WalletAggregate.createdEvent(ownerId, 'USD'), 1),
    ]);
  }

  it('replays wallet state from ordered events', () => {
    const initial = opened();
    const deposit = initial.deposit(10000n, randomUUID(), randomUUID());
    const afterDeposit = initial.apply(stored(deposit, 2));
    const withdrawal = afterDeposit.withdraw(2500n, randomUUID(), randomUUID());

    const replayed = WalletAggregate.rehydrate(walletId, [
      stored(WalletAggregate.createdEvent(ownerId, 'USD'), 1),
      stored(deposit, 2),
      stored(withdrawal, 3),
    ]);

    expect(replayed).toMatchObject({
      version: 3,
      ownerId,
      currency: 'USD',
      balanceMinor: 7500n,
    });
  });

  it('creates balanced postings for deposit and withdrawal', () => {
    const aggregate = opened();
    const deposit = aggregate.deposit(5000n, randomUUID(), randomUUID());
    const afterDeposit = aggregate.apply(stored(deposit, 2));
    const withdrawal = afterDeposit.withdraw(2000n, randomUUID(), randomUUID());

    expect(() => assertBalancedPostings(readPostings(deposit.payload))).not.toThrow();
    expect(() => assertBalancedPostings(readPostings(withdrawal.payload))).not.toThrow();
    expect(afterDeposit.apply(stored(withdrawal, 3)).balanceMinor).toBe(3000n);
  });

  it('rejects insufficient funds before producing an event', () => {
    expect(() => opened().withdraw(1n, randomUUID(), randomUUID())).toThrow(
      'INSUFFICIENT_FUNDS',
    );
  });

  it('rejects an unbalanced journal transaction', () => {
    expect(() =>
      assertBalancedPostings([
        { accountId: `wallet:${walletId}`, amountMinor: '100' },
        { accountId: 'system:external', amountMinor: '-99' },
      ]),
    ).toThrow('Ledger postings are not balanced');
  });

  it('constructs signed-equivalent double-entry transactions', () => {
    const transaction = createLedgerTransaction(walletId, 1234n);
    expect(transaction.postings).toEqual([
      { accountId: `wallet:${walletId}`, amountMinor: '1234' },
      { accountId: 'system:external', amountMinor: '-1234' },
    ]);
  });
});
