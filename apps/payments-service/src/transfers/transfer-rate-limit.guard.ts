import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';

interface AuthenticatedRequest {
  user?: { userId?: string };
}

interface WindowState {
  count: number;
  resetAt: number;
}

@Injectable()
export class TransferRateLimitGuard implements CanActivate {
  private readonly windows = new Map<string, WindowState>();

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const userId = request.user?.userId;
    if (!userId) return true;
    const now = Date.now();
    const limit = positiveInteger(process.env.TRANSFER_RATE_LIMIT_MAX, 30);
    const windowMs = positiveInteger(
      process.env.TRANSFER_RATE_LIMIT_WINDOW_MS,
      60_000,
    );
    const current = this.windows.get(userId);
    if (!current || current.resetAt <= now) {
      this.windows.set(userId, { count: 1, resetAt: now + windowMs });
      this.prune(now);
      return true;
    }
    current.count += 1;
    if (current.count > limit) {
      throw new HttpException(
        'Too many transfer requests',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }

  private prune(now: number): void {
    if (this.windows.size < 10_000) return;
    for (const [key, value] of this.windows) {
      if (value.resetAt <= now) this.windows.delete(key);
    }
  }
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}
