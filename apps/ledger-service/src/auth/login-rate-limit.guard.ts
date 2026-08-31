import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Request } from 'express';

interface WindowState {
  count: number;
  resetAt: number;
}

@Injectable()
export class LoginRateLimitGuard implements CanActivate {
  private readonly windows = new Map<string, WindowState>();

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    this.consume(request.ip || request.socket.remoteAddress || 'unknown');
    return true;
  }

  private consume(key: string, now = Date.now()): void {
    const limit = positiveInteger(process.env.LOGIN_RATE_LIMIT_MAX, 10);
    const windowMs = positiveInteger(
      process.env.LOGIN_RATE_LIMIT_WINDOW_MS,
      60_000,
    );
    const current = this.windows.get(key);
    if (!current || current.resetAt <= now) {
      this.windows.set(key, { count: 1, resetAt: now + windowMs });
      this.prune(now);
      return;
    }
    current.count += 1;
    if (current.count > limit) {
      throw new HttpException('Too many login attempts', HttpStatus.TOO_MANY_REQUESTS);
    }
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
