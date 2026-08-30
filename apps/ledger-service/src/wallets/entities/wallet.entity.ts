import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../auth/entities/user.entity';

@Entity('wallets')
@Index('UQ_wallets_owner_currency', ['ownerId', 'currency'], { unique: true })
export class Wallet {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ManyToOne(() => User, (user) => user.wallets)
  @JoinColumn({ name: 'ownerId', foreignKeyConstraintName: 'FK_wallets_owner' })
  owner: User;

  @Column()
  ownerId: string;

  @Column({ default: 'USD' })
  currency: string;

}
