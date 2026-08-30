import { randomUUID } from 'crypto';
import { StoredEvent } from '../../event-store/entities/stored-event.entity';
import { EventData, JsonObject } from '../../event-store/event-store.types';
import {
  createLedgerTransaction,
  parseMinorUnits,
  readPostings,
  walletAccountId,
} from '../../ledger/domain/ledger-transaction';

export const WALLET_CREATED = 'WalletCreated';
export const MONEY_DEPOSITED = 'MoneyDeposited';
export const WITHDRAWAL_COMPLETED = 'WithdrawalCompleted';

export class WalletAggregate {
  private constructor(
    readonly id: string,
    readonly version: number,
    readonly ownerId: string | null,
    readonly currency: string | null,
    readonly balanceMinor: bigint,
  ) {}

  static empty(walletId: string): WalletAggregate {
    return new WalletAggregate(walletId, 0, null, null, 0n);
  }

  static rehydrate(walletId: string, events: StoredEvent[]): WalletAggregate {
    return events.reduce(
      (aggregate, event) => aggregate.apply(event),
      WalletAggregate.empty(walletId),
    );
  }

  static createdEvent(ownerId: string, currency: string): EventData {
    return {
      eventId: randomUUID(),
      eventType: WALLET_CREATED,
      schemaVersion: 1,
      payload: { ownerId, currency },
    };
  }

  deposit(amountMinor: bigint, eventId: string, transactionId: string): EventData {
    return this.moneyEvent(
      MONEY_DEPOSITED,
      amountMinor,
      eventId,
      transactionId,
    );
  }

  withdraw(amountMinor: bigint, eventId: string, transactionId: string): EventData {
    if (this.balanceMinor < amountMinor) {
      throw new Error('INSUFFICIENT_FUNDS');
    }
    return this.moneyEvent(
      WITHDRAWAL_COMPLETED,
      -amountMinor,
      eventId,
      transactionId,
    );
  }

  apply(event: StoredEvent): WalletAggregate {
    if (event.streamVersion !== this.version + 1) {
      throw new Error('Wallet event stream contains a version gap');
    }
    if (event.schemaVersion !== 1) {
      throw new Error(
        `Unsupported ${event.eventType} schema version ${event.schemaVersion}`,
      );
    }
    if (event.eventType === WALLET_CREATED) {
      const payload = event.payload as { ownerId?: unknown; currency?: unknown };
      if (
        this.version !== 0 ||
        typeof payload.ownerId !== 'string' ||
        typeof payload.currency !== 'string'
      ) {
        throw new Error('Invalid WalletCreated event');
      }
      return new WalletAggregate(
        this.id,
        event.streamVersion,
        payload.ownerId,
        payload.currency,
        0n,
      );
    }
    if (
      event.eventType === MONEY_DEPOSITED ||
      event.eventType === WITHDRAWAL_COMPLETED
    ) {
      const postings = readPostings(event.payload);
      const walletPostings = postings.filter(
        ({ accountId }) => accountId === walletAccountId(this.id),
      );
      if (walletPostings.length !== 1) {
        throw new Error('Ledger event must contain one wallet posting');
      }
      const nextBalance =
        this.balanceMinor + parseMinorUnits(walletPostings[0].amountMinor);
      if (nextBalance < 0n) {
        throw new Error('Wallet event stream produces a negative balance');
      }
      return new WalletAggregate(
        this.id,
        event.streamVersion,
        this.ownerId,
        this.currency,
        nextBalance,
      );
    }
    throw new Error(`Unsupported wallet event type: ${event.eventType}`);
  }

  private moneyEvent(
    eventType: string,
    walletAmountMinor: bigint,
    eventId: string,
    transactionId: string,
  ): EventData {
    const transaction = createLedgerTransaction(
      this.id,
      walletAmountMinor,
      transactionId,
    );
    return {
      eventId,
      eventType,
      schemaVersion: 1,
      payload: transaction as JsonObject,
    };
  }
}
