import { createHash, randomUUID } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import { CreateTransferDto } from './dto/create-transfer.dto';
import {
  assertTransferTransition,
  InvalidTransferTransitionError,
  TransferStatus,
} from './domain/transfer-status';
import { Transfer } from './entities/transfer.entity';

const IDEMPOTENCY_CONSTRAINT = 'UQ_transfers_sender_idempotency';
const MAX_IDEMPOTENCY_KEY_LENGTH = 200;

export interface TransferView {
  id: string;
  senderUserId: string;
  senderWalletId: string;
  receiverReference: string;
  receiverWalletId: string | null;
  amount: string;
  currency: string;
  status: TransferStatus;
  idempotencyKey: string;
  failureCode: string | null;
  failureMessage: string | null;
  retryCount: number;
  nextRetryAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

interface CanonicalTransferRequest {
  senderUserId: string;
  senderWalletId: string;
  receiverReference: string;
  amountMinor: string;
  currency: string;
}

@Injectable()
export class TransfersService {
  constructor(
    @InjectRepository(Transfer)
    private readonly transfers: Repository<Transfer>,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async create(
    dto: CreateTransferDto,
    idempotencyKeyHeader: string | undefined,
    senderUserId: string,
  ): Promise<TransferView> {
    const idempotencyKey = this.normalizeIdempotencyKey(idempotencyKeyHeader);
    const canonical = this.canonicalRequest(dto, senderUserId);
    const fingerprint = this.fingerprint(canonical);
    const existing = await this.transfers.findOne({
      where: { senderUserId, idempotencyKey },
    });
    if (existing) return this.resolveExisting(existing, fingerprint);

    const transfer = this.transfers.create({
      id: randomUUID(),
      ...canonical,
      status: TransferStatus.Pending,
      idempotencyKey,
      requestFingerprint: fingerprint,
      failureCode: null,
      failureMessage: null,
      retryCount: 0,
      nextRetryAt: null,
      receiverWalletId: null,
      holdMayExist: false,
      lastAttemptAt: null,
      leaseOwner: null,
      leaseUntil: null,
      version: 1,
    });

    try {
      await this.dataSource.transaction(async (manager) => {
        await manager.getRepository(Transfer).insert(transfer);
      });
      return this.toView(await this.transfers.findOneByOrFail({ id: transfer.id }));
    } catch (error: unknown) {
      if (!this.isIdempotencyUniqueViolation(error)) throw error;
      const winner = await this.transfers.findOne({
        where: { senderUserId, idempotencyKey },
      });
      if (!winner) {
        throw new Error('Idempotency winner was not visible after unique conflict');
      }
      return this.resolveExisting(winner, fingerprint);
    }
  }

  async getStatus(id: string, senderUserId: string): Promise<TransferView> {
    const transfer = await this.transfers.findOne({
      where: { id, senderUserId },
    });
    if (!transfer) throw new NotFoundException('Transfer not found');
    return this.toView(transfer);
  }

  async transition(id: string, next: TransferStatus): Promise<Transfer> {
    const current = await this.transfers.findOneBy({ id });
    if (!current) throw new NotFoundException('Transfer not found');
    try {
      assertTransferTransition(current.status, next);
    } catch (error: unknown) {
      if (error instanceof InvalidTransferTransitionError) {
        throw new ConflictException(error.message);
      }
      throw error;
    }
    const result = await this.transfers.update(
      {
        id: current.id,
        status: current.status,
        version: current.version,
      },
      {
        status: next,
        version: () => '"version" + 1',
      },
    );
    if (result.affected !== 1) {
      throw new ConflictException('Transfer state changed concurrently');
    }
    return this.transfers.findOneByOrFail({ id });
  }

  private resolveExisting(existing: Transfer, fingerprint: string): TransferView {
    if (existing.requestFingerprint !== fingerprint) {
      throw new ConflictException(
        'Idempotency-Key was already used with a different request',
      );
    }
    return this.toView(existing);
  }

  private normalizeIdempotencyKey(value: string | undefined): string {
    const key = value?.trim();
    if (!key) throw new BadRequestException('Idempotency-Key header is required');
    if (key.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
      throw new BadRequestException(
        `Idempotency-Key must not exceed ${MAX_IDEMPOTENCY_KEY_LENGTH} characters`,
      );
    }
    return key;
  }

  private canonicalRequest(
    dto: CreateTransferDto,
    senderUserId: string,
  ): CanonicalTransferRequest {
    return {
      senderUserId,
      senderWalletId: dto.fromWalletId.toLowerCase(),
      receiverReference: dto.toWalletIdentifier.trim(),
      amountMinor: this.amountToMinorUnits(dto.amount),
      currency: dto.currency.trim().toUpperCase(),
    };
  }

  private fingerprint(request: CanonicalTransferRequest): string {
    return createHash('sha256').update(JSON.stringify(request)).digest('hex');
  }

  private amountToMinorUnits(amount: number): string {
    const scaled = amount * 100;
    const rounded = Math.round(scaled);
    if (
      !Number.isFinite(amount) ||
      amount <= 0 ||
      !Number.isSafeInteger(rounded) ||
      Math.abs(scaled - rounded) > 1e-8
    ) {
      throw new BadRequestException('Invalid transfer amount');
    }
    return rounded.toString();
  }

  private toView(transfer: Transfer): TransferView {
    return {
      id: transfer.id,
      senderUserId: transfer.senderUserId,
      senderWalletId: transfer.senderWalletId,
      receiverReference: transfer.receiverReference,
      receiverWalletId: transfer.receiverWalletId,
      amount: this.formatMinorUnits(BigInt(transfer.amountMinor)),
      currency: transfer.currency,
      status: transfer.status,
      idempotencyKey: transfer.idempotencyKey,
      failureCode: transfer.failureCode,
      failureMessage: transfer.failureMessage,
      retryCount: transfer.retryCount,
      nextRetryAt: transfer.nextRetryAt,
      createdAt: transfer.createdAt,
      updatedAt: transfer.updatedAt,
    };
  }

  private formatMinorUnits(amountMinor: bigint): string {
    return `${amountMinor / 100n}.${(amountMinor % 100n)
      .toString()
      .padStart(2, '0')}`;
  }

  private isIdempotencyUniqueViolation(error: unknown): boolean {
    if (!(error instanceof QueryFailedError)) return false;
    const driverError = error.driverError as {
      code?: unknown;
      constraint?: unknown;
    };
    return (
      driverError.code === '23505' &&
      driverError.constraint === IDEMPOTENCY_CONSTRAINT
    );
  }
}
