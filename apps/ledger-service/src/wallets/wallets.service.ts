import { randomUUID } from 'crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { ExpectedStreamVersionError } from '../event-store/event-store.errors';
import { EventStoreService } from '../event-store/event-store.service';
import { amountToMinorUnits, formatMinorUnits } from '../ledger/domain/ledger-transaction';
import { WalletAggregate } from './domain/wallet.aggregate';
import { WalletBalanceProjection } from './entities/wallet-balance-projection.entity';
import { Wallet } from './entities/wallet.entity';

export type WalletView = Wallet & { balance: string };
const MAX_CONCURRENCY_RETRIES = 25;

@Injectable()
export class WalletsService {
  constructor(
    @InjectRepository(Wallet) private readonly wallets: Repository<Wallet>,
    @InjectRepository(WalletBalanceProjection)
    private readonly balances: Repository<WalletBalanceProjection>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly eventStore: EventStoreService,
  ) {}

  async getOrCreateForUser(userId: string, currency = 'USD'): Promise<WalletView> {
    const existing = await this.wallets.findOne({ where: { ownerId: userId, currency } });
    if (existing) return this.toView(existing, await this.getProjection(existing.id));

    try {
      return await this.dataSource.transaction(async (manager) => {
        const wallets = manager.getRepository(Wallet);
        const balances = manager.getRepository(WalletBalanceProjection);
        const raced = await wallets.findOne({ where: { ownerId: userId, currency } });
        if (raced) {
          return this.toView(
            raced,
            await balances.findOneByOrFail({ walletId: raced.id }),
          );
        }
        const wallet = await wallets.save(wallets.create({ ownerId: userId, currency }));
        const [created] = await this.eventStore.appendWithinTransaction(
          {
            streamId: wallet.id,
            aggregateType: 'Wallet',
            expectedVersion: 0,
            events: [WalletAggregate.createdEvent(userId, currency)],
          },
          manager,
        );
        const projection = await balances.save(
          balances.create({ walletId: wallet.id, balanceMinor: '0', streamVersion: created.streamVersion }),
        );
        return this.toView(wallet, projection);
      });
    } catch (error: unknown) {
      if (!this.isUniqueViolation(error)) throw error;
      const wallet = await this.wallets.findOne({ where: { ownerId: userId, currency } });
      if (!wallet) throw new Error('Wallet creation did not produce a persistent wallet');
      return this.toView(wallet, await this.getProjection(wallet.id));
    }
  }

  async listForUser(userId: string): Promise<WalletView[]> {
    await this.getOrCreateForUser(userId);
    const wallets = await this.wallets.find({ where: { ownerId: userId } });
    const projections = await this.balances.findBy({
      walletId: In(wallets.map(({ id }) => id)),
    });
    const byWallet = new Map(projections.map((item) => [item.walletId, item]));
    return wallets.map((wallet) => {
      const projection = byWallet.get(wallet.id);
      if (!projection) throw new Error(`Missing balance projection for wallet ${wallet.id}`);
      return this.toView(wallet, projection);
    });
  }

  async getById(walletId: string, ownerId: string): Promise<WalletView> {
    const wallet = await this.wallets.findOne({ where: { id: walletId, ownerId } });
    if (!wallet) throw new NotFoundException('Гаманець не знайдено');
    return this.toView(wallet, await this.getProjection(wallet.id));
  }

  deposit(walletId: string, ownerId: string, amount: number): Promise<WalletView> {
    return this.executeMoneyCommand(walletId, ownerId, amount, 'deposit');
  }

  withdraw(walletId: string, ownerId: string, amount: number): Promise<WalletView> {
    return this.executeMoneyCommand(walletId, ownerId, amount, 'withdraw');
  }

  rebuildBalanceProjection(walletId: string): Promise<WalletBalanceProjection> {
    return this.dataSource.transaction(async (manager) => {
      const wallet = await manager.getRepository(Wallet).findOneBy({ id: walletId });
      if (!wallet) throw new NotFoundException('Гаманець не знайдено');
      const aggregate = WalletAggregate.rehydrate(
        walletId,
        await this.eventStore.loadStream(walletId, 1, manager),
      );
      this.assertAggregateIdentity(wallet, aggregate);
      const balances = manager.getRepository(WalletBalanceProjection);
      return balances.save(
        balances.create({
          walletId,
          balanceMinor: aggregate.balanceMinor.toString(),
          streamVersion: aggregate.version,
        }),
      );
    });
  }

  private async executeMoneyCommand(
    walletId: string,
    ownerId: string,
    amount: number,
    operation: 'deposit' | 'withdraw',
  ): Promise<WalletView> {
    let amountMinor: bigint;
    try {
      amountMinor = amountToMinorUnits(amount);
    } catch (error: unknown) {
      throw new BadRequestException(error instanceof Error ? error.message : 'Некоректна сума');
    }
    if (amountMinor <= 0n) throw new BadRequestException('Сума повинна бути додатною');
    const eventId = randomUUID();
    const transactionId = randomUUID();

    for (let attempt = 1; attempt <= MAX_CONCURRENCY_RETRIES; attempt += 1) {
      try {
        return await this.dataSource.transaction((manager) =>
          this.executeMoneyCommandAttempt(
            manager,
            walletId,
            ownerId,
            amountMinor,
            operation,
            eventId,
            transactionId,
          ),
        );
      } catch (error: unknown) {
        if (error instanceof ExpectedStreamVersionError && attempt < MAX_CONCURRENCY_RETRIES) {
          continue;
        }
        throw error;
      }
    }
    throw new Error('Unreachable concurrency retry state');
  }

  private async executeMoneyCommandAttempt(
    manager: EntityManager,
    walletId: string,
    ownerId: string,
    amountMinor: bigint,
    operation: 'deposit' | 'withdraw',
    eventId: string,
    transactionId: string,
  ): Promise<WalletView> {
    const wallet = await manager.getRepository(Wallet).findOne({
      where: { id: walletId, ownerId },
    });
    if (!wallet) throw new NotFoundException('Гаманець не знайдено');

    const history = await this.eventStore.loadStream(walletId, 1, manager);
    const aggregate = WalletAggregate.rehydrate(walletId, history);
    this.assertAggregateIdentity(wallet, aggregate);
    let domainEvent;
    try {
      domainEvent = operation === 'deposit'
        ? aggregate.deposit(amountMinor, eventId, transactionId)
        : aggregate.withdraw(amountMinor, eventId, transactionId);
    } catch (error: unknown) {
      if (error instanceof Error && error.message === 'INSUFFICIENT_FUNDS') {
        throw new BadRequestException('Недостатньо коштів');
      }
      throw error;
    }

    const [stored] = await this.eventStore.appendWithinTransaction(
      {
        streamId: wallet.id,
        aggregateType: 'Wallet',
        expectedVersion: aggregate.version,
        events: [domainEvent],
      },
      manager,
    );
    const updated = aggregate.apply(stored);
    const balances = manager.getRepository(WalletBalanceProjection);
    const projection = await balances.save(
      balances.create({
        walletId: wallet.id,
        balanceMinor: updated.balanceMinor.toString(),
        streamVersion: updated.version,
      }),
    );
    return this.toView(wallet, projection);
  }

  private async getProjection(walletId: string): Promise<WalletBalanceProjection> {
    const projection = await this.balances.findOne({ where: { walletId } });
    if (!projection) throw new Error(`Missing balance projection for wallet ${walletId}`);
    return projection;
  }

  private toView(wallet: Wallet, projection: WalletBalanceProjection): WalletView {
    return { ...wallet, balance: formatMinorUnits(BigInt(projection.balanceMinor)) };
  }

  private assertAggregateIdentity(
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

  private isUniqueViolation(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) return false;
    const databaseError = error as { code?: unknown; driverError?: { code?: unknown } };
    return databaseError.code === '23505' || databaseError.driverError?.code === '23505';
  }
}
