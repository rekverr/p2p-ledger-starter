import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Between, DataSource } from 'typeorm';
import { StoredEvent } from '../event-store/entities/stored-event.entity';
import { EventStoreService } from '../event-store/event-store.service';
import { formatMinorUnits, parseMinorUnits } from '../ledger/domain/ledger-transaction';
import {
  HOLD_CONSUMED,
  MONEY_DEPOSITED,
  WITHDRAWAL_COMPLETED,
  WalletAggregate,
} from '../wallets/domain/wallet.aggregate';
import { WalletBalanceProjection } from '../wallets/entities/wallet-balance-projection.entity';
import { Wallet } from '../wallets/entities/wallet.entity';

const POSTING_EVENTS = [MONEY_DEPOSITED, WITHDRAWAL_COMPLETED, HOLD_CONSUMED];

@Injectable()
export class LedgerMaintenanceService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly eventStore: EventStoreService,
  ) {}

  async walletEventLog(walletId: string): Promise<StoredEvent[]> {
    await this.getWallet(walletId);
    return this.eventStore.loadStream(walletId);
  }

  async reconcileWallet(walletId: string) {
    const wallet = await this.getWallet(walletId);
    const aggregate = WalletAggregate.rehydrate(
      walletId,
      await this.eventStore.loadStream(walletId),
    );
    this.assertWalletIdentity(wallet, aggregate);
    const projection = await this.dataSource
      .getRepository(WalletBalanceProjection)
      .findOneBy({ walletId });
    const derived = this.state(aggregate);
    const materialized = projection
      ? {
          total: formatMinorUnits(BigInt(projection.balanceMinor)),
          held: formatMinorUnits(BigInt(projection.heldMinor)),
          available: formatMinorUnits(BigInt(projection.availableMinor)),
          streamVersion: projection.streamVersion,
        }
      : null;
    return {
      walletId,
      consistent:
        materialized !== null &&
        JSON.stringify(derived) === JSON.stringify(materialized),
      eventDerived: derived,
      projection: materialized,
    };
  }

  async reconcileGlobal(from?: string, to?: string) {
    const start = from ? new Date(from) : new Date(0);
    const end = to ? new Date(to) : new Date('9999-12-31T23:59:59.999Z');
    const events = await this.dataSource.getRepository(StoredEvent).find({
      where: { createdAt: Between(start, end) },
      order: { createdAt: 'ASC', streamVersion: 'ASC' },
    });
    let credits = 0n;
    let debits = 0n;
    let transactionCount = 0;
    const invalidTransactionEventIds: string[] = [];
    for (const event of events) {
      if (!POSTING_EVENTS.includes(event.eventType)) continue;
      transactionCount += 1;
      const amounts = this.postingAmounts(event);
      if (!amounts) {
        invalidTransactionEventIds.push(event.eventId);
        continue;
      }
      if (amounts.reduce((sum, amount) => sum + amount, 0n) !== 0n) {
        invalidTransactionEventIds.push(event.eventId);
      }
      for (const amount of amounts) {
        if (amount >= 0n) credits += amount;
        else debits += -amount;
      }
    }
    return {
      from: start.toISOString(),
      to: end.toISOString(),
      transactionCount,
      creditsMinor: credits.toString(),
      debitsMinor: debits.toString(),
      invalidTransactionEventIds,
      balanced:
        invalidTransactionEventIds.length === 0 && credits === debits,
    };
  }

  async rebuildAllBalanceProjections() {
    return this.dataSource.transaction('SERIALIZABLE', async (manager) => {
      const wallets = await manager.getRepository(Wallet).find({ order: { id: 'ASC' } });
      const balances = manager.getRepository(WalletBalanceProjection);
      for (const wallet of wallets) {
        const aggregate = WalletAggregate.rehydrate(
          wallet.id,
          await this.eventStore.loadStream(wallet.id, 1, manager),
        );
        this.assertWalletIdentity(wallet, aggregate);
        await balances.save(
          balances.create({
            walletId: wallet.id,
            balanceMinor: aggregate.balanceMinor.toString(),
            heldMinor: aggregate.heldMinor.toString(),
            availableMinor: aggregate.availableMinor.toString(),
            streamVersion: aggregate.version,
          }),
        );
      }
      return { rebuiltWallets: wallets.length };
    });
  }

  private state(aggregate: WalletAggregate) {
    return {
      total: formatMinorUnits(aggregate.balanceMinor),
      held: formatMinorUnits(aggregate.heldMinor),
      available: formatMinorUnits(aggregate.availableMinor),
      streamVersion: aggregate.version,
    };
  }

  private async getWallet(walletId: string): Promise<Wallet> {
    const wallet = await this.dataSource.getRepository(Wallet).findOneBy({ id: walletId });
    if (!wallet) throw new NotFoundException('Гаманець не знайдено');
    return wallet;
  }

  private assertWalletIdentity(
    wallet: Wallet,
    aggregate: WalletAggregate,
  ): void {
    if (
      aggregate.ownerId !== wallet.ownerId ||
      aggregate.currency !== wallet.currency
    ) {
      throw new Error(`Wallet stream identity mismatch for ${wallet.id}`);
    }
  }

  private postingAmounts(event: StoredEvent): bigint[] | null {
    const postings = (event.payload as { postings?: unknown }).postings;
    if (!Array.isArray(postings) || postings.length < 2) return null;
    try {
      return postings.map((posting: unknown) => {
        if (
          typeof posting !== 'object' ||
          posting === null ||
          !('accountId' in posting) ||
          !('amountMinor' in posting) ||
          typeof posting.accountId !== 'string' ||
          typeof posting.amountMinor !== 'string'
        ) {
          throw new Error('Invalid posting');
        }
        return parseMinorUnits(posting.amountMinor);
      });
    } catch {
      return null;
    }
  }
}
