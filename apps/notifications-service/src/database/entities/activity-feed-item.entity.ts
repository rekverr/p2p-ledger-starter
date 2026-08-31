import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('activity_feed')
@Index('IDX_activity_feed_user_created', ['userId', 'createdAt'])
export class ActivityFeedItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column('uuid', { name: 'event_id', unique: true })
  eventId: string;

  @Column('uuid', { name: 'user_id', nullable: true })
  userId: string | null;

  @Column('varchar', { name: 'event_type', length: 200 })
  eventType: string;

  @Column('varchar', { name: 'aggregate_id', length: 100 })
  aggregateId: string;

  @Column('jsonb')
  payload: object;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
