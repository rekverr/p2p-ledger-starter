import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Request } from 'express';
import { AuthenticatedRequest } from './authenticated-request';

interface JwtPayload {
  sub?: unknown;
  email?: unknown;
  role?: unknown;
}

@Injectable()
export class JwtPrincipalGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const secret = process.env.JWT_ACCESS_SECRET;
    if (!secret) throw new ServiceUnavailableException('JWT is not configured');
    const request = context.switchToHttp().getRequest<Request>();
    const token = request.header('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) throw new UnauthorizedException('Bearer token is required');
    try {
      const payload = this.jwt.verify<JwtPayload>(token, { secret });
      if (
        typeof payload.sub !== 'string' ||
        typeof payload.email !== 'string' ||
        typeof payload.role !== 'string'
      ) {
        throw new Error('Invalid principal');
      }
      (request as AuthenticatedRequest).user = {
        userId: payload.sub,
        email: payload.email,
        role: payload.role,
      };
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired access token');
    }
  }
}
