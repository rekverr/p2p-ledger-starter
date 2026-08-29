import { IsNumber, IsPositive } from 'class-validator';

export class DepositDto {
  @IsNumber()
  @IsPositive()
  amount: number;
}
