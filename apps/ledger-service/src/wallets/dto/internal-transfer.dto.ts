import { Transform } from 'class-transformer';
import {
  IsNotEmpty,
  IsNumber,
  IsPositive,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

export class ValidateInternalTransferDto {
  @IsUUID()
  transferId: string;

  @IsUUID()
  senderUserId: string;

  @IsUUID()
  senderWalletId: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsNotEmpty()
  @MaxLength(320)
  receiverReference: string;

  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 })
  @IsPositive()
  amount: number;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @Matches(/^[A-Z]{3}$/)
  currency: string;
}

export class HoldInternalTransferDto {
  @IsUUID()
  senderUserId: string;

  @IsUUID()
  senderWalletId: string;

  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 })
  @IsPositive()
  amount: number;
}

export class ReleaseInternalTransferDto {
  @IsUUID()
  senderUserId: string;

  @IsUUID()
  senderWalletId: string;
}

export class SettleInternalTransferDto extends ReleaseInternalTransferDto {
  @IsUUID()
  receiverWalletId: string;

  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 })
  @IsPositive()
  amount: number;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @Matches(/^[A-Z]{3}$/)
  currency: string;
}
