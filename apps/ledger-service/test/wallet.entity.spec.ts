import { getMetadataArgsStorage } from 'typeorm';
import { Wallet } from '../src/wallets/entities/wallet.entity';

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
});
