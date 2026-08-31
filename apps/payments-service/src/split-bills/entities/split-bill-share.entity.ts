import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToOne,
  PrimaryColumn,
  Unique,
} from 'typeorm';
import { Transfer } from '../../transfers/entities/transfer.entity';
import { SplitBill } from './split-bill.entity';

@Entity('split_bill_shares')
@Unique('UQ_split_bill_participant', ['billId', 'participantUserId'])
@Unique('UQ_split_bill_share_position', ['billId', 'position'])
@Index('IDX_split_bill_shares_participant', ['participantUserId', 'createdAt'])
@Check('CHK_split_bill_shares_amount_positive', '"amount_minor" > 0')
@Check('CHK_split_bill_shares_position', '"position" >= 0')
export class SplitBillShare {
  @PrimaryColumn('uuid')
  id: string;

  @Column('uuid', { name: 'bill_id' })
  billId: string;

  @ManyToOne(() => SplitBill, (bill) => bill.shares, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'bill_id',
    foreignKeyConstraintName: 'FK_split_bill_shares_bill',
  })
  bill: SplitBill;

  @Column('uuid', { name: 'participant_user_id' })
  participantUserId: string;

  @Column('bigint', { name: 'amount_minor' })
  amountMinor: string;

  @Column('integer')
  position: number;

  @OneToOne(() => Transfer, (transfer) => transfer.splitBillShare)
  transfer: Transfer | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
