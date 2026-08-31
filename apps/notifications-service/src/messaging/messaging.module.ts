import { Module } from '@nestjs/common';
import { ActivityModule } from '../activity/activity.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { InboxService } from './inbox.service';
import { RabbitMqConsumerService } from './rabbitmq-consumer.service';
import { BROKER_CONNECTOR, RabbitMqConnector } from './broker-connector';

@Module({
  imports: [ActivityModule, RealtimeModule],
  providers: [
    InboxService,
    RabbitMqConnector,
    { provide: BROKER_CONNECTOR, useExisting: RabbitMqConnector },
    RabbitMqConsumerService,
  ],
  exports: [InboxService],
})
export class MessagingModule {}
