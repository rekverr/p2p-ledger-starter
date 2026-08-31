import { IsUUID } from 'class-validator';

export class PaySplitShareDto {
  @IsUUID()
  fromWalletId: string;
}
