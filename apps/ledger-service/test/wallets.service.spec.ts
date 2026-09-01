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

  it('replays persisted WalletCreated v1 and emits the current v2 schema', () => {
    const legacy: StoredEvent = {
      ...stored(WalletAggregate.createdEvent(ownerId, 'USD'), 1),
      schemaVersion: 1,
      payload: { ownerId, currency: 'USD' },
    };

    expect(WalletAggregate.rehydrate(walletId, [legacy])).toMatchObject({
      ownerId,
      currency: 'USD',
      version: 1,
    });
    expect(WalletAggregate.createdEvent(ownerId, 'EUR')).toMatchObject({
      schemaVersion: 2,
      payload: { ownerId, currencyCode: 'EUR' },
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

  it('tracks total, held and available through idempotent hold lifecycle', () => {
    const openedWallet = opened();
    const deposited = openedWallet.deposit(10000n, randomUUID(), randomUUID());
    const funded = openedWallet.apply(stored(deposited, 2));
    const holdId = randomUUID();
    const heldEvent = funded.placeHold(holdId, 6000n, randomUUID());
    if (!heldEvent) throw new Error('Expected FundsHeld event');
    const held = funded.apply(stored(heldEvent, 3));

    expect(held.balanceMinor).toBe(10000n);
    expect(held.heldMinor).toBe(6000n);
    expect(held.availableMinor).toBe(4000n);
    expect(held.placeHold(holdId, 6000n, randomUUID())).toBeNull();
    expect(() => held.placeHold(randomUUID(), 4001n, randomUUID())).toThrow(
      'INSUFFICIENT_FUNDS',
    );

    const releasedEvent = held.releaseHold(holdId, randomUUID());
    if (!releasedEvent) throw new Error('Expected HoldReleased event');
    const released = held.apply(stored(releasedEvent, 4));
    expect(released.heldMinor).toBe(0n);
    expect(released.releaseHold(holdId, randomUUID())).toBeNull();
  });

  it('settles a hold once with balanced postings', () => {
    const initial = opened();
    const funded = initial.apply(
      stored(initial.deposit(10000n, randomUUID(), randomUUID()), 2),
    );
    const holdId = randomUUID();
    const heldEvent = funded.placeHold(holdId, 3000n, randomUUID());
    if (!heldEvent) throw new Error('Expected FundsHeld event');
    const held = funded.apply(stored(heldEvent, 3));
    const consumedEvent = held.consumeHold(holdId, randomUUID(), randomUUID());
    if (!consumedEvent) throw new Error('Expected HoldConsumed event');
    expect(() => assertBalancedPostings(readPostings(consumedEvent.payload))).not.toThrow();
    const consumed = held.apply(stored(consumedEvent, 4));

    expect(consumed.balanceMinor).toBe(7000n);
    expect(consumed.heldMinor).toBe(0n);
    expect(consumed.availableMinor).toBe(7000n);
    expect(consumed.consumeHold(holdId, randomUUID(), randomUUID())).toBeNull();
  });
});
