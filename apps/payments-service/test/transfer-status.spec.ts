import {
  assertTransferTransition,
  InvalidTransferTransitionError,
  TransferStatus,
} from '../src/transfers/domain/transfer-status';

describe('transfer state machine', () => {
  it('allows the intended forward lifecycle', () => {
    expect(() =>
      assertTransferTransition(TransferStatus.Pending, TransferStatus.Validating),
    ).not.toThrow();
    expect(() =>
      assertTransferTransition(TransferStatus.Processing, TransferStatus.Completed),
    ).not.toThrow();
    expect(() =>
      assertTransferTransition(TransferStatus.Compensating, TransferStatus.Failed),
    ).not.toThrow();
  });

  it('rejects skipping steps, backwards moves and terminal-state changes', () => {
    expect(() =>
      assertTransferTransition(TransferStatus.Pending, TransferStatus.Completed),
    ).toThrow(InvalidTransferTransitionError);
    expect(() =>
      assertTransferTransition(TransferStatus.Completed, TransferStatus.Processing),
    ).toThrow(InvalidTransferTransitionError);
    expect(() =>
      assertTransferTransition(TransferStatus.Failed, TransferStatus.Pending),
    ).toThrow(InvalidTransferTransitionError);
  });
});
