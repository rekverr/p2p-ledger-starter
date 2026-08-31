import {
  Column,
  Check,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';

@Entity('integration_outbox')
@Check('CHK_integration_outbox_attempts', '"attempts" >= 0')
@Index('IDX_integration_outbox_pending', ['availableAt', 'publishedAt'], {
  where: '"published_at" IS NULL',
})
export class OutboxMessage {
  @PrimaryColumn('uuid', { name: 'event_id' })
  eventId: string;

  @Column('varchar', { name: 'routing_key', length: 200 })
  routingKey: string;

  @Column('jsonb')
  event: object;

  @Column('integer', { default: 0 })
  attempts: number;

  @Column('timestamptz', { name: 'available_at' })
  availableAt: Date;

  @Column('timestamptz', { name: 'locked_until', nullable: true })
  lockedUntil: Date | null;

  @Column('uuid', { name: 'lock_id', nullable: true })
  lockId: string | null;

  @Column('timestamptz', { name: 'published_at', nullable: true })
  publishedAt: Date | null;

  @Column('text', { name: 'last_error', nullable: true })
  lastError: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
