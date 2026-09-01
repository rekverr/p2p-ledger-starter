import { Injectable } from '@nestjs/common';
import { Transfer } from './entities/transfer.entity';
import { currentCorrelationId } from '../observability/context';
import { injectTraceHeaders } from '../observability/propagation';

export const LEDGER_GATEWAY = Symbol('LEDGER_GATEWAY');

export type LedgerFailureKind = 'retryable' | 'terminal';

export class LedgerCommandError extends Error {
  constructor(
    message: string,
    readonly kind: LedgerFailureKind,
    readonly code: string,
    readonly ambiguous: boolean,
  ) {
    super(message);
    this.name = 'LedgerCommandError';
  }
}

export interface LedgerGateway {
  validate(transfer: Transfer): Promise<{ receiverWalletId: string }>;
  placeHold(transfer: Transfer): Promise<void>;
  settle(transfer: Transfer): Promise<void>;
  release(
    transfer: Transfer,
  ): Promise<{ outcome: 'released' | 'already_settled' }>;
}

@Injectable()
export class LedgerHttpClient implements LedgerGateway {
  private consecutiveFailures = 0;
  private openUntil = 0;

  validate(transfer: Transfer): Promise<{ receiverWalletId: string }> {
    return this.request('/internal/transfers/validate', {
      transferId: transfer.id,
      senderUserId: transfer.senderUserId,
      senderWalletId: transfer.senderWalletId,
      receiverReference: transfer.receiverReference,
      amount: this.amount(transfer.amountMinor),
      currency: transfer.currency,
      destinationAmount: this.amount(transfer.destinationAmountMinor),
      targetCurrency: transfer.destinationCurrency,
    });
  }

  async placeHold(transfer: Transfer): Promise<void> {
    await this.request(`/internal/transfers/${transfer.id}/hold`, {
      senderUserId: transfer.senderUserId,
      senderWalletId: transfer.senderWalletId,
      amount: this.amount(transfer.amountMinor),
    });
  }

  async settle(transfer: Transfer): Promise<void> {
    if (!transfer.receiverWalletId) {
      throw new LedgerCommandError(
        'Receiver wallet was not resolved',
        'terminal',
        'RECEIVER_NOT_RESOLVED',
        false,
      );
    }
    await this.request(`/internal/transfers/${transfer.id}/settle`, {
      senderUserId: transfer.senderUserId,
      senderWalletId: transfer.senderWalletId,
      receiverWalletId: transfer.receiverWalletId,
      amount: this.amount(transfer.amountMinor),
      currency: transfer.currency,
      destinationAmount: this.amount(transfer.destinationAmountMinor),
      targetCurrency: transfer.destinationCurrency,
    });
  }

  release(
    transfer: Transfer,
  ): Promise<{ outcome: 'released' | 'already_settled' }> {
    return this.request(`/internal/transfers/${transfer.id}/release`, {
      senderUserId: transfer.senderUserId,
      senderWalletId: transfer.senderWalletId,
    });
  }

  private async request<TResponse>(
    path: string,
    body: object,
  ): Promise<TResponse> {
    if (Date.now() < this.openUntil) {
      throw new LedgerCommandError(
        'Ledger circuit breaker is open',
        'retryable',
        'LEDGER_CIRCUIT_OPEN',
        true,
      );
    }
    const maxAttempts = Number(process.env.LEDGER_HTTP_MAX_ATTEMPTS ?? 3);
    let lastError: LedgerCommandError | undefined;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const response = await this.fetchOnce<TResponse>(path, body);
        this.consecutiveFailures = 0;
        this.openUntil = 0;
        return response;
      } catch (error: unknown) {
        const classified = this.classify(error);
        if (classified.kind === 'terminal') throw classified;
        lastError = classified;
        this.recordFailure();
        if (attempt < maxAttempts && Date.now() >= this.openUntil) {
          await this.delay(this.backoff(attempt));
          continue;
        }
        break;
      }
    }
    throw (
      lastError ??
      new LedgerCommandError(
        'Ledger request failed',
        'retryable',
        'LEDGER_UNAVAILABLE',
        true,
      )
    );
  }

  private async fetchOnce<TResponse>(
    path: string,
    body: object,
  ): Promise<TResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      Number(process.env.LEDGER_HTTP_TIMEOUT_MS ?? 1500),
    );
    try {
      const serviceToken = process.env.PAYMENTS_SERVICE_TOKEN;
      if (!serviceToken) {
        throw new LedgerCommandError(
          'Payments service credential is not configured',
          'terminal',
          'LEDGER_CLIENT_NOT_CONFIGURED',
          false,
        );
      }
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: injectTraceHeaders({
          'content-type': 'application/json',
          'x-service-token': serviceToken,
          ...(currentCorrelationId()
            ? { 'x-correlation-id': currentCorrelationId() as string }
            : {}),
        }),
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const payload = (await response.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;
      if (!response.ok) {
        const retryable =
          response.status === 408 ||
          response.status === 429 ||
          response.status >= 500;
        throw new LedgerCommandError(
          typeof payload.message === 'string'
            ? payload.message
            : `Ledger returned HTTP ${response.status}`,
          retryable ? 'retryable' : 'terminal',
          `LEDGER_HTTP_${response.status}`,
          retryable,
        );
      }
      return payload as TResponse;
    } catch (error: unknown) {
      if (error instanceof LedgerCommandError) throw error;
      if (error instanceof Error && error.name === 'AbortError') {
        throw new LedgerCommandError(
          'Ledger request timed out',
          'retryable',
          'LEDGER_TIMEOUT',
          true,
        );
      }
      throw new LedgerCommandError(
        error instanceof Error ? error.message : 'Ledger request failed',
        'retryable',
        'LEDGER_UNAVAILABLE',
        true,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private classify(error: unknown): LedgerCommandError {
    return error instanceof LedgerCommandError
      ? error
      : new LedgerCommandError(
          error instanceof Error ? error.message : String(error),
          'retryable',
          'LEDGER_UNAVAILABLE',
          true,
        );
  }

  private recordFailure(): void {
    this.consecutiveFailures += 1;
    const threshold = Number(process.env.LEDGER_CIRCUIT_FAILURE_THRESHOLD ?? 5);
    if (this.consecutiveFailures >= threshold) {
      this.openUntil =
        Date.now() + Number(process.env.LEDGER_CIRCUIT_COOLDOWN_MS ?? 5000);
    }
  }

  private backoff(attempt: number): number {
    const base = Number(process.env.LEDGER_HTTP_BACKOFF_MS ?? 100);
    return Math.min(base * 2 ** (attempt - 1), 1000);
  }

  private delay(milliseconds: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  private amount(amountMinor: string): number {
    return Number(amountMinor) / 100;
  }

  private get baseUrl(): string {
    return (process.env.LEDGER_SERVICE_URL ?? 'http://ledger-service:3001').replace(
      /\/$/,
      '',
    );
  }
}
