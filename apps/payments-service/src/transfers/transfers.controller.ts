import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { TransfersService } from './transfers.service';
import { CreateTransferDto } from './dto/create-transfer.dto';

@Controller('transfers')
export class TransfersController {
  constructor(private readonly transfers: TransfersService) {}

  // TODO: бізнес-логіка саги переказу ще не реалізована.
  // Каркас контролера й DTO є — реалізуйте кроки саги, компенсацію
  // й ідемпотентність у TransfersService (див. ТЗ, розділ 4.2).
  @Post()
  create(@Body() dto: CreateTransferDto) {
    return this.transfers.create(dto);
  }

  @Get(':id')
  getStatus(@Param('id') id: string) {
    return this.transfers.getStatus(id);
  }
}
