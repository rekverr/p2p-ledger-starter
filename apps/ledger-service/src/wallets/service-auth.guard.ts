import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import { Request } from 'express';

@Injectable()
export class ServiceAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const supplied = request.header('x-service-token') ?? '';
    const expected = process.env.PAYMENTS_SERVICE_TOKEN;
    if (!expected) {
      throw new ServiceUnavailableException(
        'Payments service credential is not configured',
      );
    }
    const suppliedBuffer = Buffer.from(supplied);
    const expectedBuffer = Buffer.from(expected);
    if (
      suppliedBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(suppliedBuffer, expectedBuffer)
    ) {
      throw new UnauthorizedException('Invalid service credential');
    }
    return true;
  }
}
