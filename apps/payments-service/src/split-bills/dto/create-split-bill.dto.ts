import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsOptional,
  IsUUID,
  Matches,
  ValidateNested,
} from 'class-validator';

export enum SplitMode {
  Equal = 'equal',
  Custom = 'custom',
}

export class SplitParticipantDto {
  @IsUUID()
  userId: string;

  @IsOptional()
  @Matches(/^(0|[1-9]\d*)\.\d{2}$/)
  share?: string;
}

export class CreateSplitBillDto {
  @Matches(/^(0|[1-9]\d*)\.\d{2}$/)
  total: string;

  @Matches(/^[A-Z]{3}$/)
  currency: string;

  @IsEnum(SplitMode)
  mode: SplitMode;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => SplitParticipantDto)
  participants: SplitParticipantDto[];

  @IsOptional()
  @IsDateString({ strict: true })
  deadline?: string;
}
