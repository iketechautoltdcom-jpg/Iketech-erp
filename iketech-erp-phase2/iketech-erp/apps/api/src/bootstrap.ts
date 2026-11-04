import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { csrfGuard } from './common/csrf';

export async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: process.env.NODE_ENV === 'test' ? false : ['log', 'warn', 'error'] });
  const origins = (process.env.WEB_ORIGIN || 'http://localhost:3000').split(',').map((s) => s.trim());
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cookieParser());
  app.useBodyParser('json', { limit: '1mb' });
  app.enableCors({ origin: origins, credentials: true });
  app.use(csrfGuard(origins));
  app.setGlobalPrefix('api/v1');
  return app;
}
