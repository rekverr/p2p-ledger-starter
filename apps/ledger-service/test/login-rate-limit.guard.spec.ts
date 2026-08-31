import { LoginRateLimitGuard } from '../src/auth/login-rate-limit.guard';

describe('LoginRateLimitGuard', () => {
  const originalEnvironment = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnvironment };
  });

  it('returns 429 after the configured number of login attempts per client', () => {
    process.env.LOGIN_RATE_LIMIT_MAX = '2';
    process.env.LOGIN_RATE_LIMIT_WINDOW_MS = '60000';
    const guard = new LoginRateLimitGuard();
    const context = executionContext('203.0.113.10');

    expect(guard.canActivate(context)).toBe(true);
    expect(guard.canActivate(context)).toBe(true);
    expect(() => guard.canActivate(context)).toThrow(
      expect.objectContaining({ status: 429 }),
    );
  });
});

function executionContext(ip: string) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ ip, socket: { remoteAddress: ip } }),
    }),
  } as never;
}
