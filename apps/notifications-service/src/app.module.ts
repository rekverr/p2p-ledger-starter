import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HealthController } from './health.controller';
import { getNotificationsDatabaseOptions } from './database/notifications-database.options';
import { MessagingModule } from './messaging/messaging.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: getNotificationsDatabaseOptions,
    }),
    MessagingModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
