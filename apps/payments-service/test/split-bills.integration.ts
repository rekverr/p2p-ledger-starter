import 'reflect-metadata';
import { randomUUID } from 'crypto';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  paymentsEntities,
  paymentsMigrations,
} from '../src/database/payments-database.options';
import { PaymentOutboxMessage } from '../src/database/entities/outbox-message.entity';
import { PaymentsOutboxService } from '../src/messaging/outbox.service';
import { MessagePublisher } from '../src/messaging/message-publisher';
import {
  SplitBillStatus,
  SplitSharePaymentStatus,
} from '../src/split-bills/domain/split-bill-status';
import { SplitMode } from '../src/split-bills/dto/create-split-bill.dto';
import { SplitBillReminder } from '../src/split-bills/entities/split-bill-reminder.entity';
import { SplitBill } from '../src/split-bills/entities/split-bill.entity';
import { SplitBillReminderService } from '../src/split-bills/split-bill-reminder.service';
import { SplitBillsService } from '../src/split-bills/split-bills.service';
import { Transfer } from '../src/transfers/entities/transfer.entity';
import {
  LedgerCommandError,
  LedgerGateway,
} from '../src/transfers/ledger.gateway';
import { TransferSagaService } from '../src/transfers/transfer-saga.service';
import { TransfersService } from '../src/transfers/transfers.service';

jest.setTimeout(30_000);

class SplitLedger implements LedgerGateway {
  failValidationFor = new Set<string>();
  readonly settled = new Set<string>();
  readonly held = new Set<string>();

  async validate(transfer: Transfer): Promise<{ receiverWalletId: string }> {
    if (this.failValidationFor.has(transfer.senderUserId)) {
      throw new LedgerCommandError(
        'receiver rejected',
        'terminal',
        'RECEIVER_REJECTED',
        false,
      );
    }
    return { receiverWalletId: randomUUID() };
  }

  async placeHold(transfer: Transfer): Promise<void> {
    this.held.add(transfer.id);
  }

  async settle(transfer: Transfer): Promise<void> {
    if (this.settled.has(transfer.id)) return;
    if (!this.held.has(transfer.id)) throw new Error('hold missing');
    this.held.delete(transfer.id);
    this.settled.add(transfer.id);
  }

  async release(
    transfer: Transfer,
  ): Promise<{ outcome: 'released' | 'already_settled' }> {
    if (this.settled.has(transfer.id)) return { outcome: 'already_settled' };
    this.held.delete(transfer.id);
    return { outcome: 'released' };
  }
}

describe('split bills through the normal transfer saga', () => {
  let dataSource: DataSource;
  let service: SplitBillsService;
  let reminder: SplitBillReminderService;
  let ledger: SplitLedger;
  const creatorUserId = randomUUID();
  const creatorReference = 'creator@example.com';
  const participantA = randomUUID();
  const participantB = randomUUID();
  const participantC = randomUUID();

  beforeAll(async () => {
    const database =
      process.env.TEST_PAYMENTS_DATABASE_NAME ?? 'payments_persistence_test';
    if (!database.endsWith('_test')) {
      throw new Error('Tests require a dedicated *_test database');
    }
    dataSource = new DataSource({
      type: 'postgres',
      host: process.env.TEST_PAYMENTS_DATABASE_HOST ?? '127.0.0.1',
      port: Number(process.env.TEST_PAYMENTS_DATABASE_PORT ?? 55433),
      username: process.env.TEST_PAYMENTS_DATABASE_USER ?? 'payments_test',
      password: process.env.TEST_PAYMENTS_DATABASE_PASSWORD ?? 'payments_test',
      database,
      entities: paymentsEntities,
      migrations: paymentsMigrations,
      migrationsRun: true,
      synchronize: false,
      dropSchema: true,
    });
    await dataSource.initialize();
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  beforeEach(async () => {
    await dataSource.query(
      'TRUNCATE split_bill_reminders, integration_outbox, transfers, split_bill_shares, split_bills CASCADE',
    );
    ledger = new SplitLedger();
    const publisher: jest.Mocked<MessagePublisher> = {
      publish: jest.fn().mockResolvedValue(undefined),
    };
    const outbox = new PaymentsOutboxService(dataSource, publisher);
    const transfers = new TransfersService(
      dataSource.getRepository(Transfer),
      dataSource,
    );
    const saga = new TransferSagaService(
      dataSource.getRepository(Transfer),
      dataSource,
      ledger,
      outbox,
    );
    service = new SplitBillsService(
      dataSource.getRepository(SplitBill),
      dataSource,
      transfers,
      saga,
      outbox,
    );
    reminder = new SplitBillReminderService(dataSource, outbox);
  });

  it('distributes an equal split exactly, including the remainder cents', async () => {
    const bill = await createEqual('10.00', [
      participantA,
      participantB,
      participantC,
    ]);

    expect(bill.status).toBe(SplitBillStatus.Pending);
    expect(bill.shares.map(({ amount }) => amount)).toEqual([
      '3.34',
      '3.33',
      '3.33',
    ]);
    expect(
      bill.shares.reduce(
        (sum, share) => sum + BigInt(share.amount.replace('.', '')),
        0n,
      ),
    ).toBe(1000n);
  });

  it('accepts exact custom shares and rejects a total mismatch', async () => {
    const bill = await service.create(
      {
        total: '10.00',
        currency: 'USD',
        mode: SplitMode.Custom,
        participants: [
          { userId: participantA, share: '4.25' },
          { userId: participantB, share: '5.75' },
        ],
      },
      creatorUserId,
      creatorReference,
    );
    expect(bill.shares.map(({ amount }) => amount)).toEqual(['4.25', '5.75']);

    await expect(
      service.create(
        {
          total: '10.00',
          currency: 'USD',
          mode: SplitMode.Custom,
          participants: [
            { userId: participantA, share: '4.00' },
            { userId: participantB, share: '5.00' },
          ],
        },
        creatorUserId,
        creatorReference,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('derives Pending, PartiallyPaid and Settled from completed transfers', async () => {
    const bill = await createEqual('30.00', [
      participantA,
      participantB,
      participantC,
    ]);

    const afterOne = await pay(bill.id, bill.shares[0].id, participantA);
    expect(afterOne.bill.status).toBe(SplitBillStatus.PartiallyPaid);
    expect(afterOne.bill.shares[0].paymentStatus).toBe(
      SplitSharePaymentStatus.Paid,
    );

    const afterTwo = await pay(bill.id, bill.shares[1].id, participantB);
    expect(afterTwo.bill.status).toBe(SplitBillStatus.PartiallyPaid);
    expect(
      afterTwo.bill.shares.filter(({ paymentStatus }) => paymentStatus === 'Paid'),
    ).toHaveLength(2);

    const afterAll = await pay(bill.id, bill.shares[2].id, participantC);
    expect(afterAll.bill.status).toBe(SplitBillStatus.Settled);
    expect(
      afterAll.bill.shares.every((share) => share.paymentStatus === 'Paid'),
    ).toBe(true);
    expect(ledger.settled.size).toBe(3);
  });

  it('creates one normal transfer for concurrent duplicate share payment', async () => {
    const bill = await createEqual('10.00', [participantA]);
    const share = bill.shares[0];
    const fromWalletId = randomUUID();

    const results = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        pay(
          bill.id,
          share.id,
          participantA,
          `duplicate-${index}`,
          fromWalletId,
        ),
      ),
    );

    expect(new Set(results.map(({ transfer }) => transfer.id)).size).toBe(1);
    await expect(
      dataSource.getRepository(Transfer).countBy({ splitBillShareId: share.id }),
    ).resolves.toBe(1);
    expect(ledger.settled.size).toBe(1);
  });

  it('allows only the assigned participant to pay a share', async () => {
    const bill = await createEqual('10.00', [participantA]);

    await expect(
      pay(bill.id, bill.shares[0].id, participantB),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(dataSource.getRepository(Transfer).count()).resolves.toBe(0);
  });

  it('does not mark a share paid when the underlying saga fails', async () => {
    const bill = await createEqual('10.00', [participantA]);
    ledger.failValidationFor.add(participantA);

    const result = await pay(bill.id, bill.shares[0].id, participantA);

    expect(result.transfer.status).toBe('Failed');
    expect(result.bill.status).toBe(SplitBillStatus.Pending);
    expect(result.bill.shares[0].paymentStatus).toBe(
      SplitSharePaymentStatus.PaymentFailed,
    );
  });

  it('persists and publishes one reminder for an overdue unpaid share', async () => {
    const bill = await createEqual('10.00', [participantA], '2026-01-01T00:00:00.000Z');

    await expect(
      reminder.detectAndEnqueue(new Date('2026-01-02T00:00:00.000Z')),
    ).resolves.toBe(1);
    await expect(
      reminder.detectAndEnqueue(new Date('2026-01-03T00:00:00.000Z')),
    ).resolves.toBe(0);
    await expect(dataSource.getRepository(SplitBillReminder).count()).resolves.toBe(
      1,
    );
    const reminders = await dataSource
      .getRepository(PaymentOutboxMessage)
      .createQueryBuilder('message')
      .where("message.event ->> 'eventType' = :eventType", {
        eventType: 'payments.split-bill.ShareOverdue',
      })
      .getMany();
    expect(reminders).toHaveLength(1);
    expect(reminders[0].event).toMatchObject({
      payload: { ownerId: participantA, splitBillId: bill.id },
    });
  });

  it('does not remind a share whose transfer completed before the deadline scan', async () => {
    const bill = await createEqual(
      '10.00',
      [participantA],
      '2026-01-01T00:00:00.000Z',
    );
    await pay(bill.id, bill.shares[0].id, participantA);

    await expect(
      reminder.detectAndEnqueue(new Date('2026-01-02T00:00:00.000Z')),
    ).resolves.toBe(0);
    await expect(dataSource.getRepository(SplitBillReminder).count()).resolves.toBe(
      0,
    );
  });

  async function createEqual(
    total: string,
    participants: string[],
    deadline?: string,
  ) {
    return service.create(
      {
        total,
        currency: 'USD',
        mode: SplitMode.Equal,
        participants: participants.map((userId) => ({ userId })),
        deadline,
      },
      creatorUserId,
      creatorReference,
    );
  }

  function pay(
    billId: string,
    shareId: string,
    participantUserId: string,
    key: string = randomUUID(),
    fromWalletId = randomUUID(),
  ) {
    return service.payShare(
      billId,
      shareId,
      participantUserId,
      fromWalletId,
      key,
    );
  }
});
