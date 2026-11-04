import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp } from '../src/bootstrap';
import { AuthService } from '../src/auth/auth.service';
import { DbService } from '../src/db/db';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgresql://iketech:iketech_dev@localhost:5432/iketech_test';
process.env.RATE_LIMIT_PER_MIN = '100000';

export const PASSWORD = 'TestPassword123';

export interface Client {
  id: string;
  get: (url: string) => request.Test;
  post: (url: string, body?: object) => request.Test;
  put: (url: string, body?: object) => request.Test;
  patch: (url: string, body?: object) => request.Test;
}

/** Test fixture users, clearly marked as test data (example.test domain). */
export class Harness {
  app!: INestApplication;
  db!: DbService['db'];
  private counter = 0;

  async start() {
    this.app = await createApp();
    await this.app.init();
    this.db = this.app.get(DbService).db;
    return this;
  }

  async stop() { await this.app.close(); }

  async user(roles: string[], name?: string): Promise<Client> {
    const n = ++this.counter;
    const email = `test-${roles.join('-').toLowerCase()}-${n}-${Date.now()}@example.test`;
    const branch = await this.db.selectFrom('branches').select('id').where('code', '=', 'PH').executeTakeFirstOrThrow();
    const u = await this.db.insertInto('users').values({ email, full_name: name ?? `Test ${roles.join('/')} ${n}`, password_hash: await AuthService.hashPassword(PASSWORD), branch_id: branch.id })
      .returning('id').executeTakeFirstOrThrow();
    for (const code of roles) {
      const r = await this.db.selectFrom('roles').select('id').where('code', '=', code).executeTakeFirstOrThrow();
      await this.db.insertInto('user_roles').values({ user_id: u.id, role_id: r.id }).execute();
    }
    const agent = request.agent(this.app.getHttpServer());
    const res = await agent.post('/api/v1/auth/login').set('X-Requested-With', 'iketech-erp').send({ email, password: PASSWORD });
    if (res.status !== 200) throw new Error(`login failed ${res.status} ${JSON.stringify(res.body)}`);
    const h = (t: request.Test) => t.set('X-Requested-With', 'iketech-erp');
    return {
      id: u.id,
      get: (url) => agent.get('/api/v1' + url),
      post: (url, body = {}) => h(agent.post('/api/v1' + url)).send(body),
      put: (url, body = {}) => h(agent.put('/api/v1' + url)).send(body),
      patch: (url, body = {}) => h(agent.patch('/api/v1' + url)).send(body),
    };
  }
}

let phoneSeq = 0;
/** Unique test phone numbers in the +234 900 range (not allocated to Nigerian networks). */
export const testPhone = () => `+234900${String(Date.now() % 100000).padStart(5, '0')}${String(++phoneSeq).padStart(2, '0')}`.slice(0, 14);
let plateSeq = 0;
export const testPlate = () => `TST${String(Date.now() % 10000).padStart(4, '0')}${++plateSeq}`.slice(0, 12);

export function expectOk(res: request.Response, status = [200, 201]) {
  if (!status.includes(res.status)) throw new Error(`Expected ${status} got ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body;
}
