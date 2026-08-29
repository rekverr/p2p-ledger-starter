import { Test } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { WalletsService } from '../src/wallets/wallets.service';
import { Wallet } from '../src/wallets/entities/wallet.entity';

describe('WalletsService', () => {
  let service: WalletsService;
  let walletsRepo: {
    findOne: jest.Mock;
    find: jest.Mock;
    insert: jest.Mock;
    save: jest.Mock;
    create: jest.Mock;
  };
  let dataSource: { transaction: jest.Mock };

  beforeEach(async () => {
    walletsRepo = {
      findOne: jest.fn(),
      find: jest.fn(),
      insert: jest.fn(),
      save: jest.fn(async (w) => w),
      create: jest.fn((w) => w),
    };
    dataSource = {
      transaction: jest.fn(async (operation) =>
        operation({ getRepository: () => walletsRepo }),
      ),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        WalletsService,
        { provide: getRepositoryToken(Wallet), useValue: walletsRepo },
        { provide: getDataSourceToken(), useValue: dataSource },
      ],
    }).compile();

    service = moduleRef.get(WalletsService);
  });

  it('returns an existing wallet for the requested user and currency', async () => {
    const wallet = {
      id: 'wallet-1',
      ownerId: 'owner-1',
      currency: 'USD',
      balance: '0.00',
    };
    walletsRepo.findOne.mockResolvedValueOnce(wallet);

    await expect(
      service.getOrCreateForUser('owner-1', 'USD'),
    ).resolves.toBe(wallet);
    expect(walletsRepo.insert).not.toHaveBeenCalled();
  });

  it('creates the default wallet on the first wallet list request', async () => {
    const wallet = {
      id: 'wallet-1',
      ownerId: 'owner-1',
      currency: 'USD',
      balance: '0.00',
    };
    walletsRepo.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(wallet);
    walletsRepo.find.mockResolvedValueOnce([wallet]);

    await expect(service.listForUser('owner-1')).resolves.toEqual([wallet]);
    expect(walletsRepo.insert).toHaveBeenCalledWith({
      ownerId: 'owner-1',
      currency: 'USD',
      balance: '0',
    });
  });

  it('returns one logical wallet when creation requests race', async () => {
    const wallet = {
      id: 'wallet-1',
      ownerId: 'owner-1',
      currency: 'USD',
      balance: '0.00',
    };
    let walletExists = false;

    walletsRepo.findOne.mockImplementation(async () =>
      walletExists ? wallet : null,
    );
    walletsRepo.insert.mockImplementation(async () => {
      if (walletExists) {
        throw { code: '23505' };
      }
      walletExists = true;
    });

    const [first, second] = await Promise.all([
      service.getOrCreateForUser('owner-1', 'USD'),
      service.getOrCreateForUser('owner-1', 'USD'),
    ]);

    expect(first).toBe(wallet);
    expect(second).toBe(wallet);
    expect(walletsRepo.insert).toHaveBeenCalledTimes(2);
  });

  it('does not hide non-unique database failures during wallet creation', async () => {
    const databaseError = new Error('database unavailable');
    walletsRepo.findOne.mockResolvedValueOnce(null);
    walletsRepo.insert.mockRejectedValueOnce(databaseError);

    await expect(
      service.getOrCreateForUser('owner-1', 'USD'),
    ).rejects.toBe(databaseError);
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
    const wallet = {
      id: 'wallet-1',
      ownerId: 'owner-1',
      balance: '100.00',
    };
    walletsRepo.findOne.mockResolvedValueOnce(wallet);
    const result = await service.deposit('wallet-1', 'owner-1', 50);

    expect(result.balance).toBe('150.00');
    expect(walletsRepo.save).toHaveBeenCalledWith(wallet);
  });

  it('allows the owner to withdraw from their wallet', async () => {
    const wallet = {
      id: 'wallet-1',
      ownerId: 'owner-1',
      balance: '100.00',
    };
    walletsRepo.findOne.mockResolvedValueOnce(wallet);

    const result = await service.withdraw('wallet-1', 'owner-1', 25);

    expect(result.balance).toBe('75.00');
    expect(wallet.balance).toBe('75.00');
    expect(walletsRepo.save).toHaveBeenCalledWith(wallet);
    expect(walletsRepo.findOne).toHaveBeenCalledWith({
      where: { id: 'wallet-1', ownerId: 'owner-1' },
      lock: { mode: 'pessimistic_write' },
    });
    expect(dataSource.transaction).toHaveBeenCalledTimes(1);
  });

  it('allows withdrawing the exact available balance', async () => {
    const wallet = {
      id: 'wallet-1',
      ownerId: 'owner-1',
      balance: '100.00',
    };
    walletsRepo.findOne.mockResolvedValueOnce(wallet);

    const result = await service.withdraw('wallet-1', 'owner-1', 100);

    expect(result.balance).toBe('0.00');
    expect(walletsRepo.save).toHaveBeenCalledWith(wallet);
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

    const withdrawal = service.withdraw('wallet-1', 'owner-1', 500);

    await expect(withdrawal).rejects.toBeInstanceOf(BadRequestException);
    await expect(withdrawal).rejects.toThrow('Недостатньо коштів');
    expect(walletsRepo.save).not.toHaveBeenCalled();
  });
});
