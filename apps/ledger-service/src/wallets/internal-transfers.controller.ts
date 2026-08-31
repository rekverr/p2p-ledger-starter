import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  HoldInternalTransferDto,
  ReleaseInternalTransferDto,
  SettleInternalTransferDto,
  ValidateInternalTransferDto,
} from './dto/internal-transfer.dto';
import { ServiceAuthGuard } from './service-auth.guard';
import { WalletsService } from './wallets.service';

@Controller('internal/transfers')
@UseGuards(ServiceAuthGuard)
export class InternalTransfersController {
  constructor(private readonly wallets: WalletsService) {}

  @Post('validate')
  validate(@Body() dto: ValidateInternalTransferDto) {
    return this.wallets.validateTransfer(dto);
  }

  @Post(':transferId/hold')
  placeHold(
    @Param('transferId', new ParseUUIDPipe()) transferId: string,
    @Body() dto: HoldInternalTransferDto,
  ) {
    return this.wallets.placeTransferHold(transferId, dto);
  }

  @Post(':transferId/settle')
  settle(
    @Param('transferId', new ParseUUIDPipe()) transferId: string,
    @Body() dto: SettleInternalTransferDto,
  ) {
    return this.wallets.settleTransfer(transferId, dto);
  }

  @Post(':transferId/release')
  release(
    @Param('transferId', new ParseUUIDPipe()) transferId: string,
    @Body() dto: ReleaseInternalTransferDto,
  ) {
    return this.wallets.releaseTransferHold(transferId, dto);
  }
}
