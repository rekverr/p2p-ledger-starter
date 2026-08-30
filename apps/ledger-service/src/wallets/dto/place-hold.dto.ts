import { IsNumber, IsPositive, IsUUID } from 'class-validator';

export class PlaceHoldDto {
  @IsUUID()
  holdId: string;

  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 })
  @IsPositive()
  amount: number;
}
