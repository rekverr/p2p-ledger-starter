import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateTransferDto } from '../src/transfers/dto/create-transfer.dto';

describe('CreateTransferDto', () => {
  const valid = {
    fromWalletId: 'b3c34a63-528d-4a44-91cc-599a34422ed0',
    toWalletIdentifier: 'receiver@example.com',
    amount: 10.25,
    currency: 'usd',
    targetCurrency: 'eur',
  };

  it('normalizes receiver/currency and accepts a valid amount', async () => {
    const dto = plainToInstance(CreateTransferDto, {
      ...valid,
      toWalletIdentifier: ' receiver@example.com ',
    });
    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto.currency).toBe('USD');
    expect(dto.toWalletIdentifier).toBe('receiver@example.com');
    expect(dto.targetCurrency).toBe('EUR');
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, '10', 10.001])(
    'rejects invalid amount %p',
    async (amount) => {
      await expect(
        validate(plainToInstance(CreateTransferDto, { ...valid, amount })),
      ).resolves.not.toHaveLength(0);
    },
  );

  it('rejects unsupported target currencies', async () => {
    await expect(
      validate(plainToInstance(CreateTransferDto, { ...valid, targetCurrency: 'GBP' })),
    ).resolves.not.toHaveLength(0);
  });
});
