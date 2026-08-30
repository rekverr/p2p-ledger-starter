import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  Unique,
} from 'typeorm';

@Entity('ledger_events')
@Unique('UQ_ledger_events_stream_version', ['streamId', 'streamVersion'])
@Index('IDX_ledger_events_type_created_at', ['eventType', 'createdAt'])
@Check('CHK_ledger_events_stream_version', '"stream_version" > 0')
@Check('CHK_ledger_events_schema_version', '"schema_version" > 0')
export class StoredEvent {
  @PrimaryColumn('uuid', {
    name: 'event_id',
    primaryKeyConstraintName: 'PK_ledger_events',
  })
  readonly eventId: string;

  @Column('uuid', { name: 'stream_id' })
  readonly streamId: string;

  @Column('varchar', { name: 'aggregate_type', length: 100 })
  readonly aggregateType: string;

  @Column('varchar', { name: 'event_type', length: 150 })
  readonly eventType: string;

  @Column('integer', { name: 'schema_version' })
  readonly schemaVersion: number;

  @Column('integer', { name: 'stream_version' })
  readonly streamVersion: number;

  @Column('jsonb')
  readonly payload: object;

  @Column('jsonb')
  readonly metadata: object;

  @Column('varchar', { name: 'correlation_id', length: 100, nullable: true })
  readonly correlationId: string | null;

  @Column('varchar', { name: 'trace_id', length: 100, nullable: true })
  readonly traceId: string | null;

  @CreateDateColumn({
    name: 'created_at',
    type: 'timestamptz',
    default: () => 'now()',
  })
  readonly createdAt: Date;
}
