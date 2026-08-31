import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { JwtAuthGuard } from '../src/auth/jwt-auth.guard';
import { SplitMode } from '../src/split-bills/dto/create-split-bill.dto';
import { SplitBillsController } from '../src/split-bills/split-bills.controller';
import { SplitBillsService } from '../src/split-bills/split-bills.service';

describe('SplitBillsController', () => {
  it('uses the JWT principal for creator and participant identity', async () => {
    const service = {
      create: jest.fn().mockResolvedValue({ id: 'bill-id' }),
      get: jest.fn(),
      payShare: jest.fn().mockResolvedValue({}),
    };
    const moduleRef = await Test.createTestingModule({
      controllers: [SplitBillsController],
      providers: [{ provide: SplitBillsService, useValue: service }],
    }).compile();
    const controller = moduleRef.get(SplitBillsController);
    const request = {
      user: { userId: 'principal-id', email: 'user@example.com', role: 'user' },
    };
    const dto = {
      total: '10.00',
      currency: 'USD',
      mode: SplitMode.Equal,
      participants: [{ userId: '22222222-2222-4222-8222-222222222222' }],
    };

    await controller.create(dto, request);
    await controller.pay(
      '33333333-3333-4333-8333-333333333333',
      '44444444-4444-4444-8444-444444444444',
      { fromWalletId: '55555555-5555-4555-8555-555555555555' },
      'share-key',
      request,
    );

    expect(service.create).toHaveBeenCalledWith(
      dto,
      'principal-id',
      'user@example.com',
    );
    expect(service.payShare).toHaveBeenCalledWith(
      '33333333-3333-4333-8333-333333333333',
      '44444444-4444-4444-8444-444444444444',
      'principal-id',
      '55555555-5555-4555-8555-555555555555',
      'share-key',
    );
    expect(Reflect.getMetadata(GUARDS_METADATA, SplitBillsController)).toEqual([
      JwtAuthGuard,
    ]);
  });
});
