import { Module } from '@nestjs/common';
import { ActivityFeedService } from '../activity/activity-feed.service';
import { InboxService } from './inbox.service';
import { RabbitMqConsumerService } from './rabbitmq-consumer.service';

@Module({
  providers: [InboxService, ActivityFeedService, RabbitMqConsumerService],
  exports: [InboxService],
})
export class MessagingModule {}
