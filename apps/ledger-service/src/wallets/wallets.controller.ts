import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { WalletsService } from './wallets.service';
import { DepositDto } from './dto/deposit.dto';
import { WithdrawDto } from './dto/withdraw.dto';
import { PlaceHoldDto } from './dto/place-hold.dto';

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

  @Post(':id/holds')
  placeHold(
    @Param('id') id: string,
    @Body() dto: PlaceHoldDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.wallets.placeHold(id, req.user.userId, dto.holdId, dto.amount);
  }

  @Post(':id/holds/:holdId/release')
  releaseHold(
    @Param('id') id: string,
    @Param('holdId', new ParseUUIDPipe()) holdId: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.wallets.releaseHold(id, req.user.userId, holdId);
  }

  @Post(':id/holds/:holdId/consume')
  consumeHold(
    @Param('id') id: string,
    @Param('holdId', new ParseUUIDPipe()) holdId: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.wallets.consumeHold(id, req.user.userId, holdId);
  }
}
