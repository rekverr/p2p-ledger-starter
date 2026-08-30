import { IsDateString, IsOptional } from 'class-validator';

export class ReconciliationQueryDto {
  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
