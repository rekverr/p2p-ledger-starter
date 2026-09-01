import './observability/tracing';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { JsonLogger } from './observability/json-logger';
import { MetricsService } from './observability/metrics.service';
import { requestObservability } from './observability/request-observability';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  const service = 'gateway-service';
  process.env.OTEL_SERVICE_NAME ??= service;
  const app = await NestFactory.create(AppModule, { logger: new JsonLogger(service) });
  if (process.env.TRUST_PROXY === 'true') {
    app.getHttpAdapter().getInstance().set('trust proxy', 1);
  }
  app.use(requestObservability(app.get(MetricsService), service));
  app.enableCors({ origin: allowedOrigins(), credentials: true });
  const openApi = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('P2P Frontend BFF API')
      .setDescription('Frontend-facing aggregation and authenticated proxy API')
      .setVersion('1.0')
      .addBearerAuth()
      .build(),
  );
  SwaggerModule.setup('docs', app, openApi, { jsonDocumentUrl: 'docs-json' });
  await app.listen(process.env.PORT ?? 3004);
}

void bootstrap();

function allowedOrigins(): string[] {
  return (process.env.CORS_ORIGINS ?? 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}
