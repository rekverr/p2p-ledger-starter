export class LogicalSubmission {
  private key: string | null = null;
  private running = false;

  begin(): { key: string; accepted: boolean } {
    if (!this.key) this.key = crypto.randomUUID();
    if (this.running) return { key: this.key, accepted: false };
    this.running = true;
    return { key: this.key, accepted: true };
  }

  finish(): void {
    this.running = false;
  }

  reset(): void {
    if (!this.running) this.key = null;
  }

  currentKey(): string | null {
    return this.key;
  }
}
