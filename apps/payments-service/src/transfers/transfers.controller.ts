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
import { CreateTransferDto } from './dto/create-transfer.dto';
import { TransfersService } from './transfers.service';

interface AuthenticatedRequest {
  user: { userId: string; email: string; role: string };
}

@Controller('transfers')
@UseGuards(JwtAuthGuard)
export class TransfersController {
  constructor(private readonly transfers: TransfersService) {}

  @Post()
  create(
    @Body() dto: CreateTransferDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Request() request: AuthenticatedRequest,
  ) {
    return this.transfers.create(dto, idempotencyKey, request.user.userId);
  }

  @Get(':id')
  getStatus(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Request() request: AuthenticatedRequest,
  ) {
    return this.transfers.getStatus(id, request.user.userId);
  }
}
