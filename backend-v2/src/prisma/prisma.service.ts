import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      // Local Postgres, not SQLite — SQLite's ~999 bound-parameter-per-query
      // limit was hit repeatedly on real data (a 1000+ row Object Library,
      // an application with many test cases); Postgres raises that ceiling
      // to 65535. Runs via `npx prisma dev` (PGlite-backed, no external DB
      // server/install/company permission needed) — see .env for the
      // connection string and README for how to start it.
      adapter: new PrismaPg({
        connectionString: process.env.DATABASE_URL,
      }),
    });
  }

  async onModuleInit() {
    await this.$connect();
    this.logger.log('Connected to database');
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
