export enum SplitBillStatus {
  Pending = 'Pending',
  PartiallyPaid = 'PartiallyPaid',
  Settled = 'Settled',
}

export enum SplitSharePaymentStatus {
  Unpaid = 'Unpaid',
  PaymentPending = 'PaymentPending',
  PaymentFailed = 'PaymentFailed',
  Paid = 'Paid',
}

export function deriveSplitBillStatus(
  paidShares: number,
  totalShares: number,
): SplitBillStatus {
  if (totalShares > 0 && paidShares === totalShares) {
    return SplitBillStatus.Settled;
  }
  return paidShares > 0
    ? SplitBillStatus.PartiallyPaid
    : SplitBillStatus.Pending;
}
