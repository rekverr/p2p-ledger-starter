import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { ActivityFeedItem } from '../database/entities/activity-feed-item.entity';
import { IntegrationEventEnvelope } from '../messaging/integration-event';

@Injectable()
export class ActivityFeedService {
  async record(
    manager: EntityManager,
    event: IntegrationEventEnvelope,
  ): Promise<void> {
    const ownerId = event.payload.ownerId ?? event.payload.senderUserId;
    await manager.getRepository(ActivityFeedItem).insert({
      eventId: event.eventId,
      userId: typeof ownerId === 'string' ? ownerId : null,
      eventType: event.eventType,
      aggregateId: event.aggregate.id,
      payload: event,
    });
  }
}
