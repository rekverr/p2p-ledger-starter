import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthContextModule } from '../auth/auth-context.module';
import { PaymentsOutboxModule } from '../messaging/outbox.module';
import { TransfersModule } from '../transfers/transfers.module';
import { SplitBillReminder } from './entities/split-bill-reminder.entity';
import { SplitBillShare } from './entities/split-bill-share.entity';
import { SplitBill } from './entities/split-bill.entity';
import { SplitBillReminderService } from './split-bill-reminder.service';
import { SplitBillsController } from './split-bills.controller';
import { SplitBillsService } from './split-bills.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([SplitBill, SplitBillShare, SplitBillReminder]),
    AuthContextModule,
    PaymentsOutboxModule,
    TransfersModule,
  ],
  controllers: [SplitBillsController],
  providers: [SplitBillsService, SplitBillReminderService],
  exports: [SplitBillsService, SplitBillReminderService],
})
export class SplitBillsModule {}
