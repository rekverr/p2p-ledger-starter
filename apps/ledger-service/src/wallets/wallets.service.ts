import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Wallet } from './entities/wallet.entity';

@Injectable()
export class WalletsService {
  constructor(
    @InjectRepository(Wallet) private readonly wallets: Repository<Wallet>,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async getOrCreateForUser(userId: string, currency = 'USD'): Promise<Wallet> {
    const existing = await this.wallets.findOne({
      where: { ownerId: userId, currency },
    });
    if (existing) {
      return existing;
    }

    try {
      await this.wallets.insert({ ownerId: userId, currency, balance: '0' });
    } catch (error: unknown) {
      if (!this.isUniqueViolation(error)) {
        throw error;
      }
    }

    const wallet = await this.wallets.findOne({
      where: { ownerId: userId, currency },
    });
    if (!wallet) {
      throw new Error('Wallet creation did not produce a persistent wallet');
    }
    return wallet;
  }

  async listForUser(userId: string): Promise<Wallet[]> {
    await this.getOrCreateForUser(userId);
    return this.wallets.find({ where: { ownerId: userId } });
  }

  async getById(walletId: string, ownerId: string): Promise<Wallet> {
    const wallet = await this.wallets.findOne({
      where: { id: walletId, ownerId },
    });
    if (!wallet) {
      throw new NotFoundException('Гаманець не знайдено');
    }
    return wallet;
  }

  async deposit(
    walletId: string,
    ownerId: string,
    amount: number,
  ): Promise<Wallet> {
    return this.dataSource.transaction(async (manager) => {
      const wallets = manager.getRepository(Wallet);
      const wallet = await this.getLockedWallet(wallets, walletId, ownerId);
      wallet.balance = (Number(wallet.balance) + amount).toFixed(2);
      return wallets.save(wallet);
    });
  }

  async withdraw(
    walletId: string,
    ownerId: string,
    amount: number,
  ): Promise<Wallet> {
    return this.dataSource.transaction(async (manager) => {
      const wallets = manager.getRepository(Wallet);
      const wallet = await this.getLockedWallet(wallets, walletId, ownerId);
      const current = Number(wallet.balance);
      if (current < amount) {
        throw new BadRequestException('Недостатньо коштів');
      }
      wallet.balance = (current - amount).toFixed(2);
      return wallets.save(wallet);
    });
  }

  private async getLockedWallet(
    wallets: Repository<Wallet>,
    walletId: string,
    ownerId: string,
  ): Promise<Wallet> {
    const wallet = await wallets.findOne({
      where: { id: walletId, ownerId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!wallet) {
      throw new NotFoundException('Гаманець не знайдено');
    }
    return wallet;
  }

  private isUniqueViolation(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) {
      return false;
    }

    const databaseError = error as {
      code?: unknown;
      driverError?: { code?: unknown };
    };
    return (
      databaseError.code === '23505' ||
      databaseError.driverError?.code === '23505'
    );
  }
}
