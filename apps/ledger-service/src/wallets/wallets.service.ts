import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Wallet } from './entities/wallet.entity';

@Injectable()
export class WalletsService {
  constructor(
    @InjectRepository(Wallet) private readonly wallets: Repository<Wallet>,
  ) {}

  async getOrCreateForUser(userId: string, currency = 'USD'): Promise<Wallet> {
    let wallet = await this.wallets.findOne({ where: { ownerId: userId, currency } });
    if (!wallet) {
      wallet = await this.wallets.save(
        this.wallets.create({ ownerId: userId, currency, balance: '0' }),
      );
    }
    return wallet;
  }

  async listForUser(userId: string): Promise<Wallet[]> {
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
    const wallet = await this.getById(walletId, ownerId);
    wallet.balance = (Number(wallet.balance) + amount).toFixed(2);
    return this.wallets.save(wallet);
  }

  async withdraw(
    walletId: string,
    ownerId: string,
    amount: number,
  ): Promise<Wallet> {
    const wallet = await this.getById(walletId, ownerId);
    const current = Number(wallet.balance);
    if (current < amount) {
      throw new BadRequestException('Недостатньо коштів');
    }
    wallet.balance = (current - amount).toFixed(2);
    return this.wallets.save(wallet);
  }
}
