import { IsNumber, IsPositive, IsString, IsUUID } from 'class-validator';

// Каркас DTO вже готовий. За потреби додайте поле під idempotency key
// (див. ТЗ, розділ про переказ і Idempotency-Key) — воно тут навмисно
// не заведене.
export class CreateTransferDto {
  @IsUUID()
  fromWalletId: string;

  @IsString()
  toWalletIdentifier: string; // email або username отримувача

  @IsNumber()
  @IsPositive()
  amount: number;

  @IsString()
  currency: string;
}
