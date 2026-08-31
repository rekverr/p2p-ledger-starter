import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TransfersModule } from './transfers/transfers.module';
import { getPaymentsDatabaseOptions } from './database/payments-database.options';
import { SplitBillsModule } from './split-bills/split-bills.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: getPaymentsDatabaseOptions,
    }),
    TransfersModule,
    SplitBillsModule,
  ],
})
export class AppModule {}
