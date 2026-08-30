import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module';
import { WalletsModule } from './wallets/wallets.module';
import { getLedgerDatabaseOptions } from './database/ledger-database.options';
import { EventStoreModule } from './event-store/event-store.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: getLedgerDatabaseOptions,
    }),
    AuthModule,
    WalletsModule,
    EventStoreModule,
  ],
})
export class AppModule {}
