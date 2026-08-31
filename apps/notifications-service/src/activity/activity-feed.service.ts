import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { ActivityFeedItem } from '../database/entities/activity-feed-item.entity';
import { IntegrationEventEnvelope } from '../messaging/integration-event';
import { ActivityFeedQueryDto } from './dto/activity-feed-query.dto';

export interface ActivityFeedPage {
  items: ActivityFeedItem[];
  nextCursor: string | null;
}

@Injectable()
export class ActivityFeedService {
  constructor(
    @InjectRepository(ActivityFeedItem)
    private readonly feed: Repository<ActivityFeedItem>,
  ) {}

  async record(
    manager: EntityManager,
    event: IntegrationEventEnvelope,
  ): Promise<void> {
    const ownerId = this.userIdFor(event);
    await manager.getRepository(ActivityFeedItem).insert({
      eventId: event.eventId,
      userId: typeof ownerId === 'string' ? ownerId : null,
      eventType: event.eventType,
      aggregateId: event.aggregate.id,
      payload: event,
    });
  }

  userIdFor(event: IntegrationEventEnvelope): string | null {
    const candidate = event.payload.ownerId ?? event.payload.senderUserId;
    return typeof candidate === 'string' ? candidate : null;
  }

  async listForUser(
    userId: string,
    query: ActivityFeedQueryDto,
  ): Promise<ActivityFeedPage> {
    const limit = query.limit ?? 20;
    const builder = this.feed
      .createQueryBuilder('activity')
      .where('activity.user_id = :userId', { userId })
      .orderBy('activity.created_at', 'DESC')
      .addOrderBy('activity.id', 'DESC')
      .take(limit + 1);
    if (query.eventType) {
      builder.andWhere('activity.event_type = :eventType', {
        eventType: query.eventType,
      });
    }
    if (query.cursor) {
      const cursor = this.decodeCursor(query.cursor);
      builder.andWhere(
        '(activity.created_at, activity.id) < (:createdAt, :id)',
        cursor,
      );
    }
    const rows = await builder.getMany();
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const last = items.at(-1);
    return {
      items,
      nextCursor:
        hasMore && last
          ? this.encodeCursor(last.createdAt, last.id)
          : null,
    };
  }

  private encodeCursor(createdAt: Date, id: string): string {
    return Buffer.from(
      JSON.stringify({ createdAt: createdAt.toISOString(), id }),
    ).toString('base64url');
  }

  private decodeCursor(value: string): { createdAt: Date; id: string } {
    try {
      const parsed = JSON.parse(Buffer.from(value, 'base64url').toString()) as {
        createdAt?: unknown;
        id?: unknown;
      };
      const createdAt =
        typeof parsed.createdAt === 'string' ? new Date(parsed.createdAt) : null;
      if (
        !createdAt ||
        Number.isNaN(createdAt.getTime()) ||
        typeof parsed.id !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          parsed.id,
        )
      ) {
        throw new Error('Invalid cursor');
      }
      return { createdAt, id: parsed.id };
    } catch {
      throw new BadRequestException('Invalid activity cursor');
    }
  }
}
