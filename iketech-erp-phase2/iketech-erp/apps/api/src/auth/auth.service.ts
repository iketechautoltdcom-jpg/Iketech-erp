import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { createHash, randomBytes } from 'crypto';
import { sql } from 'kysely';
import { DbService } from '../db/db';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from './decorators';
import { DomainError } from '../common/errors';

const SESSION_HOURS = 12;
const IDLE_MINUTES = 60;
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');

@Injectable()
export class AuthService {
  constructor(private readonly dbs: DbService, private readonly audit: AuditService) {}

  static hashPassword(pw: string) {
    return argon2.hash(pw, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
  }

  static checkPasswordStrength(pw: string) {
    if (pw.length < 12) throw new DomainError('WEAK_PASSWORD', 'Password must be at least 12 characters', 400);
    if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) throw new DomainError('WEAK_PASSWORD', 'Password must contain letters and numbers', 400);
  }

  async login(email: string, password: string, ip?: string, userAgent?: string) {
    const db = this.dbs.db;
    const user = await db.selectFrom('users').selectAll().where('email', '=', email.trim().toLowerCase()).executeTakeFirst();
    const fail = new DomainError('INVALID_LOGIN', 'Email or password is incorrect', 401);
    if (!user) {
      await argon2.hash(password).catch(() => undefined); // equalise timing for unknown emails
      throw fail;
    }
    if (user.status !== 'ACTIVE') throw new DomainError('ACCOUNT_DISABLED', 'This account is disabled', 403);
    if (user.locked_until && user.locked_until > new Date()) {
      throw new DomainError('ACCOUNT_LOCKED', 'Too many failed attempts. Try again later.', 423);
    }
    const ok = await argon2.verify(user.password_hash, password);
    if (!ok) {
      const failed = user.failed_logins + 1;
      await this.dbs.tx(async (trx) => {
        await trx.updateTable('users').set({
          failed_logins: failed,
          locked_until: failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60000) : null,
        }).where('id', '=', user.id).execute();
        await this.audit.write(trx, { actorId: user.id, action: 'auth.login_failed', entity: 'user', entityId: user.id, ip, after: { failed } });
      });
      throw fail;
    }
    const token = randomBytes(32).toString('base64url');
    await this.dbs.tx(async (trx) => {
      await trx.updateTable('users').set({ failed_logins: 0, locked_until: null }).where('id', '=', user.id).execute();
      await trx.insertInto('sessions').values({
        id: hashToken(token), user_id: user.id, ip, user_agent: userAgent?.slice(0, 200),
        expires_at: new Date(Date.now() + SESSION_HOURS * 3600000),
      }).execute();
      await this.audit.write(trx, { actorId: user.id, action: 'auth.login', entity: 'user', entityId: user.id, ip });
    });
    return { token, user: await this.loadUser(user.id) };
  }

  async logout(token: string, actor: AuthUser) {
    await this.dbs.tx(async (trx) => {
      await trx.updateTable('sessions').set({ revoked_at: new Date() }).where('id', '=', hashToken(token)).execute();
      await this.audit.write(trx, { actorId: actor.id, action: 'auth.logout', entity: 'user', entityId: actor.id, ip: actor.ip });
    });
  }

  /** Resolves a session token to a user, enforcing absolute expiry, idle timeout and revocation. */
  async resolve(token: string): Promise<AuthUser | null> {
    const db = this.dbs.db;
    const s = await db.selectFrom('sessions').selectAll().where('id', '=', hashToken(token)).executeTakeFirst();
    if (!s || s.revoked_at || s.expires_at < new Date()) return null;
    if (Date.now() - s.last_seen_at.getTime() > IDLE_MINUTES * 60000) return null;
    if (Date.now() - s.last_seen_at.getTime() > 60000) {
      await db.updateTable('sessions').set({ last_seen_at: new Date() }).where('id', '=', s.id).execute();
    }
    return this.loadUser(s.user_id);
  }

  async loadUser(userId: string): Promise<AuthUser | null> {
    const db = this.dbs.db;
    const u = await db.selectFrom('users').select(['id', 'email', 'full_name', 'branch_id', 'status']).where('id', '=', userId).executeTakeFirst();
    if (!u || u.status !== 'ACTIVE') return null;
    const rows = await db.selectFrom('user_roles as ur')
      .innerJoin('roles as r', 'r.id', 'ur.role_id')
      .leftJoin('role_permissions as rp', 'rp.role_id', 'r.id')
      .leftJoin('permissions as p', 'p.id', 'rp.permission_id')
      .select(['r.code as role', 'p.code as perm'])
      .where('ur.user_id', '=', userId).execute();
    return {
      id: u.id, email: u.email, fullName: u.full_name, branchId: u.branch_id,
      roles: [...new Set(rows.map((r) => r.role))],
      permissions: new Set(rows.map((r) => r.perm).filter(Boolean) as string[]),
    };
  }

  async purgeExpiredSessions() {
    await this.dbs.db.deleteFrom('sessions').where(sql<boolean>`expires_at < now() - interval '7 days'`).execute();
  }
}
