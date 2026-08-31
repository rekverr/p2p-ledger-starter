import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  Unique,
} from 'typeorm';
import { SplitBillShare } from './split-bill-share.entity';

@Entity('split_bill_reminders')
@Unique('UQ_split_bill_reminder_share_kind', ['shareId', 'kind'])
@Unique('UQ_split_bill_reminder_event', ['eventId'])
export class SplitBillReminder {
  @PrimaryColumn('uuid')
  id: string;

  @Column('uuid', { name: 'share_id' })
  shareId: string;

  @ManyToOne(() => SplitBillShare, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'share_id',
    foreignKeyConstraintName: 'FK_split_bill_reminders_share',
  })
  share: SplitBillShare;

  @Column('varchar', { length: 30 })
  kind: string;

  @Column('uuid', { name: 'event_id' })
  eventId: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
