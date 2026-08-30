import { Module } from '@nestjs/common';
import { AdminGuard } from '../auth/guards/admin.guard';
import { EventStoreModule } from '../event-store/event-store.module';
import { AdminLedgerController } from './admin-ledger.controller';
import { LedgerMaintenanceService } from './ledger-maintenance.service';

@Module({
  imports: [EventStoreModule],
  controllers: [AdminLedgerController],
  providers: [LedgerMaintenanceService, AdminGuard],
})
export class AdminLedgerModule {}
