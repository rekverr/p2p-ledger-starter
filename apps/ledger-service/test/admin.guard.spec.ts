import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AdminLedgerController } from '../src/admin/admin-ledger.controller';
import { AdminGuard } from '../src/auth/guards/admin.guard';
import { JwtAuthGuard } from '../src/auth/guards/jwt-auth.guard';

describe('AdminGuard', () => {
  function context(role?: string): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ user: role ? { role } : undefined }),
      }),
    } as ExecutionContext;
  }

  it('denies a non-admin authenticated principal', () => {
    expect(() => new AdminGuard().canActivate(context('user'))).toThrow(
      ForbiddenException,
    );
  });

  it('allows an admin principal', () => {
    expect(new AdminGuard().canActivate(context('admin'))).toBe(true);
  });

  it('protects admin ledger endpoints with authentication and admin authorization', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, AdminLedgerController)).toEqual([
      JwtAuthGuard,
      AdminGuard,
    ]);
  });
});
