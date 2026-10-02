import 'dotenv/config';

import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import * as path from 'path';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // Without this, PrismaService.onModuleDestroy() (which calls $disconnect())
  // never actually runs on process exit — Nest doesn't wire up SIGTERM/SIGINT
  // listeners unless told to. Every backend restart this session (nest
  // --watch recompiles on every save, plus manual restarts) was leaving a
  // dangling connection to the local prisma-dev PGlite server instead of
  // closing it cleanly, which is the most likely driver behind it wedging
  // ("Server has closed the connection" on every query) as often as it has.
  app.enableShutdownHooks();
  app.enableCors({
    origin: process.env.FRONTEND_ORIGIN ?? 'http://localhost:3000',
    credentials: true,
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  // Scan screenshots/HTML snapshots — served outside the /api prefix so they're
  // usable directly as <img src> URLs from the frontend.
  app.useStaticAssets(path.join(process.cwd(), 'storage', 'scans'), { prefix: '/scan-assets/' });
  app.useStaticAssets(path.join(process.cwd(), 'storage', 'executions'), { prefix: '/execution-assets/' });
  app.setGlobalPrefix('api');
  const port = process.env.PORT ?? 4000;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`backend-v2 listening on http://localhost:${port}/api`);
}
bootstrap();
