import { ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtModule } from '@nestjs/jwt';
import { AdminGuard } from '../src/admin.guard';
import { BffController } from '../src/bff.controller';
import { UpstreamService } from '../src/upstream.service';
import { JwtPrincipalGuard } from '../src/jwt-principal.guard';

describe('frontend BFF', () => {
  it('aggregates services and forwards the bearer auth context', async () => {
    const request = {
      headers: { authorization: 'Bearer access-token' },
      header: (name: string) =>
        name.toLowerCase() === 'authorization' ? 'Bearer access-token' : undefined,
      user: { userId: 'user-1', email: 'user@example.com', role: 'user' },
    };
    const upstream = {
      request: jest
        .fn()
        .mockResolvedValueOnce([{ id: 'wallet-1' }])
        .mockResolvedValueOnce({ items: [] })
        .mockResolvedValueOnce([]),
    };
    const moduleRef = await Test.createTestingModule({
      imports: [JwtModule.register({})],
      controllers: [BffController],
      providers: [
        { provide: UpstreamService, useValue: upstream },
        { provide: JwtPrincipalGuard, useValue: { canActivate: () => true } },
      ],
    }).compile();

    await expect(moduleRef.get(BffController).dashboard(request as never)).resolves.toEqual({
      me: request.user,
      wallets: [{ id: 'wallet-1' }],
      activity: { items: [] },
      splitBills: [],
    });
    expect(upstream.request).toHaveBeenNthCalledWith(1, 'ledger', '/wallets', {
      authorization: 'Bearer access-token',
    });
    expect(upstream.request).toHaveBeenNthCalledWith(
      2,
      'notifications',
      '/activity?limit=20',
      { authorization: 'Bearer access-token' },
    );
    expect(upstream.request).toHaveBeenNthCalledWith(3, 'payments', '/split-bills', {
      authorization: 'Bearer access-token',
    });
  });

  it('denies a non-admin before any admin upstream call', () => {
    const guard = new AdminGuard();
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({ user: { role: 'user' } }),
      }),
    };
    expect(() => guard.canActivate(context as never)).toThrow(ForbiddenException);
  });
});
