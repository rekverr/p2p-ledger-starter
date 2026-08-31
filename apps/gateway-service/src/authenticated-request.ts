import { Request } from 'express';

export interface AuthenticatedPrincipal {
  userId: string;
  email: string;
  role: string;
}

export type AuthenticatedRequest = Request & { user: AuthenticatedPrincipal };

export function bearer(request: Request): string {
  const value = request.header('authorization');
  if (!value) throw new Error('Authenticated request has no Authorization header');
  return value;
}
