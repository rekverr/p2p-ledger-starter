import { LoggerService } from '@nestjs/common';
import { context, trace } from '@opentelemetry/api';
import { currentCorrelationId } from './context';

const REDACTED_KEYS = /password|token|authorization|cookie|secret/i;

export class JsonLogger implements LoggerService {
  constructor(private readonly service: string) {}

  log(message: unknown, contextName?: string): void {
    this.write('info', message, contextName);
  }

  error(message: unknown, stack?: string, contextName?: string): void {
    this.write('error', message, contextName, stack);
  }

  warn(message: unknown, contextName?: string): void {
    this.write('warn', message, contextName);
  }

  debug(message: unknown, contextName?: string): void {
    this.write('debug', message, contextName);
  }

  verbose(message: unknown, contextName?: string): void {
    this.write('trace', message, contextName);
  }

  private write(level: string, message: unknown, contextName?: string, stack?: string): void {
    const span = trace.getSpan(context.active());
    const record = {
      timestamp: new Date().toISOString(),
      level,
      service: this.service,
      traceId: span?.spanContext().traceId,
      correlationId: currentCorrelationId(),
      context: contextName,
      message: typeof message === 'string' ? sanitizeText(message) : undefined,
      fields: typeof message === 'object' && message !== null ? sanitize(message) : undefined,
      stack: stack ? sanitizeStack(stack) : undefined,
    };
    const output = JSON.stringify(record);
    if (level === 'error') process.stderr.write(output + '\n');
    else process.stdout.write(output + '\n');
  }
}

function sanitize(value: unknown, depth = 0): unknown {
  if (depth > 5) return '[truncated]';
  if (Array.isArray(value)) return value.map((item) => sanitize(item, depth + 1));
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      REDACTED_KEYS.test(key) ? '[REDACTED]' : sanitize(item, depth + 1),
    ]),
  );
}

function sanitizeStack(stack: string): string {
  return sanitizeText(stack.split('\n').slice(0, 12).join('\n'));
}

function sanitizeText(value: string): string {
  return value
    .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/g, '[REDACTED_JWT]')
    .replace(/(password|refreshToken|accessToken|authorization|secret)=\S+/gi, '$1=[REDACTED]');
}
