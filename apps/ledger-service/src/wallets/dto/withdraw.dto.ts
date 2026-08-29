import { IsNumber, IsPositive } from 'class-validator';

export class WithdrawDto {
  @IsNumber({
    allowNaN: false,
    allowInfinity: false,
    maxDecimalPlaces: 2,
  })
  @IsPositive()
  amount: number;
}
