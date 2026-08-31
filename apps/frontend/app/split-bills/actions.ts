'use server';

import { bffFetch } from '@/lib/api';
import { SplitBill } from '@/lib/types';

export interface CreateSplitBillInput {
  total: string;
  currency: string;
  mode: 'equal' | 'custom';
  participants: Array<{ userId: string; share?: string }>;
  deadline?: string;
}

export async function createSplitBill(
  input: CreateSplitBillInput,
): Promise<SplitBill> {
  return await bffFetch<SplitBill>('/split-bills', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}
