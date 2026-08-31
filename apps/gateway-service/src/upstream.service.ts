import {
  GatewayTimeoutException,
  HttpException,
  Injectable,
} from '@nestjs/common';

export type UpstreamName = 'ledger' | 'payments' | 'notifications';

@Injectable()
export class UpstreamService {
  async request<T>(
    service: UpstreamName,
    path: string,
    options: {
      method?: string;
      authorization?: string;
      body?: unknown;
      idempotencyKey?: string;
    } = {},
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      Number(process.env.UPSTREAM_TIMEOUT_MS ?? 3000),
    );
    try {
      const response = await fetch(`${this.baseUrl(service)}${path}`, {
        method: options.method ?? 'GET',
        headers: {
          'content-type': 'application/json',
          ...(options.authorization
            ? { authorization: options.authorization }
            : {}),
          ...(options.idempotencyKey
            ? { 'idempotency-key': options.idempotencyKey }
            : {}),
        },
        body:
          options.body === undefined
            ? undefined
            : JSON.stringify(options.body),
        signal: controller.signal,
      });
      const text = await response.text();
      const payload = text ? this.parse(text) : null;
      if (!response.ok) {
        throw new HttpException(this.exceptionBody(payload), response.status);
      }
      return payload as T;
    } catch (error: unknown) {
      if (error instanceof HttpException) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new GatewayTimeoutException(`${service} timed out`);
      }
      throw new HttpException(`${service} unavailable`, 502);
    } finally {
      clearTimeout(timeout);
    }
  }

  private baseUrl(service: UpstreamName): string {
    const urls: Record<UpstreamName, string> = {
      ledger: process.env.LEDGER_SERVICE_URL ?? 'http://ledger-service:3001',
      payments:
        process.env.PAYMENTS_SERVICE_URL ?? 'http://payments-service:3002',
      notifications:
        process.env.NOTIFICATIONS_SERVICE_URL ??
        'http://notifications-service:3003',
    };
    return urls[service].replace(/\/$/, '');
  }

  private parse(text: string): unknown {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return { message: text };
    }
  }

  private exceptionBody(value: unknown): string | Record<string, unknown> {
    if (typeof value === 'string') return value;
    if (typeof value === 'object' && value !== null) {
      return value as Record<string, unknown>;
    }
    return { message: String(value) };
  }
}
