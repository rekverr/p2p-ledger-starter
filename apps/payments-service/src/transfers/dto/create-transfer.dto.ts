import { Transform } from 'class-transformer';
import {
  IsNotEmpty,
  IsNumber,
  IsPositive,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

export class CreateTransferDto {
  @IsUUID()
  fromWalletId: string;

  @IsNotEmpty()
  @MaxLength(320)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  toWalletIdentifier: string; // email або username отримувача

  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 })
  @IsPositive()
  amount: number;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @Matches(/^[A-Z]{3}$/)
  currency: string;
}
