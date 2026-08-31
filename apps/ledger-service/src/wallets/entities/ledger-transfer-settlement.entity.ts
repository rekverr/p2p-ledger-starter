import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { Wallet } from './wallet.entity';

@Entity('ledger_transfer_settlements')
@Index('IDX_ledger_transfer_settlements_wallets', [
  'senderWalletId',
  'receiverWalletId',
])
@Check('CHK_ledger_transfer_settlements_amount', '"amount_minor" > 0')
@Check(
  'CHK_ledger_transfer_settlements_distinct_wallets',
  '"sender_wallet_id" <> "receiver_wallet_id"',
)
export class LedgerTransferSettlement {
  @PrimaryColumn('uuid', { name: 'transfer_id' })
  transferId: string;

  @ManyToOne(() => Wallet)
  @JoinColumn({
    name: 'sender_wallet_id',
    foreignKeyConstraintName: 'FK_ledger_transfer_settlements_sender',
  })
  senderWallet: Wallet;

  @Column('uuid', { name: 'sender_wallet_id' })
  senderWalletId: string;

  @ManyToOne(() => Wallet)
  @JoinColumn({
    name: 'receiver_wallet_id',
    foreignKeyConstraintName: 'FK_ledger_transfer_settlements_receiver',
  })
  receiverWallet: Wallet;

  @Column('uuid', { name: 'receiver_wallet_id' })
  receiverWalletId: string;

  @Column('bigint', { name: 'amount_minor' })
  amountMinor: string;

  @Column('varchar', { length: 3 })
  currency: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}
