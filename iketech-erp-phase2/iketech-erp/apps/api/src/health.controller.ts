import { Controller, Get } from '@nestjs/common';
import { sql } from 'kysely';
import { DbService } from './db/db';
import { Public } from './auth/decorators';

@Controller('health')
export class HealthController {
  constructor(private readonly dbs: DbService) {}

  @Public() @Get()
  async health() {
    await sql`SELECT 1`.execute(this.dbs.db);
    return { status: 'ok', time: new Date().toISOString() };
  }
}
