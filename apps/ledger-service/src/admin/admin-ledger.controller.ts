import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../auth/guards/admin.guard';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ReconciliationQueryDto } from './dto/reconciliation-query.dto';
import { LedgerMaintenanceService } from './ledger-maintenance.service';

@Controller('admin/ledger')
@UseGuards(JwtAuthGuard, AdminGuard)
export class AdminLedgerController {
  constructor(private readonly ledger: LedgerMaintenanceService) {}

  @Get('wallets/:id/events')
  eventLog(@Param('id') walletId: string) {
    return this.ledger.walletEventLog(walletId);
  }

  @Get('reconciliation/wallets/:id')
  reconcileWallet(@Param('id') walletId: string) {
    return this.ledger.reconcileWallet(walletId);
  }

  @Get('reconciliation/global')
  reconcileGlobal(@Query() query: ReconciliationQueryDto) {
    return this.ledger.reconcileGlobal(query.from, query.to);
  }

  @Post('projections/rebuild')
  rebuild() {
    return this.ledger.rebuildAllBalanceProjections();
  }
}
