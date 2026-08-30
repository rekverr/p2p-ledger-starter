import type { StoredEvent } from './entities/stored-event.entity';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export interface JsonObject {
  [key: string]: JsonValue;
}

export interface EventData {
  eventId: string;
  eventType: string;
  schemaVersion: number;
  payload: JsonObject;
  metadata?: JsonObject;
  correlationId?: string | null;
  traceId?: string | null;
}

export interface AppendToStreamRequest {
  streamId: string;
  aggregateType: string;
  expectedVersion: number;
  events: EventData[];
}

export type EventReducer<TState> = (
  state: TState,
  event: StoredEvent,
) => TState;
