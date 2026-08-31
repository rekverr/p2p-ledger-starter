export enum TransferStatus {
  Pending = 'Pending',
  Validating = 'Validating',
  FundsHeld = 'FundsHeld',
  Processing = 'Processing',
  Completed = 'Completed',
  Compensating = 'Compensating',
  Failed = 'Failed',
}

const ALLOWED_TRANSITIONS: Readonly<Record<TransferStatus, readonly TransferStatus[]>> = {
  [TransferStatus.Pending]: [TransferStatus.Validating, TransferStatus.Failed],
  [TransferStatus.Validating]: [TransferStatus.FundsHeld, TransferStatus.Failed],
  [TransferStatus.FundsHeld]: [
    TransferStatus.Processing,
    TransferStatus.Compensating,
  ],
  [TransferStatus.Processing]: [
    TransferStatus.Completed,
    TransferStatus.Compensating,
  ],
  [TransferStatus.Compensating]: [TransferStatus.Failed],
  [TransferStatus.Completed]: [],
  [TransferStatus.Failed]: [],
};

export class InvalidTransferTransitionError extends Error {
  constructor(readonly current: TransferStatus, readonly next: TransferStatus) {
    super(`Invalid transfer transition: ${current} -> ${next}`);
    this.name = 'InvalidTransferTransitionError';
  }
}

export function assertTransferTransition(
  current: TransferStatus,
  next: TransferStatus,
): void {
  if (!ALLOWED_TRANSITIONS[current].includes(next)) {
    throw new InvalidTransferTransitionError(current, next);
  }
}
