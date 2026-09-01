import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthContextModule } from '../auth/auth-context.module';
import { PaymentsOutboxModule } from '../messaging/outbox.module';
import { Transfer } from './entities/transfer.entity';
import { LEDGER_GATEWAY, LedgerHttpClient } from './ledger.gateway';
import { TransferSagaService } from './transfer-saga.service';
import { TransfersController } from './transfers.controller';
import { TransfersService } from './transfers.service';
import { TransferRateLimitGuard } from './transfer-rate-limit.guard';
import { TransferPolicyService } from './transfer-policy.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Transfer]),
    AuthContextModule,
    PaymentsOutboxModule,
  ],
  controllers: [TransfersController],
  providers: [
    TransfersService,
    TransferSagaService,
    LedgerHttpClient,
    TransferRateLimitGuard,
    TransferPolicyService,
    { provide: LEDGER_GATEWAY, useExisting: LedgerHttpClient },
  ],
  exports: [TransfersService, TransferSagaService],
})
export class TransfersModule {}
