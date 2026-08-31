import { Column, CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

@Entity('processed_messages')
export class PaymentProcessedMessage {
  @PrimaryColumn('uuid', { name: 'event_id' })
  eventId: string;

  @Column('varchar', { length: 150 })
  consumer: string;

  @CreateDateColumn({ name: 'processed_at', type: 'timestamptz' })
  processedAt: Date;
}
