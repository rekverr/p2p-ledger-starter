import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TransfersModule } from './transfers/transfers.module';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), TransfersModule],
})
export class AppModule {}
