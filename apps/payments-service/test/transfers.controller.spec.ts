import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { JwtAuthGuard } from '../src/auth/jwt-auth.guard';
import { TransfersController } from '../src/transfers/transfers.controller';
import { TransfersService } from '../src/transfers/transfers.service';
import { TransferSagaService } from '../src/transfers/transfer-saga.service';

describe('TransfersController', () => {
  it('passes Idempotency-Key and authenticated principal to the service', async () => {
    const transfer = { id: 'transfer-1' };
    const transfers = {
      create: jest.fn().mockResolvedValue(transfer),
      getStatus: jest.fn().mockResolvedValue(transfer),
    };
    const saga = { run: jest.fn().mockResolvedValue(undefined) };
    const moduleRef = await Test.createTestingModule({
      controllers: [TransfersController],
      providers: [
        { provide: TransfersService, useValue: transfers },
        { provide: TransferSagaService, useValue: saga },
      ],
    }).compile();
    const controller = moduleRef.get(TransfersController);
    const dto = {
      fromWalletId: 'b3c34a63-528d-4a44-91cc-599a34422ed0',
      toWalletIdentifier: 'receiver@example.com',
      amount: 10,
      currency: 'USD',
    };

    await controller.create(dto, 'request-key', {
      user: { userId: 'sender-1', email: 'sender@example.com', role: 'user' },
    });

    expect(transfers.create).toHaveBeenCalledWith(dto, 'request-key', 'sender-1');
    expect(saga.run).toHaveBeenCalledWith('transfer-1');
    expect(transfers.getStatus).toHaveBeenCalledWith('transfer-1', 'sender-1');
    expect(Reflect.getMetadata(GUARDS_METADATA, TransfersController)).toEqual([
      JwtAuthGuard,
    ]);
  });
});
