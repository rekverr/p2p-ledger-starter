import { Test } from '@nestjs/testing';
import { WalletsController } from '../src/wallets/wallets.controller';
import { WalletsService } from '../src/wallets/wallets.service';

describe('WalletsController', () => {
  let controller: WalletsController;
  let walletsService: {
    getById: jest.Mock;
    deposit: jest.Mock;
    withdraw: jest.Mock;
  };

  const request = {
    user: { userId: 'owner-1', email: 'owner@example.com', role: 'user' },
  };

  beforeEach(async () => {
    walletsService = {
      getById: jest.fn(),
      deposit: jest.fn(),
      withdraw: jest.fn(),
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
});
