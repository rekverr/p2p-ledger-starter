import { randomUUID } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, ILike, In, Repository } from 'typeorm';
import { User } from '../auth/entities/user.entity';
import { ExpectedStreamVersionError } from '../event-store/event-store.errors';
import { EventStoreService } from '../event-store/event-store.service';
import { amountToMinorUnits, formatMinorUnits } from '../ledger/domain/ledger-transaction';
import { OutboxService } from '../messaging/outbox.service';
import { WalletAggregate } from './domain/wallet.aggregate';
import { WalletBalanceProjection } from './entities/wallet-balance-projection.entity';
import { Wallet } from './entities/wallet.entity';
import { LedgerTransferSettlement } from './entities/ledger-transfer-settlement.entity';
import {
  HoldInternalTransferDto,
  ReleaseInternalTransferDto,
  SettleInternalTransferDto,
  ValidateInternalTransferDto,
} from './dto/internal-transfer.dto';

export type WalletView = Wallet & {
  balance: string;
  held: string;
  available: string;
};
const MAX_CONCURRENCY_RETRIES = 25;

@Injectable()
export class WalletsService {
  constructor(
    @InjectRepository(Wallet) private readonly wallets: Repository<Wallet>,
    @InjectRepository(WalletBalanceProjection)
    private readonly balances: Repository<WalletBalanceProjection>,
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(LedgerTransferSettlement)
    private readonly transferSettlements: Repository<LedgerTransferSettlement>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly eventStore: EventStoreService,
    private readonly outbox: OutboxService,
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
        await this.outbox.enqueueWalletEvents([created], wallet, manager);
        const projection = await balances.save(
          balances.create({
            walletId: wallet.id,
            balanceMinor: '0',
            heldMinor: '0',
            availableMinor: '0',
            streamVersion: created.streamVersion,
          }),
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

  placeHold(
    walletId: string,
    ownerId: string,
    holdId: string,
    amount: number,
  ): Promise<WalletView> {
    let amountMinor: bigint;
    try {
      amountMinor = amountToMinorUnits(amount);
    } catch (error: unknown) {
      throw new BadRequestException(error instanceof Error ? error.message : 'Некоректна сума');
    }
    if (amountMinor <= 0n) throw new BadRequestException('Сума повинна бути додатною');
    return this.executeHoldCommand(walletId, ownerId, holdId, 'place', amountMinor);
  }

  releaseHold(walletId: string, ownerId: string, holdId: string): Promise<WalletView> {
    return this.executeHoldCommand(walletId, ownerId, holdId, 'release');
  }

  consumeHold(walletId: string, ownerId: string, holdId: string): Promise<WalletView> {
    return this.executeHoldCommand(walletId, ownerId, holdId, 'consume');
  }

  async validateTransfer(
    command: ValidateInternalTransferDto,
  ): Promise<{ receiverWalletId: string }> {
    this.toPositiveMinorUnits(command.amount);
    if (command.destinationAmount !== undefined) {
      this.toPositiveMinorUnits(command.destinationAmount);
    }
    const targetCurrency = command.targetCurrency ?? command.currency;
    const sender = await this.wallets.findOne({
      where: {
        id: command.senderWalletId,
        ownerId: command.senderUserId,
        currency: command.currency,
      },
    });
    if (!sender) throw new NotFoundException('Sender wallet not found');

    let receiver = this.isUuid(command.receiverReference)
      ? await this.wallets.findOne({
          where: { id: command.receiverReference, currency: targetCurrency },
        })
      : null;
    if (!receiver) {
      const receiverUser = await this.users.findOne({
        where: { email: ILike(command.receiverReference) },
      });
      if (!receiverUser) throw new NotFoundException('Receiver not found');
      receiver = await this.wallets.findOne({
        where: { ownerId: receiverUser.id, currency: targetCurrency },
      });
      if (!receiver) {
        const created = await this.getOrCreateForUser(
          receiverUser.id,
          targetCurrency,
        );
        receiver = await this.wallets.findOneByOrFail({ id: created.id });
      }
    }
    if (receiver.id === sender.id) {
      throw new BadRequestException('Sender and receiver wallets must differ');
    }
    return { receiverWalletId: receiver.id };
  }

  placeTransferHold(
    transferId: string,
    command: HoldInternalTransferDto,
  ): Promise<WalletView> {
    return this.placeHold(
      command.senderWalletId,
      command.senderUserId,
      transferId,
      command.amount,
    );
  }

  async releaseTransferHold(
    transferId: string,
    command: ReleaseInternalTransferDto,
  ): Promise<{ outcome: 'released' | 'already_settled' }> {
    if (await this.transferSettlements.exist({ where: { transferId } })) {
      return { outcome: 'already_settled' };
    }
    try {
      await this.executeHoldCommand(
        command.senderWalletId,
        command.senderUserId,
        transferId,
        'release',
        undefined,
        true,
      );
      return { outcome: 'released' };
    } catch (error: unknown) {
      if (await this.transferSettlements.exist({ where: { transferId } })) {
        return { outcome: 'already_settled' };
      }
      throw error;
    }
  }

  async settleTransfer(
    transferId: string,
    command: SettleInternalTransferDto,
  ): Promise<{ sender: WalletView; receiver: WalletView }> {
    const amountMinor = this.toPositiveMinorUnits(command.amount);
    const destinationAmountMinor = this.toPositiveMinorUnits(
      command.destinationAmount ?? command.amount,
    );
    const destinationCurrency = command.targetCurrency ?? command.currency;
    for (let attempt = 1; attempt <= MAX_CONCURRENCY_RETRIES; attempt += 1) {
      const completed = await this.transferSettlements.findOneBy({ transferId });
      if (completed) {
        this.assertSettlementMatches(
          completed,
          command,
          amountMinor,
          destinationAmountMinor,
          destinationCurrency,
        );
        return this.readSettlementWallets(completed);
      }
      try {
        return await this.dataSource.transaction(async (manager) => {
          const receipts = manager.getRepository(LedgerTransferSettlement);
          const raced = await receipts.findOneBy({ transferId });
          if (raced) {
            this.assertSettlementMatches(
              raced,
              command,
              amountMinor,
              destinationAmountMinor,
              destinationCurrency,
            );
            return this.readSettlementWallets(raced, manager);
          }

          const wallets = manager.getRepository(Wallet);
          const sender = await wallets.findOne({
            where: {
              id: command.senderWalletId,
              ownerId: command.senderUserId,
              currency: command.currency,
            },
          });
          const receiver = await wallets.findOne({
            where: { id: command.receiverWalletId, currency: destinationCurrency },
          });
          if (!sender || !receiver) {
            throw new NotFoundException('Transfer wallet not found');
          }
          if (sender.id === receiver.id) {
            throw new BadRequestException('Sender and receiver wallets must differ');
          }

          const senderAggregate = WalletAggregate.rehydrate(
            sender.id,
            await this.eventStore.loadStream(sender.id, 1, manager),
          );
          const receiverAggregate = WalletAggregate.rehydrate(
            receiver.id,
            await this.eventStore.loadStream(receiver.id, 1, manager),
          );
          this.assertAggregateIdentity(sender, senderAggregate);
          this.assertAggregateIdentity(receiver, receiverAggregate);
          const hold = senderAggregate.holds.get(transferId);
          if (!hold) throw new NotFoundException('Transfer hold not found');
          if (hold.amountMinor !== amountMinor) {
            throw new ConflictException('Transfer hold amount does not match');
          }

          const transactionId = transferId;
          let debitEvent;
          try {
            debitEvent = senderAggregate.consumeHold(
              transferId,
              randomUUID(),
              transactionId,
            );
          } catch (error: unknown) {
            this.throwHoldDomainError(error);
          }
          if (!debitEvent) {
            throw new ConflictException('Transfer was consumed without a receipt');
          }
          const creditEvent = receiverAggregate.deposit(
            destinationAmountMinor,
            randomUUID(),
            transactionId,
          );
          const [storedDebit] = await this.eventStore.appendWithinTransaction(
            {
              streamId: sender.id,
              aggregateType: 'Wallet',
              expectedVersion: senderAggregate.version,
              events: [debitEvent],
            },
            manager,
          );
          const [storedCredit] = await this.eventStore.appendWithinTransaction(
            {
              streamId: receiver.id,
              aggregateType: 'Wallet',
              expectedVersion: receiverAggregate.version,
              events: [creditEvent],
            },
            manager,
          );
          await this.outbox.enqueueWalletEvents([storedDebit], sender, manager);
          await this.outbox.enqueueWalletEvents([storedCredit], receiver, manager);
          const senderProjection = await this.project(
            manager,
            senderAggregate.apply(storedDebit),
          );
          const receiverProjection = await this.project(
            manager,
            receiverAggregate.apply(storedCredit),
          );
          await receipts.insert({
            transferId,
            senderWalletId: sender.id,
            receiverWalletId: receiver.id,
            amountMinor: amountMinor.toString(),
            currency: command.currency,
            destinationAmountMinor: destinationAmountMinor.toString(),
            destinationCurrency,
          });
          return {
            sender: this.toView(sender, senderProjection),
            receiver: this.toView(receiver, receiverProjection),
          };
        });
      } catch (error: unknown) {
        if (
          (error instanceof ExpectedStreamVersionError ||
            this.isUniqueViolation(error)) &&
          attempt < MAX_CONCURRENCY_RETRIES
        ) {
          continue;
        }
        throw error;
      }
    }
    throw new Error('Unreachable transfer settlement concurrency retry state');
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
      return this.project(manager, aggregate);
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
    await this.outbox.enqueueWalletEvents([stored], wallet, manager);
    const updated = aggregate.apply(stored);
    const projection = await this.project(manager, updated);
    return this.toView(wallet, projection);
  }

  private async executeHoldCommand(
    walletId: string,
    ownerId: string,
    holdId: string,
    operation: 'place' | 'release' | 'consume',
    amountMinor?: bigint,
    allowMissingRelease = false,
  ): Promise<WalletView> {
    const eventId = randomUUID();
    const transactionId = randomUUID();
    for (let attempt = 1; attempt <= MAX_CONCURRENCY_RETRIES; attempt += 1) {
      try {
        return await this.dataSource.transaction(async (manager) => {
          const wallet = await manager.getRepository(Wallet).findOne({
            where: { id: walletId, ownerId },
          });
          if (!wallet) throw new NotFoundException('Гаманець не знайдено');
          const aggregate = WalletAggregate.rehydrate(
            walletId,
            await this.eventStore.loadStream(walletId, 1, manager),
          );
          this.assertAggregateIdentity(wallet, aggregate);
          let domainEvent;
          try {
            if (operation === 'place') {
              if (amountMinor === undefined) {
                throw new Error('Hold amount is required');
              }
              domainEvent = aggregate.placeHold(holdId, amountMinor, eventId);
            } else if (operation === 'release') {
              if (allowMissingRelease && !aggregate.holds.has(holdId)) {
                domainEvent = null;
              } else {
                domainEvent = aggregate.releaseHold(holdId, eventId);
              }
            } else {
              domainEvent = aggregate.consumeHold(holdId, eventId, transactionId);
            }
          } catch (error: unknown) {
            this.throwHoldDomainError(error);
          }
          if (!domainEvent) {
            return this.toView(wallet, this.projectionFromAggregate(aggregate));
          }
          const [stored] = await this.eventStore.appendWithinTransaction(
            {
              streamId: walletId,
              aggregateType: 'Wallet',
              expectedVersion: aggregate.version,
              events: [domainEvent],
            },
            manager,
          );
          await this.outbox.enqueueWalletEvents([stored], wallet, manager);
          const updated = aggregate.apply(stored);
          return this.toView(wallet, await this.project(manager, updated));
        });
      } catch (error: unknown) {
        if (error instanceof ExpectedStreamVersionError && attempt < MAX_CONCURRENCY_RETRIES) {
          continue;
        }
        throw error;
      }
    }
    throw new Error('Unreachable hold concurrency retry state');
  }

  private throwHoldDomainError(error: unknown): never {
    if (!(error instanceof Error)) throw error;
    if (error.message === 'INSUFFICIENT_FUNDS') {
      throw new BadRequestException('Недостатньо доступних коштів');
    }
    if (error.message === 'HOLD_NOT_FOUND') {
      throw new NotFoundException('Hold не знайдено');
    }
    if (error.message.startsWith('HOLD_')) {
      throw new BadRequestException(error.message);
    }
    throw error;
  }

  private project(
    manager: EntityManager,
    aggregate: WalletAggregate,
  ): Promise<WalletBalanceProjection> {
    const balances = manager.getRepository(WalletBalanceProjection);
    return balances.save(balances.create(this.projectionFromAggregate(aggregate)));
  }

  private projectionFromAggregate(
    aggregate: WalletAggregate,
  ): WalletBalanceProjection {
    const projection = new WalletBalanceProjection();
    projection.walletId = aggregate.id;
    projection.balanceMinor = aggregate.balanceMinor.toString();
    projection.heldMinor = aggregate.heldMinor.toString();
    projection.availableMinor = aggregate.availableMinor.toString();
    projection.streamVersion = aggregate.version;
    return projection;
  }

  private async getProjection(walletId: string): Promise<WalletBalanceProjection> {
    const projection = await this.balances.findOne({ where: { walletId } });
    if (!projection) throw new Error(`Missing balance projection for wallet ${walletId}`);
    return projection;
  }

  private toView(wallet: Wallet, projection: WalletBalanceProjection): WalletView {
    return {
      ...wallet,
      balance: formatMinorUnits(BigInt(projection.balanceMinor)),
      held: formatMinorUnits(BigInt(projection.heldMinor)),
      available: formatMinorUnits(BigInt(projection.availableMinor)),
    };
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

  private toPositiveMinorUnits(amount: number): bigint {
    let amountMinor: bigint;
    try {
      amountMinor = amountToMinorUnits(amount);
    } catch (error: unknown) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Invalid amount',
      );
    }
    if (amountMinor <= 0n) throw new BadRequestException('Amount must be positive');
    return amountMinor;
  }

  private assertSettlementMatches(
    settlement: LedgerTransferSettlement,
    command: SettleInternalTransferDto,
    amountMinor: bigint,
    destinationAmountMinor: bigint,
    destinationCurrency: string,
  ): void {
    if (
      settlement.senderWalletId !== command.senderWalletId ||
      settlement.receiverWalletId !== command.receiverWalletId ||
      settlement.amountMinor !== amountMinor.toString() ||
      settlement.currency !== command.currency ||
      settlement.destinationAmountMinor !== destinationAmountMinor.toString() ||
      settlement.destinationCurrency !== destinationCurrency
    ) {
      throw new ConflictException(
        'Transfer ID was already settled with different parameters',
      );
    }
  }

  private async readSettlementWallets(
    settlement: LedgerTransferSettlement,
    manager: EntityManager = this.dataSource.manager,
  ): Promise<{ sender: WalletView; receiver: WalletView }> {
    const wallets = manager.getRepository(Wallet);
    const balances = manager.getRepository(WalletBalanceProjection);
    const [sender, receiver, senderProjection, receiverProjection] =
      await Promise.all([
        wallets.findOneByOrFail({ id: settlement.senderWalletId }),
        wallets.findOneByOrFail({ id: settlement.receiverWalletId }),
        balances.findOneByOrFail({ walletId: settlement.senderWalletId }),
        balances.findOneByOrFail({ walletId: settlement.receiverWalletId }),
      ]);
    return {
      sender: this.toView(sender, senderProjection),
      receiver: this.toView(receiver, receiverProjection),
    };
  }

  private isUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    );
  }

  private isUniqueViolation(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) return false;
    const databaseError = error as { code?: unknown; driverError?: { code?: unknown } };
    return databaseError.code === '23505' || databaseError.driverError?.code === '23505';
  }
}
