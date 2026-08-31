import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateSplitBillDto } from './dto/create-split-bill.dto';
import { PaySplitShareDto } from './dto/pay-split-share.dto';
import { SplitBillsService } from './split-bills.service';

interface AuthenticatedRequest {
  user: { userId: string; email: string; role: string };
}

@Controller('split-bills')
@UseGuards(JwtAuthGuard)
export class SplitBillsController {
  constructor(private readonly splitBills: SplitBillsService) {}

  @Post()
  create(
    @Body() dto: CreateSplitBillDto,
    @Request() request: AuthenticatedRequest,
  ) {
    return this.splitBills.create(dto, request.user.userId, request.user.email);
  }

  @Get(':id')
  get(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Request() request: AuthenticatedRequest,
  ) {
    return this.splitBills.get(id, request.user.userId);
  }

  @Get()
  list(@Request() request: AuthenticatedRequest) {
    return this.splitBills.list(request.user.userId);
  }

  @Post(':billId/shares/:shareId/pay')
  pay(
    @Param('billId', new ParseUUIDPipe()) billId: string,
    @Param('shareId', new ParseUUIDPipe()) shareId: string,
    @Body() dto: PaySplitShareDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Request() request: AuthenticatedRequest,
  ) {
    return this.splitBills.payShare(
      billId,
      shareId,
      request.user.userId,
      dto.fromWalletId,
      idempotencyKey,
    );
  }
}
