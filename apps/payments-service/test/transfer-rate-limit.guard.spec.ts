import { TransferRateLimitGuard } from '../src/transfers/transfer-rate-limit.guard';

describe('TransferRateLimitGuard', () => {
  const originalEnvironment = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnvironment };
  });

  it('limits each authenticated principal independently', () => {
    process.env.TRANSFER_RATE_LIMIT_MAX = '1';
    const guard = new TransferRateLimitGuard();

    expect(guard.canActivate(context('user-a'))).toBe(true);
    expect(() => guard.canActivate(context('user-a'))).toThrow(
      expect.objectContaining({ status: 429 }),
    );
    expect(guard.canActivate(context('user-b'))).toBe(true);
  });
});

function context(userId: string) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user: { userId } }) }),
  } as never;
}
