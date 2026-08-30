import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WalletsService } from './wallets.service';
import { WalletsController } from './wallets.controller';
import { Wallet } from './entities/wallet.entity';
import { WalletBalanceProjection } from './entities/wallet-balance-projection.entity';
import { EventStoreModule } from '../event-store/event-store.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Wallet, WalletBalanceProjection]),
    EventStoreModule,
  ],
  controllers: [WalletsController],
  providers: [WalletsService],
  exports: [WalletsService],
})
export class WalletsModule {}
