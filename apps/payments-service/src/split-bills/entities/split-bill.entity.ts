import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { SplitBillShare } from './split-bill-share.entity';

@Entity('split_bills')
@Index('IDX_split_bills_creator_created', ['creatorUserId', 'createdAt'])
@Index('IDX_split_bills_deadline', ['deadline'], { where: '"deadline" IS NOT NULL' })
@Check('CHK_split_bills_total_positive', '"total_minor" > 0')
export class SplitBill {
  @PrimaryColumn('uuid')
  id: string;

  @Column('uuid', { name: 'creator_user_id' })
  creatorUserId: string;

  @Column('varchar', { name: 'creator_reference', length: 320 })
  creatorReference: string;

  @Column('bigint', { name: 'total_minor' })
  totalMinor: string;

  @Column('varchar', { length: 3 })
  currency: string;

  @Column('timestamptz', { nullable: true })
  deadline: Date | null;

  @OneToMany(() => SplitBillShare, (share) => share.bill)
  shares: SplitBillShare[];

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
