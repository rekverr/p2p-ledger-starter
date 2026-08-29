import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { WalletsService } from './wallets.service';
import { DepositDto } from './dto/deposit.dto';
import { WithdrawDto } from './dto/withdraw.dto';

interface AuthenticatedRequest {
  user: { userId: string; email: string; role: string };
}

@Controller('wallets')
@UseGuards(JwtAuthGuard)
export class WalletsController {
  constructor(private readonly wallets: WalletsService) {}

  @Get()
  list(@Request() req: AuthenticatedRequest) {
    return this.wallets.listForUser(req.user.userId);
  }

  @Get(':id')
  getOne(@Param('id') id: string, @Request() req: AuthenticatedRequest) {
    return this.wallets.getById(id, req.user.userId);
  }

  @Post(':id/deposit')
  deposit(
    @Param('id') id: string,
    @Body() dto: DepositDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.wallets.deposit(id, req.user.userId, dto.amount);
  }

  @Post(':id/withdraw')
  withdraw(
    @Param('id') id: string,
    @Body() dto: WithdrawDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.wallets.withdraw(id, req.user.userId, dto.amount);
  }
}
