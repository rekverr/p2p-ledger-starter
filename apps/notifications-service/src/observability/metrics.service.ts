import { Injectable } from '@nestjs/common';
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

@Injectable()
export class MetricsService {
  readonly registry = new Registry();
  readonly httpRequests = new Counter({
    name: 'http_requests_total',
    help: 'HTTP requests by bounded route and status',
    labelNames: ['method', 'route', 'status_code'],
    registers: [this.registry],
  });
  readonly httpErrors = new Counter({
    name: 'http_request_errors_total',
    help: 'HTTP error responses by bounded route',
    labelNames: ['method', 'route'],
    registers: [this.registry],
  });
  readonly httpDuration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request latency by bounded route',
    labelNames: ['method', 'route'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [this.registry],
  });
  readonly transferOutcomes = new Counter({
    name: 'transfer_outcomes_total',
    help: 'Transfer terminal outcomes',
    labelNames: ['outcome'],
    registers: [this.registry],
  });
  readonly sagaDuration = new Histogram({
    name: 'transfer_saga_duration_seconds',
    help: 'Transfer saga duration',
    labelNames: ['outcome'],
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60],
    registers: [this.registry],
  });
  readonly sagaStepDuration = new Histogram({
    name: 'saga_step_duration_seconds',
    help: 'Saga step latency',
    labelNames: ['step', 'outcome'],
    registers: [this.registry],
  });
  readonly sagaRetries = new Counter({
    name: 'saga_retries_total',
    help: 'Persisted saga retries',
    labelNames: ['step'],
    registers: [this.registry],
  });
  readonly compensations = new Counter({
    name: 'saga_compensations_total',
    help: 'Saga compensation attempts',
    labelNames: ['outcome'],
    registers: [this.registry],
  });
  readonly outboxBacklog = new Gauge({
    name: 'outbox_backlog',
    help: 'Unpublished durable outbox messages',
    registers: [this.registry],
  });
  readonly brokerConsumerFailures = new Counter({
    name: 'broker_consumer_failures_total',
    help: 'Broker consumer failures by bounded reason',
    labelNames: ['reason'],
    registers: [this.registry],
  });
  readonly reconciliationFailures = new Counter({
    name: 'reconciliation_failures_total',
    help: 'Detected reconciliation failures',
    labelNames: ['scope'],
    registers: [this.registry],
  });

  constructor() {
    this.registry.setDefaultLabels({ service: process.env.OTEL_SERVICE_NAME ?? 'unknown-service' });
    collectDefaultMetrics({ register: this.registry, prefix: 'process_' });
  }
}
