import { getMetadataArgsStorage } from 'typeorm';
import { Wallet } from '../src/wallets/entities/wallet.entity';
import { WalletBalanceProjection } from '../src/wallets/entities/wallet-balance-projection.entity';

describe('Wallet database constraints', () => {
  it('declares one wallet per owner and currency', () => {
    const uniqueIndex = getMetadataArgsStorage().indices.find(
      (index) =>
        index.target === Wallet && index.name === 'UQ_wallets_owner_currency',
    );

    expect(uniqueIndex).toBeDefined();
    expect(uniqueIndex?.unique).toBe(true);
    expect(uniqueIndex?.columns).toEqual(['ownerId', 'currency']);
  });

  it('keeps balance only in the CQRS projection', () => {
    const walletBalanceColumn = getMetadataArgsStorage().columns.find(
      (column) => column.target === Wallet && column.propertyName === 'balance',
    );
    const projectionBalanceColumn = getMetadataArgsStorage().columns.find(
      (column) =>
        column.target === WalletBalanceProjection &&
        column.propertyName === 'balanceMinor',
    );

    expect(walletBalanceColumn).toBeUndefined();
    expect(projectionBalanceColumn).toBeDefined();
  });
});
