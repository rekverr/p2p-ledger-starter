import './observability/tracing';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { JsonLogger } from './observability/json-logger';
import { MetricsService } from './observability/metrics.service';
import { requestObservability } from './observability/request-observability';

async function bootstrap() {
  const service = 'ledger-service';
  process.env.OTEL_SERVICE_NAME ??= service;
  const app = await NestFactory.create(AppModule, { logger: new JsonLogger(service) });
  if (process.env.TRUST_PROXY === 'true') {
    app.getHttpAdapter().getInstance().set('trust proxy', 1);
  }
  app.use(requestObservability(app.get(MetricsService), service));
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableCors({ origin: allowedOrigins(), credentials: true });
  const port = process.env.PORT ?? 3001;
  await app.listen(port);
}
void bootstrap();

function allowedOrigins(): string[] {
  return (process.env.CORS_ORIGINS ?? 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}
