import { BadRequestException } from '@nestjs/common';

export const SUPPORTED_CURRENCIES = ['USD', 'EUR', 'UAH'] as const;
export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

// Deterministic local-provider snapshot: value of one major currency unit in
// micro-USD. Quotes derived from this table are persisted on the transfer.
const MICRO_USD_VALUE: Readonly<Record<SupportedCurrency, bigint>> = {
  USD: 1_000_000n,
  EUR: 1_087_000n,
  UAH: 24_390n,
};

export interface FxQuote {
  destinationAmountMinor: string;
  rateNumerator: string;
  rateDenominator: string;
  displayRate: string;
  quotedAt: Date;
  expiresAt: Date;
}

export function isSupportedCurrency(value: string): value is SupportedCurrency {
  return SUPPORTED_CURRENCIES.includes(value as SupportedCurrency);
}

export function quoteTransfer(
  sourceAmountMinor: string,
  sourceCurrency: string,
  destinationCurrency: string,
  quotedAt = new Date(),
): FxQuote {
  if (!isSupportedCurrency(sourceCurrency) || !isSupportedCurrency(destinationCurrency)) {
    throw new BadRequestException('Unsupported currency');
  }
  const source = BigInt(sourceAmountMinor);
  if (source <= 0n) throw new BadRequestException('Invalid transfer amount');
  const numerator = MICRO_USD_VALUE[sourceCurrency];
  const denominator = MICRO_USD_VALUE[destinationCurrency];
  // Half-up integer rounding; floating point never determines the money result.
  const destination = (source * numerator + denominator / 2n) / denominator;
  if (destination <= 0n) throw new BadRequestException('FX result is below one minor unit');
  return {
    destinationAmountMinor: destination.toString(),
    rateNumerator: numerator.toString(),
    rateDenominator: denominator.toString(),
    displayRate: formatRate(numerator, denominator),
    quotedAt,
    expiresAt: new Date(quotedAt.getTime() + 15 * 60_000),
  };
}

function formatRate(numerator: bigint, denominator: bigint): string {
  const scale = 100_000_000n;
  const scaled = (numerator * scale + denominator / 2n) / denominator;
  return `${scaled / scale}.${(scaled % scale).toString().padStart(8, '0')}`;
}
