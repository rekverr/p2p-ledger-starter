import { randomUUID } from 'crypto';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { PaymentsOutboxService } from '../messaging/outbox.service';
import { TransferStatus } from '../transfers/domain/transfer-status';
import { TransferSagaService } from '../transfers/transfer-saga.service';
import { TransferView, TransfersService } from '../transfers/transfers.service';
import {
  deriveSplitBillStatus,
  SplitSharePaymentStatus,
} from './domain/split-bill-status';
import { formatMinorUnits, parseMoneyToMinor } from './domain/money';
import {
  CreateSplitBillDto,
  SplitMode,
} from './dto/create-split-bill.dto';
import { SplitBill } from './entities/split-bill.entity';
import { SplitBillShare } from './entities/split-bill-share.entity';

export interface SplitShareView {
  id: string;
  participantUserId: string;
  amount: string;
  paymentStatus: SplitSharePaymentStatus;
  transferId: string | null;
  transferStatus: TransferStatus | null;
}

export interface SplitBillView {
  id: string;
  creatorUserId: string;
  creatorReference: string;
  total: string;
  currency: string;
  deadline: Date | null;
  status: ReturnType<typeof deriveSplitBillStatus>;
  shares: SplitShareView[];
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class SplitBillsService {
  constructor(
    @InjectRepository(SplitBill)
    private readonly bills: Repository<SplitBill>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly transfers: TransfersService,
    private readonly saga: TransferSagaService,
    private readonly outbox: PaymentsOutboxService,
  ) {}

  async create(
    dto: CreateSplitBillDto,
    creatorUserId: string,
    creatorReference: string,
  ): Promise<SplitBillView> {
    const totalMinor = parseMoneyToMinor(dto.total, 'total');
    const participantIds = dto.participants.map(({ userId }) =>
      userId.toLowerCase(),
    );
    if (new Set(participantIds).size !== participantIds.length) {
      throw new BadRequestException('Participants must be unique');
    }
    const amounts = this.shareAmounts(dto, totalMinor);
    const deadline = dto.deadline ? new Date(dto.deadline) : null;
    const billId = randomUUID();

    await this.dataSource.transaction(async (manager) => {
      const bill = manager.getRepository(SplitBill).create({
        id: billId,
        creatorUserId,
        creatorReference: creatorReference.trim().toLowerCase(),
        totalMinor: totalMinor.toString(),
        currency: dto.currency.toUpperCase(),
        deadline,
      });
      await manager.getRepository(SplitBill).insert(bill);
      for (let index = 0; index < participantIds.length; index += 1) {
        const share = manager.getRepository(SplitBillShare).create({
          id: randomUUID(),
          billId,
          participantUserId: participantIds[index],
          amountMinor: amounts[index].toString(),
          position: index,
        });
        await manager.getRepository(SplitBillShare).insert(share);
        await this.outbox.enqueueSplitBillCreated(manager, bill, share);
      }
    });
    return this.get(billId, creatorUserId);
  }

  async get(id: string, userId: string): Promise<SplitBillView> {
    const bill = await this.bills.findOne({
      where: { id },
      relations: { shares: { transfer: true } },
      order: { shares: { position: 'ASC' } },
    });
    if (
      !bill ||
      (bill.creatorUserId !== userId &&
        !bill.shares.some((share) => share.participantUserId === userId))
    ) {
      throw new NotFoundException('Split bill not found');
    }
    return this.toView(bill);
  }

  async payShare(
    billId: string,
    shareId: string,
    participantUserId: string,
    fromWalletId: string,
    idempotencyKey: string | undefined,
  ): Promise<{ bill: SplitBillView; transfer: TransferView }> {
    const share = await this.dataSource.getRepository(SplitBillShare).findOne({
      where: { id: shareId, billId },
      relations: { bill: true, transfer: true },
    });
    if (!share || share.participantUserId !== participantUserId) {
      throw new NotFoundException('Split share not found');
    }
    const transfer = await this.transfers.createSplitSharePayment(
      {
        shareId: share.id,
        participantUserId,
        fromWalletId,
        receiverReference: share.bill.creatorReference,
        amountMinor: share.amountMinor,
        currency: share.bill.currency,
      },
      idempotencyKey,
    );
    await this.saga.run(transfer.id);
    return {
      bill: await this.get(billId, participantUserId),
      transfer: await this.transfers.getStatus(transfer.id, participantUserId),
    };
  }

  private shareAmounts(dto: CreateSplitBillDto, total: bigint): bigint[] {
    if (dto.mode === SplitMode.Equal) {
      if (dto.participants.some(({ share }) => share !== undefined)) {
        throw new BadRequestException('Equal split must not include custom shares');
      }
      const count = BigInt(dto.participants.length);
      const base = total / count;
      const remainder = Number(total % count);
      if (base === 0n) {
        throw new BadRequestException('Total is too small for all participants');
      }
      return dto.participants.map((_, index) =>
        base + (index < remainder ? 1n : 0n),
      );
    }

    const amounts = dto.participants.map(({ share }, index) => {
      if (!share) {
        throw new BadRequestException(
          `participants[${index}].share is required for custom split`,
        );
      }
      return parseMoneyToMinor(share, `participants[${index}].share`);
    });
    if (amounts.reduce((sum, amount) => sum + amount, 0n) !== total) {
      throw new BadRequestException('Sum of shares must equal bill total');
    }
    return amounts;
  }

  private toView(bill: SplitBill): SplitBillView {
    const shares = bill.shares.map((share) => this.shareView(share));
    const paid = shares.filter(
      ({ paymentStatus }) => paymentStatus === SplitSharePaymentStatus.Paid,
    ).length;
    return {
      id: bill.id,
      creatorUserId: bill.creatorUserId,
      creatorReference: bill.creatorReference,
      total: formatMinorUnits(BigInt(bill.totalMinor)),
      currency: bill.currency,
      deadline: bill.deadline,
      status: deriveSplitBillStatus(paid, shares.length),
      shares,
      createdAt: bill.createdAt,
      updatedAt: bill.updatedAt,
    };
  }

  private shareView(share: SplitBillShare): SplitShareView {
    const transfer = share.transfer;
    let paymentStatus = SplitSharePaymentStatus.Unpaid;
    if (transfer?.status === TransferStatus.Completed) {
      paymentStatus = SplitSharePaymentStatus.Paid;
    } else if (transfer?.status === TransferStatus.Failed) {
      paymentStatus = SplitSharePaymentStatus.PaymentFailed;
    } else if (transfer) {
      paymentStatus = SplitSharePaymentStatus.PaymentPending;
    }
    return {
      id: share.id,
      participantUserId: share.participantUserId,
      amount: formatMinorUnits(BigInt(share.amountMinor)),
      paymentStatus,
      transferId: transfer?.id ?? null,
      transferStatus: transfer?.status ?? null,
    };
  }
}
