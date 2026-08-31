import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ServiceAuthGuard } from '../src/wallets/service-auth.guard';

describe('ServiceAuthGuard', () => {
  const originalToken = process.env.PAYMENTS_SERVICE_TOKEN;

  afterEach(() => {
    if (originalToken === undefined) delete process.env.PAYMENTS_SERVICE_TOKEN;
    else process.env.PAYMENTS_SERVICE_TOKEN = originalToken;
  });

  it('allows only the configured payments service credential', () => {
    process.env.PAYMENTS_SERVICE_TOKEN = 'service-secret';
    const guard = new ServiceAuthGuard();

    expect(guard.canActivate(context('service-secret'))).toBe(true);
    expect(() => guard.canActivate(context('wrong-secret'))).toThrow(
      UnauthorizedException,
    );
  });
});

function context(token: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ header: () => token }),
    }),
  } as ExecutionContext;
}
