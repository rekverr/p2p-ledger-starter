import { Module } from '@nestjs/common';
import { PaymentsOutboxService } from './outbox.service';
import { MESSAGE_PUBLISHER, RabbitMqMessagePublisher } from './message-publisher';

@Module({
  providers: [
    RabbitMqMessagePublisher,
    { provide: MESSAGE_PUBLISHER, useExisting: RabbitMqMessagePublisher },
    PaymentsOutboxService,
  ],
  exports: [PaymentsOutboxService],
})
export class PaymentsOutboxModule {}
