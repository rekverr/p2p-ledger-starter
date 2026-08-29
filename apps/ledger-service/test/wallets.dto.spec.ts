import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { DepositDto } from '../src/wallets/dto/deposit.dto';
import { WithdrawDto } from '../src/wallets/dto/withdraw.dto';

type AmountDto = { amount: number };
type AmountDtoClass = new () => AmountDto;

describe.each<[string, AmountDtoClass]>([
  ['DepositDto', DepositDto],
  ['WithdrawDto', WithdrawDto],
])('%s', (_name, Dto) => {
  it.each([
    ['negative', -1],
    ['zero', 0],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['numeric string', '10.00'],
    ['malformed string', 'not-a-number'],
    ['more than two decimal places', 10.001],
  ])('rejects %s amount', async (_caseName, amount) => {
    const dto = plainToInstance(Dto, { amount });

    await expect(validate(dto)).resolves.not.toHaveLength(0);
  });

  it('accepts a positive amount with at most two decimal places', async () => {
    const dto = plainToInstance(Dto, { amount: 10.25 });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('strips non-whitelisted fields', async () => {
    const dto = plainToInstance(Dto, {
      amount: 10.25,
      ownerId: 'different-user',
      balance: '999999.99',
    });

    await expect(validate(dto, { whitelist: true })).resolves.toHaveLength(0);
    expect(dto).not.toHaveProperty('ownerId');
    expect(dto).not.toHaveProperty('balance');
  });
});
