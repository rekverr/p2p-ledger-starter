import { describe, expect, it, vi } from 'vitest';
import { LogicalSubmission } from '@/lib/idempotency';

describe('LogicalSubmission', () => {
  it('reuses one key for duplicate/retry and rotates only for a new operation', () => {
    const randomUUID = vi
      .fn()
      .mockReturnValueOnce('first-key')
      .mockReturnValueOnce('second-key');
    vi.stubGlobal('crypto', { randomUUID });
    const submission = new LogicalSubmission();

    expect(submission.begin()).toEqual({ key: 'first-key', accepted: true });
    expect(submission.begin()).toEqual({ key: 'first-key', accepted: false });
    submission.finish();
    expect(submission.begin()).toEqual({ key: 'first-key', accepted: true });
    submission.finish();
    submission.reset();
    expect(submission.begin()).toEqual({ key: 'second-key', accepted: true });
  });
});
