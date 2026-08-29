import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { WalletsService } from '../src/wallets/wallets.service';
import { Wallet } from '../src/wallets/entities/wallet.entity';

describe('WalletsService', () => {
  let service: WalletsService;
  let walletsRepo: {
    findOne: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
  };

  beforeEach(async () => {
    walletsRepo = {
      findOne: jest.fn(),
      save: jest.fn(async (w) => w),
      create: jest.fn((w) => w),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        WalletsService,
        { provide: getRepositoryToken(Wallet), useValue: walletsRepo },
      ],
    }).compile();

    service = moduleRef.get(WalletsService);
  });

  it('allows the owner to read their wallet', async () => {
    const wallet = {
      id: 'wallet-1',
      ownerId: 'owner-1',
      balance: '100.00',
    };
    walletsRepo.findOne.mockResolvedValueOnce(wallet);

    await expect(service.getById('wallet-1', 'owner-1')).resolves.toBe(wallet);
    expect(walletsRepo.findOne).toHaveBeenCalledWith({
      where: { id: 'wallet-1', ownerId: 'owner-1' },
    });
  });

  it('allows the owner to deposit into their wallet', async () => {
    walletsRepo.findOne.mockResolvedValueOnce({
      id: 'wallet-1',
      ownerId: 'owner-1',
      balance: '100.00',
    });
    const result = await service.deposit('wallet-1', 'owner-1', 50);

    expect(result.balance).toBe('150.00');
    expect(walletsRepo.save).toHaveBeenCalledTimes(1);
  });

  it('allows the owner to withdraw from their wallet', async () => {
    walletsRepo.findOne.mockResolvedValueOnce({
      id: 'wallet-1',
      ownerId: 'owner-1',
      balance: '100.00',
    });

    const result = await service.withdraw('wallet-1', 'owner-1', 25);

    expect(result.balance).toBe('75.00');
    expect(walletsRepo.save).toHaveBeenCalledTimes(1);
  });

  it('does not allow another user to read a wallet', async () => {
    walletsRepo.findOne.mockResolvedValueOnce(null);

    await expect(
      service.getById('wallet-1', 'different-user'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(walletsRepo.save).not.toHaveBeenCalled();
  });

  it('does not allow another user to deposit into a wallet', async () => {
    walletsRepo.findOne.mockResolvedValueOnce(null);

    await expect(
      service.deposit('wallet-1', 'different-user', 50),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(walletsRepo.save).not.toHaveBeenCalled();
  });

  it('does not allow another user to withdraw from a wallet', async () => {
    walletsRepo.findOne.mockResolvedValueOnce(null);

    await expect(
      service.withdraw('wallet-1', 'different-user', 50),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(walletsRepo.save).not.toHaveBeenCalled();
  });

  it('does not allow withdrawing more than the current balance', async () => {
    walletsRepo.findOne.mockResolvedValueOnce({
      id: 'wallet-1',
      ownerId: 'owner-1',
      balance: '100.00',
    });

    await expect(
      service.withdraw('wallet-1', 'owner-1', 500),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(walletsRepo.save).not.toHaveBeenCalled();
  });
});
