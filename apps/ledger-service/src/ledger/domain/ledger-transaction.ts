import { randomUUID } from 'crypto';
import { JsonObject } from '../../event-store/event-store.types';

export const EXTERNAL_CLEARING_ACCOUNT = 'system:external';

export interface Posting extends JsonObject {
  accountId: string;
  amountMinor: string;
}

export interface LedgerTransactionPayload extends JsonObject {
  transactionId: string;
  postings: Posting[];
}

export function walletAccountId(walletId: string): string {
  return `wallet:${walletId}`;
}

export function assertBalancedPostings(postings: Posting[]): void {
  if (postings.length < 2) {
    throw new Error('A ledger transaction requires at least two postings');
  }
  const total = postings.reduce(
    (sum, posting) => sum + parseMinorUnits(posting.amountMinor),
    0n,
  );
  if (total !== 0n) {
    throw new Error('Ledger postings are not balanced');
  }
}

export function createLedgerTransaction(
  walletId: string,
  walletAmountMinor: bigint,
  transactionId: string = randomUUID(),
): LedgerTransactionPayload {
  if (walletAmountMinor === 0n) {
    throw new Error('A ledger transaction amount cannot be zero');
  }
  const postings: Posting[] = [
    {
      accountId: walletAccountId(walletId),
      amountMinor: walletAmountMinor.toString(),
    },
    {
      accountId: EXTERNAL_CLEARING_ACCOUNT,
      amountMinor: (-walletAmountMinor).toString(),
    },
  ];
  assertBalancedPostings(postings);
  return { transactionId, postings };
}

export function readPostings(payload: object): Posting[] {
  const candidate = payload as { postings?: unknown };
  if (!Array.isArray(candidate.postings)) {
    throw new Error('Ledger event does not contain postings');
  }
  const postings = candidate.postings.map((posting: unknown) => {
    if (
      typeof posting !== 'object' ||
      posting === null ||
      !('accountId' in posting) ||
      !('amountMinor' in posting) ||
      typeof posting.accountId !== 'string' ||
      typeof posting.amountMinor !== 'string'
    ) {
      throw new Error('Ledger event contains an invalid posting');
    }
    return {
      accountId: posting.accountId,
      amountMinor: posting.amountMinor,
    };
  });
  assertBalancedPostings(postings);
  return postings;
}

export function parseMinorUnits(value: string): bigint {
  if (!/^-?\d+$/.test(value)) {
    throw new Error(`Invalid minor-unit amount: ${value}`);
  }
  return BigInt(value);
}

export function amountToMinorUnits(amount: number): bigint {
  const rounded = Math.round(amount * 100);
  if (!Number.isSafeInteger(rounded)) {
    throw new Error('Amount exceeds the supported monetary range');
  }
  return BigInt(rounded);
}

export function formatMinorUnits(amountMinor: bigint): string {
  const sign = amountMinor < 0n ? '-' : '';
  const absolute = amountMinor < 0n ? -amountMinor : amountMinor;
  return `${sign}${absolute / 100n}.${(absolute % 100n)
    .toString()
    .padStart(2, '0')}`;
}
