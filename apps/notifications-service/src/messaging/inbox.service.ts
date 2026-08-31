import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { IntegrationEventEnvelope } from './integration-event';

export type InboxHandler = (
  manager: EntityManager,
  event: IntegrationEventEnvelope,
) => Promise<void>;

@Injectable()
export class InboxService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  process(
    consumer: string,
    event: IntegrationEventEnvelope,
    handler: InboxHandler,
  ): Promise<boolean> {
    return this.dataSource.transaction(async (manager) => {
      const inserted = (await manager.query(
        `INSERT INTO processed_messages (event_id, consumer)
         VALUES ($1, $2)
         ON CONFLICT (event_id) DO NOTHING
         RETURNING event_id`,
        [event.eventId, consumer],
      )) as Array<{ event_id: string }>;
      if (inserted.length === 0) return false;
      await handler(manager, event);
      return true;
    });
  }
}
