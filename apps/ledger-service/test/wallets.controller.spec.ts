import { Test } from '@nestjs/testing';
import { WalletsController } from '../src/wallets/wallets.controller';
import { WalletsService } from '../src/wallets/wallets.service';

describe('WalletsController', () => {
  let controller: WalletsController;
  let walletsService: {
    getById: jest.Mock;
    deposit: jest.Mock;
    withdraw: jest.Mock;
    placeHold: jest.Mock;
    releaseHold: jest.Mock;
    consumeHold: jest.Mock;
  };

  const request = {
    user: { userId: 'owner-1', email: 'owner@example.com', role: 'user' },
  };

  beforeEach(async () => {
    walletsService = {
      getById: jest.fn(),
      deposit: jest.fn(),
      withdraw: jest.fn(),
      placeHold: jest.fn(),
      releaseHold: jest.fn(),
      consumeHold: jest.fn(),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [WalletsController],
      providers: [{ provide: WalletsService, useValue: walletsService }],
    }).compile();

    controller = moduleRef.get(WalletsController);
  });

  it('uses the JWT principal when reading a wallet', async () => {
    walletsService.getById.mockResolvedValueOnce({ id: 'wallet-1' });

    await controller.getOne('wallet-1', request);

    expect(walletsService.getById).toHaveBeenCalledWith('wallet-1', 'owner-1');
  });

  it('uses the JWT principal when depositing into a wallet', async () => {
    walletsService.deposit.mockResolvedValueOnce({ id: 'wallet-1' });

    await controller.deposit('wallet-1', { amount: 50 }, request);

    expect(walletsService.deposit).toHaveBeenCalledWith(
      'wallet-1',
      'owner-1',
      50,
    );
  });

  it('uses the JWT principal when withdrawing from a wallet', async () => {
    walletsService.withdraw.mockResolvedValueOnce({ id: 'wallet-1' });

    await controller.withdraw('wallet-1', { amount: 25 }, request);

    expect(walletsService.withdraw).toHaveBeenCalledWith(
      'wallet-1',
      'owner-1',
      25,
    );
  });

  it('uses the JWT principal for the complete hold lifecycle', async () => {
    walletsService.placeHold.mockResolvedValueOnce({ id: 'wallet-1' });
    walletsService.releaseHold.mockResolvedValueOnce({ id: 'wallet-1' });
    walletsService.consumeHold.mockResolvedValueOnce({ id: 'wallet-1' });

    await controller.placeHold(
      'wallet-1',
      { holdId: 'b3c34a63-528d-4a44-91cc-599a34422ed0', amount: 25 },
      request,
    );
    await controller.releaseHold(
      'wallet-1',
      'b3c34a63-528d-4a44-91cc-599a34422ed0',
      request,
    );
    await controller.consumeHold(
      'wallet-1',
      'b3c34a63-528d-4a44-91cc-599a34422ed0',
      request,
    );

    expect(walletsService.placeHold).toHaveBeenCalledWith(
      'wallet-1',
      'owner-1',
      'b3c34a63-528d-4a44-91cc-599a34422ed0',
      25,
    );
    expect(walletsService.releaseHold).toHaveBeenCalledWith(
      'wallet-1',
      'owner-1',
      'b3c34a63-528d-4a44-91cc-599a34422ed0',
    );
    expect(walletsService.consumeHold).toHaveBeenCalledWith(
      'wallet-1',
      'owner-1',
      'b3c34a63-528d-4a44-91cc-599a34422ed0',
    );
  });
});
