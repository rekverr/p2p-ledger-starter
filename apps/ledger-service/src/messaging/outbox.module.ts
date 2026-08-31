import { Module } from '@nestjs/common';
import { MESSAGE_PUBLISHER, RabbitMqMessagePublisher } from './message-publisher';
import { OutboxService } from './outbox.service';

@Module({
  providers: [
    RabbitMqMessagePublisher,
    { provide: MESSAGE_PUBLISHER, useExisting: RabbitMqMessagePublisher },
    OutboxService,
  ],
  exports: [OutboxService],
})
export class OutboxModule {}
