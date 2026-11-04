import './db/env';
import 'reflect-metadata';
import { createApp } from './bootstrap';
import { migrate } from './db/migrate';

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
  if (process.env.NODE_ENV === 'production' && (process.env.SESSION_SECRET ?? '').length < 32) throw new Error('SESSION_SECRET must be at least 32 characters in production');
  if (process.env.MIGRATE_ON_START === 'true') console.log('Migrations:', (await migrate(process.env.DATABASE_URL)).join(', ') || 'up to date');
  const app = await createApp();
  const port = Number(process.env.PORT || 4000);
  await app.listen(port);
  console.log(`IKETECH ERP API listening on :${port}/api/v1`);
}
main().catch((e) => { console.error(e); process.exit(1); });
