import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthContextModule } from '../auth/auth-context.module';
import { Transfer } from './entities/transfer.entity';
import { TransfersController } from './transfers.controller';
import { TransfersService } from './transfers.service';

@Module({
  imports: [TypeOrmModule.forFeature([Transfer]), AuthContextModule],
  controllers: [TransfersController],
  providers: [TransfersService],
})
export class TransfersModule {}
