import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WalletsService } from './wallets.service';
import { WalletsController } from './wallets.controller';
import { Wallet } from './entities/wallet.entity';
import { WalletBalanceProjection } from './entities/wallet-balance-projection.entity';
import { EventStoreModule } from '../event-store/event-store.module';
import { OutboxModule } from '../messaging/outbox.module';
import { User } from '../auth/entities/user.entity';
import { LedgerTransferSettlement } from './entities/ledger-transfer-settlement.entity';
import { InternalTransfersController } from './internal-transfers.controller';
import { ServiceAuthGuard } from './service-auth.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Wallet,
      WalletBalanceProjection,
      User,
      LedgerTransferSettlement,
    ]),
    EventStoreModule,
    OutboxModule,
  ],
  controllers: [WalletsController, InternalTransfersController],
  providers: [WalletsService, ServiceAuthGuard],
  exports: [WalletsService],
})
export class WalletsModule {}
