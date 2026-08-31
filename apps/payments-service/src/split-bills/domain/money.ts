import { BadRequestException } from '@nestjs/common';

const MONEY_PATTERN = /^(0|[1-9]\d*)\.\d{2}$/;

export function parseMoneyToMinor(value: string, field: string): bigint {
  if (!MONEY_PATTERN.test(value)) {
    throw new BadRequestException(`${field} must use exact 0.00 decimal format`);
  }
  const [whole, fraction] = value.split('.');
  const minor = BigInt(whole) * 100n + BigInt(fraction);
  if (minor <= 0n) throw new BadRequestException(`${field} must be positive`);
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new BadRequestException(`${field} exceeds supported range`);
  }
  return minor;
}

export function formatMinorUnits(value: bigint): string {
  return `${value / 100n}.${(value % 100n).toString().padStart(2, '0')}`;
}
