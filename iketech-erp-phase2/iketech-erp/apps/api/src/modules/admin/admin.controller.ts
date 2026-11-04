import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { DbService } from '../../db/db';
import { AuditService } from '../../audit/audit.service';
import { ConfigService, SETTING_DEFAULTS } from '../../config/config.service';
import { AuthService } from '../../auth/auth.service';
import { AuthUser, CurrentUser, Requires } from '../../auth/decorators';
import { ROLES } from '../../auth/rbac';
import { DomainError, forbidden, notFound } from '../../common/errors';
import { z } from '../../common/zod';

const NewUser = z.object({
  email: z.string().trim().toLowerCase().email(),
  fullName: z.string().trim().min(2).max(120),
  phone: z.string().trim().max(20).optional(),
  password: z.string().min(12).max(200),
  roles: z.array(z.enum(Object.keys(ROLES) as [string, ...string[]])).min(1),
  staffNo: z.string().trim().min(2).max(20),
  department: z.string().trim().min(2).max(60),
  jobTitle: z.string().trim().min(2).max(60),
});

@Controller()
export class AdminController {
  constructor(private readonly dbs: DbService, private readonly audit: AuditService, private readonly config: ConfigService) {}

  /** Staff list for assignment pickers (names and roles only). */
  @Requires('jobs.read') @Get('staff')
  async staff(@CurrentUser() u: AuthUser, @Query('role') role?: string) {
    let q = this.dbs.db.selectFrom('users as u').innerJoin('user_roles as ur', 'ur.user_id', 'u.id').innerJoin('roles as r', 'r.id', 'ur.role_id')
      .select(['u.id', 'u.full_name', 'r.code as role']).where('u.status', '=', 'ACTIVE').where('u.branch_id', '=', u.branchId).orderBy('u.full_name');
    if (role) q = q.where('r.code', '=', role);
    return q.execute();
  }

  @Requires('users.manage') @Get('users')
  async users() {
    const rows = await this.dbs.db.selectFrom('users as u').leftJoin('user_roles as ur', 'ur.user_id', 'u.id').leftJoin('roles as r', 'r.id', 'ur.role_id')
      .select(['u.id', 'u.email', 'u.full_name', 'u.status', 'u.created_at', 'r.code as role']).orderBy('u.full_name').execute();
    const map = new Map<string, any>();
    for (const r of rows) {
      if (!map.has(r.id)) map.set(r.id, { id: r.id, email: r.email, fullName: r.full_name, status: r.status, createdAt: r.created_at, roles: [] });
      if (r.role) map.get(r.id).roles.push(r.role);
    }
    return [...map.values()];
  }

  @Requires('users.manage') @Get('roles')
  roles() { return Object.entries(ROLES).map(([code, r]) => ({ code, name: r.name, permissions: r.permissions })); }

  @Requires('users.manage') @Post('users')
  async createUser(@Body() b: unknown, @CurrentUser() actor: AuthUser) {
    const input = NewUser.parse(b);
    AuthService.checkPasswordStrength(input.password);
    const hash = await AuthService.hashPassword(input.password);
    return this.dbs.tx(async (trx) => {
      const user = await trx.insertInto('users').values({
        email: input.email, full_name: input.fullName, phone: input.phone ?? null, password_hash: hash, branch_id: actor.branchId, created_by: actor.id,
      }).returning(['id', 'email', 'full_name']).executeTakeFirstOrThrow();
      const roleRows = await trx.selectFrom('roles').select(['id', 'code']).where('code', 'in', input.roles).execute();
      for (const r of roleRows) await trx.insertInto('user_roles').values({ user_id: user.id, role_id: r.id }).execute();
      await trx.insertInto('employees').values({
        staff_no: input.staffNo, user_id: user.id, full_name: input.fullName, department: input.department, job_title: input.jobTitle, branch_id: actor.branchId,
      }).execute();
      await this.audit.write(trx, { actorId: actor.id, action: 'user.create', entity: 'user', entityId: user.id, after: { ...user, roles: input.roles }, ip: actor.ip });
      return { ...user, roles: input.roles };
    });
  }

  @Requires('users.manage') @Put('users/:id/roles')
  async setRoles(@Param('id', ParseUUIDPipe) id: string, @Body() b: unknown, @CurrentUser() actor: AuthUser) {
    const { roles } = z.object({ roles: z.array(z.enum(Object.keys(ROLES) as [string, ...string[]])) }).parse(b);
    if (id === actor.id && !roles.includes('CEO')) throw forbidden('You cannot remove your own administrator role');
    return this.dbs.tx(async (trx) => {
      const before = (await trx.selectFrom('user_roles as ur').innerJoin('roles as r', 'r.id', 'ur.role_id').select('r.code').where('ur.user_id', '=', id).execute()).map((r) => r.code);
      await trx.deleteFrom('user_roles').where('user_id', '=', id).execute();
      const roleRows = roles.length ? await trx.selectFrom('roles').select('id').where('code', 'in', roles).execute() : [];
      for (const r of roleRows) await trx.insertInto('user_roles').values({ user_id: id, role_id: r.id }).execute();
      await trx.updateTable('sessions').set({ revoked_at: new Date() }).where('user_id', '=', id).where('revoked_at', 'is', null).execute();
      await this.audit.write(trx, { actorId: actor.id, action: 'user.roles_change', entity: 'user', entityId: id, before: { roles: before }, after: { roles }, ip: actor.ip });
      return { id, roles };
    });
  }

  @Requires('users.manage') @Post('users/:id/status')
  async setStatus(@Param('id', ParseUUIDPipe) id: string, @Body() b: unknown, @CurrentUser() actor: AuthUser) {
    const { status } = z.object({ status: z.enum(['ACTIVE', 'DISABLED']) }).parse(b);
    if (id === actor.id) throw forbidden('You cannot disable your own account');
    return this.dbs.tx(async (trx) => {
      const before = await trx.selectFrom('users').select('status').where('id', '=', id).executeTakeFirst();
      if (!before) throw notFound('User');
      await trx.updateTable('users').set({ status, updated_at: new Date() }).where('id', '=', id).execute();
      if (status === 'DISABLED') await trx.updateTable('sessions').set({ revoked_at: new Date() }).where('user_id', '=', id).where('revoked_at', 'is', null).execute();
      await this.audit.write(trx, { actorId: actor.id, action: 'user.status', entity: 'user', entityId: id, before, after: { status }, ip: actor.ip });
      return { id, status };
    });
  }

  @Requires('settings.manage', 'audit.read') @Get('settings')
  settings() { return this.config.all(); }

  @Requires('settings.manage') @Put('settings/:key')
  async setSetting(@Param('key') key: string, @Body() b: unknown, @CurrentUser() actor: AuthUser) {
    if (!(key in SETTING_DEFAULTS)) throw new DomainError('UNKNOWN_SETTING', `Unknown setting ${key}`, 404);
    const { value } = z.object({ value: z.any() }).parse(b);
    return this.dbs.tx(async (trx) => {
      const before = await trx.selectFrom('settings').select('value').where('key', '=', key).executeTakeFirst();
      await trx.insertInto('settings').values({ key, value: JSON.stringify(value) as any, description: SETTING_DEFAULTS[key].description, updated_by: actor.id })
        .onConflict((oc) => oc.column('key').doUpdateSet({ value: JSON.stringify(value) as any, updated_by: actor.id, updated_at: new Date() })).execute();
      await this.audit.write(trx, { actorId: actor.id, action: 'setting.change', entity: 'setting', entityId: key, before: before?.value ?? SETTING_DEFAULTS[key].value, after: value, ip: actor.ip });
      return { key, value };
    });
  }

  @Requires('settings.manage', 'audit.read') @Get('tax-configurations')
  taxes() { return this.dbs.db.selectFrom('tax_configurations').selectAll().orderBy('tax_code').orderBy('effective_from', 'desc').execute(); }

  /** A new rate starts on a date and closes the previous open-ended rate the day before. */
  @Requires('settings.manage') @Post('tax-configurations')
  async addTax(@Body() b: unknown, @CurrentUser() actor: AuthUser) {
    const input = z.object({ taxCode: z.string().trim().toUpperCase().regex(/^[A-Z_]{2,20}$/), name: z.string().trim().min(2), ratePercent: z.number().min(0).max(100), effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(b);
    return this.dbs.tx(async (trx) => {
      const prevDay = new Date(new Date(input.effectiveFrom + 'T00:00:00Z').getTime() - 86400000).toISOString().slice(0, 10);
      await trx.updateTable('tax_configurations').set({ effective_to: prevDay as any }).where('tax_code', '=', input.taxCode).where('effective_to', 'is', null)
        .where('effective_from', '<', input.effectiveFrom as any).execute();
      const row = await trx.insertInto('tax_configurations').values({
        tax_code: input.taxCode, name: input.name, rate_bp: Math.round(input.ratePercent * 100), effective_from: input.effectiveFrom as any, created_by: actor.id,
      }).returningAll().executeTakeFirstOrThrow();
      await this.audit.write(trx, { actorId: actor.id, action: 'tax.add_rate', entity: 'tax_configuration', entityId: row.id, after: row, ip: actor.ip });
      return row;
    });
  }

  @Requires('audit.read') @Get('audit')
  auditLog(@Query('entity') entity?: string, @Query('entityId') entityId?: string, @Query('limit') limit = '200') {
    return this.audit.list({ entity, entityId, limit: Math.min(Number(limit) || 200, 1000) });
  }

  @Requires('audit.read') @Get('audit/verify')
  verify() { return this.audit.verify(); }
}
