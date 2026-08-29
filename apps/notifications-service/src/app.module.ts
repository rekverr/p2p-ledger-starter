import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

// Проєкт навмисно порожній: підписка на брокер подій, WebSocket-шлюз
// і формування стрічки активності — з нуля (див. ТЗ, розділ 4.3).
@Module({
  controllers: [HealthController],
})
export class AppModule {}
