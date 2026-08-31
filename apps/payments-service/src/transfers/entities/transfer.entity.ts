import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  JoinColumn,
  OneToOne,
  Unique,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm';
import { TransferStatus } from '../domain/transfer-status';
import { SplitBillShare } from '../../split-bills/entities/split-bill-share.entity';

@Entity('transfers')
@Unique('UQ_transfers_sender_idempotency', ['senderUserId', 'idempotencyKey'])
@Unique('UQ_transfers_split_bill_share', ['splitBillShareId'])
@Index('IDX_transfers_sender_created', ['senderUserId', 'createdAt'])
@Index('IDX_transfers_status_retry', ['status', 'nextRetryAt'])
@Index('IDX_transfers_recovery', ['nextRetryAt', 'leaseUntil'], {
  where: `"status" NOT IN ('Completed', 'Failed')`,
})
@Check('CHK_transfers_amount_positive', '"amount_minor" > 0')
@Check('CHK_transfers_retry_count', '"retry_count" >= 0')
@Check(
  'CHK_transfers_status',
  `"status" IN ('Pending', 'Validating', 'FundsHeld', 'Processing', 'Completed', 'Compensating', 'Failed')`,
)
export class Transfer {
  @PrimaryColumn('uuid')
  id: string;

  @Column('uuid', { name: 'sender_user_id' })
  senderUserId: string;

  @Column('uuid', { name: 'sender_wallet_id' })
  senderWalletId: string;

  @Column('varchar', { name: 'receiver_reference', length: 320 })
  receiverReference: string;

  @Column('uuid', { name: 'receiver_wallet_id', nullable: true })
  receiverWalletId: string | null;

  @Column('uuid', { name: 'split_bill_share_id', nullable: true })
  splitBillShareId?: string | null;

  @OneToOne(() => SplitBillShare, (share) => share.transfer, {
    nullable: true,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({
    name: 'split_bill_share_id',
    foreignKeyConstraintName: 'FK_transfers_split_bill_share',
  })
  splitBillShare?: SplitBillShare | null;

  @Column('bigint', { name: 'amount_minor' })
  amountMinor: string;

  @Column('varchar', { length: 3 })
  currency: string;

  @Column('varchar', { length: 30, default: TransferStatus.Pending })
  status: TransferStatus;

  @Column('varchar', { name: 'idempotency_key', length: 200 })
  idempotencyKey: string;

  @Column('char', { name: 'request_fingerprint', length: 64 })
  requestFingerprint: string;

  @Column('varchar', { name: 'failure_code', length: 100, nullable: true })
  failureCode: string | null;

  @Column('text', { name: 'failure_message', nullable: true })
  failureMessage: string | null;

  @Column('integer', { name: 'retry_count', default: 0 })
  retryCount: number;

  @Column('timestamptz', { name: 'next_retry_at', nullable: true })
  nextRetryAt: Date | null;

  @Column('boolean', { name: 'hold_may_exist', default: false })
  holdMayExist: boolean;

  @Column('timestamptz', { name: 'last_attempt_at', nullable: true })
  lastAttemptAt: Date | null;

  @Column('uuid', { name: 'lease_owner', nullable: true })
  leaseOwner: string | null;

  @Column('timestamptz', { name: 'lease_until', nullable: true })
  leaseUntil: Date | null;

  @VersionColumn({ name: 'version' })
  version: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
