import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard } from '../src/auth/jwt-auth.guard';

describe('notifications JwtAuthGuard', () => {
  const secret = 'notifications-test-secret';
  const originalSecret = process.env.JWT_ACCESS_SECRET;

  beforeEach(() => {
    process.env.JWT_ACCESS_SECRET = secret;
  });

  afterEach(() => {
    if (originalSecret === undefined) delete process.env.JWT_ACCESS_SECRET;
    else process.env.JWT_ACCESS_SECRET = originalSecret;
  });

  it('derives the HTTP principal from a valid access token', () => {
    const jwt = new JwtService();
    const guard = new JwtAuthGuard(jwt);
    const request: Record<string, unknown> = {
      header: () =>
        `Bearer ${jwt.sign(
          { sub: 'user-1', email: 'user@example.com', role: 'user' },
          { secret },
        )}`,
    };

    expect(guard.canActivate(context(request))).toBe(true);
    expect(request.user).toEqual({
      userId: 'user-1',
      email: 'user@example.com',
      role: 'user',
    });
  });

  it('rejects a missing or invalid access token', () => {
    const guard = new JwtAuthGuard(new JwtService());
    expect(() => guard.canActivate(context({ header: () => undefined }))).toThrow(
      UnauthorizedException,
    );
    expect(() =>
      guard.canActivate(context({ header: () => 'Bearer invalid' })),
    ).toThrow(UnauthorizedException);
  });
});

function context(request: object): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as ExecutionContext;
}
