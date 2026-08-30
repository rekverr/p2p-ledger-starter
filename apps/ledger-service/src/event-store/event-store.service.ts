import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Between, DataSource, MoreThanOrEqual, QueryFailedError } from 'typeorm';
import { StoredEvent } from './entities/stored-event.entity';
import {
  DuplicateEventIdError,
  ExpectedStreamVersionError,
  StreamAggregateTypeError,
} from './event-store.errors';
import {
  AppendToStreamRequest,
  EventReducer,
} from './event-store.types';

const EVENT_ID_CONSTRAINT = 'PK_ledger_events';
const STREAM_VERSION_CONSTRAINT = 'UQ_ledger_events_stream_version';

@Injectable()
export class EventStoreService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async append(request: AppendToStreamRequest): Promise<StoredEvent[]> {
    this.validateAppendRequest(request);

    try {
      return await this.dataSource.transaction(async (manager) => {
        const events = manager.getRepository(StoredEvent);
        const latest = await events.findOne({
          where: { streamId: request.streamId },
          order: { streamVersion: 'DESC' },
        });
        const actualVersion = latest?.streamVersion ?? 0;

        if (actualVersion !== request.expectedVersion) {
          throw new ExpectedStreamVersionError(
            request.streamId,
            request.expectedVersion,
            actualVersion,
          );
        }
        if (latest && latest.aggregateType !== request.aggregateType) {
          throw new StreamAggregateTypeError(
            request.streamId,
            request.aggregateType,
            latest.aggregateType,
          );
        }

        const storedEvents = request.events.map((event, index) =>
          events.create({
            ...event,
            metadata: event.metadata ?? {},
            correlationId: event.correlationId ?? null,
            traceId: event.traceId ?? null,
            streamId: request.streamId,
            aggregateType: request.aggregateType,
            streamVersion: request.expectedVersion + index + 1,
          }),
        );
        await events.insert(storedEvents);

        return events.find({
          where: {
            streamId: request.streamId,
            streamVersion: Between(
              request.expectedVersion + 1,
              request.expectedVersion + request.events.length,
            ),
          },
          order: { streamVersion: 'ASC' },
        });
      });
    } catch (error: unknown) {
      if (error instanceof ExpectedStreamVersionError) {
        throw error;
      }

      const constraint = this.getConstraint(error);
      if (constraint === EVENT_ID_CONSTRAINT) {
        throw new DuplicateEventIdError(
          request.events.length === 1 ? request.events[0].eventId : undefined,
        );
      }
      if (constraint === STREAM_VERSION_CONSTRAINT) {
        throw new ExpectedStreamVersionError(
          request.streamId,
          request.expectedVersion,
        );
      }
      throw error;
    }
  }

  loadStream(streamId: string, fromVersion = 1): Promise<StoredEvent[]> {
    if (!streamId) {
      throw new TypeError('streamId is required');
    }
    if (!Number.isInteger(fromVersion) || fromVersion < 1) {
      throw new TypeError('fromVersion must be a positive integer');
    }

    return this.dataSource.getRepository(StoredEvent).find({
      where: { streamId, streamVersion: MoreThanOrEqual(fromVersion) },
      order: { streamVersion: 'ASC' },
    });
  }

  async replay<TState>(
    streamId: string,
    initialState: TState,
    reducer: EventReducer<TState>,
  ): Promise<TState> {
    const events = await this.loadStream(streamId);
    return events.reduce(reducer, initialState);
  }

  private validateAppendRequest(request: AppendToStreamRequest): void {
    if (!request.streamId || !request.aggregateType.trim()) {
      throw new TypeError('streamId and aggregateType are required');
    }
    if (
      !Number.isInteger(request.expectedVersion) ||
      request.expectedVersion < 0
    ) {
      throw new TypeError('expectedVersion must be a non-negative integer');
    }
    if (request.events.length === 0) {
      throw new TypeError('At least one event is required');
    }

    for (const event of request.events) {
      if (!event.eventId || !event.eventType.trim()) {
        throw new TypeError('eventId and eventType are required');
      }
      if (!Number.isInteger(event.schemaVersion) || event.schemaVersion < 1) {
        throw new TypeError('schemaVersion must be a positive integer');
      }
    }
  }

  private getConstraint(error: unknown): string | undefined {
    if (!(error instanceof QueryFailedError)) {
      return undefined;
    }
    const driverError = error.driverError as { constraint?: unknown };
    return typeof driverError.constraint === 'string'
      ? driverError.constraint
      : undefined;
  }
}
