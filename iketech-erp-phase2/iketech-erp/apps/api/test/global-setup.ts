import { Client } from 'pg';
import { migrate } from '../src/db/migrate';
import { createDb } from '../src/db/db';
import { seed } from '../src/db/seed';

/** Recreates an isolated test database, applies every migration and the configuration seed. */
export default async function () {
  const admin = process.env.TEST_ADMIN_DATABASE_URL || 'postgresql://iketech:iketech_dev@localhost:5432/postgres';
  const url = process.env.TEST_DATABASE_URL || 'postgresql://iketech:iketech_dev@localhost:5432/iketech_test';
  const c = new Client({ connectionString: admin });
  await c.connect();
  await c.query('DROP DATABASE IF EXISTS iketech_test WITH (FORCE)');
  await c.query('CREATE DATABASE iketech_test');
  await c.end();
  await migrate(url);
  const db = createDb(url);
  await seed(db);
  await db.destroy();
  process.env.DATABASE_URL = url;
}
