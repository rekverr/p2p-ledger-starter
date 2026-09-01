import { Injectable } from '@nestjs/common';
import { LedgerCommandError } from './ledger.gateway';
import { isSupportedCurrency } from './domain/fx-quote';
import { Transfer } from './entities/transfer.entity';

@Injectable()
export class TransferPolicyService {
  validate(transfer: Transfer, now = new Date()): void {
    if (!isSupportedCurrency(transfer.currency) || !isSupportedCurrency(transfer.destinationCurrency)) {
      this.reject('UNSUPPORTED_CURRENCY', 'Currency is not supported');
    }
    const maximumMinor = BigInt(
      Math.round(Number(process.env.MAX_TRANSFER_AMOUNT ?? 10_000) * 100),
    );
    if (BigInt(transfer.amountMinor) > maximumMinor) {
      this.reject('TRANSFER_LIMIT_EXCEEDED', 'Transfer amount exceeds the configured limit');
    }
    const blocked = new Set(
      (process.env.BLOCKED_RECEIVER_REFERENCES ?? '')
        .split(',')
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean),
    );
    if (blocked.has(transfer.receiverReference.toLowerCase())) {
      this.reject('RECEIVER_BLOCKED', 'Receiver is blocked by transfer policy');
    }
    if (transfer.fxExpiresAt.getTime() <= now.getTime()) {
      this.reject('FX_QUOTE_EXPIRED', 'Persisted FX quote has expired');
    }
  }

  private reject(code: string, message: string): never {
    throw new LedgerCommandError(message, 'terminal', code, false);
  }
}
