import {
  Check,
  Column,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Wallet } from './wallet.entity';

@Entity('wallet_balance_projection')
@Check('CHK_wallet_balance_projection_non_negative', '"balance_minor" >= 0')
@Check('CHK_wallet_balance_projection_stream_version', '"stream_version" > 0')
@Check('CHK_wallet_balance_projection_held_non_negative', '"held_minor" >= 0')
@Check('CHK_wallet_balance_projection_available_non_negative', '"available_minor" >= 0')
@Check(
  'CHK_wallet_balance_projection_formula',
  '"available_minor" = "balance_minor" - "held_minor"',
)
export class WalletBalanceProjection {
  @OneToOne(() => Wallet, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'wallet_id',
    foreignKeyConstraintName: 'FK_wallet_balance_projection_wallet',
  })
  wallet: Wallet;

  @PrimaryColumn('uuid', { name: 'wallet_id' })
  walletId: string;

  @Column('bigint', { name: 'balance_minor' })
  balanceMinor: string;

  @Column('bigint', { name: 'held_minor' })
  heldMinor: string;

  @Column('bigint', { name: 'available_minor' })
  availableMinor: string;

  @Column('integer', { name: 'stream_version' })
  streamVersion: number;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
