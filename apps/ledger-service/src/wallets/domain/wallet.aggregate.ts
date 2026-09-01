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
export const FUNDS_HELD = 'FundsHeld';
export const HOLD_RELEASED = 'HoldReleased';
export const HOLD_CONSUMED = 'HoldConsumed';

export interface HoldState {
  amountMinor: bigint;
  status: 'active' | 'released' | 'consumed';
}

export class WalletAggregate {
  private constructor(
    readonly id: string,
    readonly version: number,
    readonly ownerId: string | null,
    readonly currency: string | null,
    readonly balanceMinor: bigint,
    readonly holds: ReadonlyMap<string, HoldState>,
  ) {}

  static empty(walletId: string): WalletAggregate {
    return new WalletAggregate(walletId, 0, null, null, 0n, new Map());
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
      schemaVersion: 2,
      payload: { ownerId, currencyCode: currency },
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
    if (this.availableMinor < amountMinor) {
      throw new Error('INSUFFICIENT_FUNDS');
    }
    return this.moneyEvent(
      WITHDRAWAL_COMPLETED,
      -amountMinor,
      eventId,
      transactionId,
    );
  }

  get heldMinor(): bigint {
    return [...this.holds.values()].reduce(
      (sum, hold) => sum + (hold.status === 'active' ? hold.amountMinor : 0n),
      0n,
    );
  }

  get availableMinor(): bigint {
    return this.balanceMinor - this.heldMinor;
  }

  placeHold(holdId: string, amountMinor: bigint, eventId: string): EventData | null {
    if (amountMinor <= 0n) throw new Error('INVALID_HOLD_AMOUNT');
    const existing = this.holds.get(holdId);
    if (existing) {
      if (existing.amountMinor !== amountMinor) throw new Error('HOLD_CONFLICT');
      return null;
    }
    if (this.availableMinor < amountMinor) throw new Error('INSUFFICIENT_FUNDS');
    return {
      eventId,
      eventType: FUNDS_HELD,
      schemaVersion: 1,
      payload: { holdId, amountMinor: amountMinor.toString() },
    };
  }

  releaseHold(holdId: string, eventId: string): EventData | null {
    const hold = this.holds.get(holdId);
    if (!hold) throw new Error('HOLD_NOT_FOUND');
    if (hold.status === 'released') return null;
    if (hold.status === 'consumed') throw new Error('HOLD_ALREADY_CONSUMED');
    return { eventId, eventType: HOLD_RELEASED, schemaVersion: 1, payload: { holdId } };
  }

  consumeHold(
    holdId: string,
    eventId: string,
    transactionId: string,
  ): EventData | null {
    const hold = this.holds.get(holdId);
    if (!hold) throw new Error('HOLD_NOT_FOUND');
    if (hold.status === 'consumed') return null;
    if (hold.status === 'released') throw new Error('HOLD_ALREADY_RELEASED');
    return {
      eventId,
      eventType: HOLD_CONSUMED,
      schemaVersion: 1,
      payload: {
        holdId,
        ...createLedgerTransaction(this.id, -hold.amountMinor, transactionId),
      },
    };
  }

  apply(event: StoredEvent): WalletAggregate {
    if (event.streamVersion !== this.version + 1) {
      throw new Error('Wallet event stream contains a version gap');
    }
    if (event.eventType !== WALLET_CREATED && event.schemaVersion !== 1) {
      throw new Error(
        `Unsupported ${event.eventType} schema version ${event.schemaVersion}`,
      );
    }
    if (event.eventType === WALLET_CREATED) {
      const payload = event.payload as {
        ownerId?: unknown;
        currency?: unknown;
        currencyCode?: unknown;
      };
      const currency = event.schemaVersion === 1
        ? payload.currency
        : event.schemaVersion === 2
          ? payload.currencyCode
          : undefined;
      if (
        this.version !== 0 ||
        typeof payload.ownerId !== 'string' ||
        typeof currency !== 'string'
      ) {
        throw new Error('Invalid WalletCreated event');
      }
      return new WalletAggregate(
        this.id,
        event.streamVersion,
        payload.ownerId,
        currency,
        0n,
        new Map(),
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
      if (nextBalance < this.heldMinor) {
        throw new Error('Wallet event stream spends reserved funds');
      }
      return new WalletAggregate(
        this.id,
        event.streamVersion,
        this.ownerId,
        this.currency,
        nextBalance,
        this.holds,
      );
    }
    if (event.eventType === FUNDS_HELD) {
      const { holdId, amountMinor } = this.readHoldPayload(event.payload);
      if (this.holds.has(holdId) || amountMinor <= 0n || amountMinor > this.availableMinor) {
        throw new Error('Invalid FundsHeld event');
      }
      return this.withHold(event.streamVersion, holdId, {
        amountMinor,
        status: 'active',
      });
    }
    if (event.eventType === HOLD_RELEASED) {
      const holdId = this.readHoldId(event.payload);
      const hold = this.holds.get(holdId);
      if (!hold || hold.status !== 'active') throw new Error('Invalid HoldReleased event');
      return this.withHold(event.streamVersion, holdId, { ...hold, status: 'released' });
    }
    if (event.eventType === HOLD_CONSUMED) {
      const holdId = this.readHoldId(event.payload);
      const hold = this.holds.get(holdId);
      if (!hold || hold.status !== 'active') throw new Error('Invalid HoldConsumed event');
      const walletPostings = readPostings(event.payload).filter(
        ({ accountId }) => accountId === walletAccountId(this.id),
      );
      if (
        walletPostings.length !== 1 ||
        parseMinorUnits(walletPostings[0].amountMinor) !== -hold.amountMinor
      ) {
        throw new Error('Hold settlement posting does not match reserved amount');
      }
      const next = this.withHold(event.streamVersion, holdId, {
        ...hold,
        status: 'consumed',
      });
      return new WalletAggregate(
        next.id,
        next.version,
        next.ownerId,
        next.currency,
        next.balanceMinor - hold.amountMinor,
        next.holds,
      );
    }
    throw new Error(`Unsupported wallet event type: ${event.eventType}`);
  }

  private withHold(
    version: number,
    holdId: string,
    hold: HoldState,
  ): WalletAggregate {
    const holds = new Map(this.holds);
    holds.set(holdId, hold);
    return new WalletAggregate(
      this.id,
      version,
      this.ownerId,
      this.currency,
      this.balanceMinor,
      holds,
    );
  }

  private readHoldId(payload: object): string {
    const holdId = (payload as { holdId?: unknown }).holdId;
    if (typeof holdId !== 'string' || !holdId) throw new Error('Invalid holdId');
    return holdId;
  }

  private readHoldPayload(payload: object): { holdId: string; amountMinor: bigint } {
    const holdId = this.readHoldId(payload);
    const amountMinor = (payload as { amountMinor?: unknown }).amountMinor;
    if (typeof amountMinor !== 'string') throw new Error('Invalid hold amount');
    return { holdId, amountMinor: parseMinorUnits(amountMinor) };
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
