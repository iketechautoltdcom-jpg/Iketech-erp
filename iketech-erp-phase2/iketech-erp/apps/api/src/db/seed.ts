/**
 * Seeds configuration only — never business data:
 * branch, roles and permissions, chart of accounts, tax codes, approval limits, QC templates, and the first CEO account.
 * Safe to run repeatedly (idempotent). Usage:
 *   ADMIN_EMAIL=... ADMIN_PASSWORD=... ADMIN_NAME="..." npm run db:seed
 */
import './env';
import { createDb, Db } from './db';
import { PERMISSIONS, ROLES } from '../auth/rbac';
import { ACCOUNTS } from '../modules/billing/ledger.service';
import { AuthService } from '../auth/auth.service';

/**
 * Starter QC templates (Blueprint §12 decision 7). The Operations Manager should review and version them.
 * Safety-critical categories require an independent inspector and a road test.
 */
export const QC_TEMPLATES: Array<{ category: string; independent: boolean; roadTest: boolean; postScan: boolean; items: [string, string][] }> = [
  { category: 'GENERAL', independent: false, roadTest: false, postScan: false, items: [
    ['work_matches_approval', 'Work done matches the approved quotation lines'],
    ['no_leaks', 'No fluid leaks at areas worked on'],
    ['fasteners', 'Fasteners and clamps at worked areas secured'],
    ['no_new_warnings', 'No new warning lights on the dashboard'],
    ['clean', 'Vehicle interior and exterior left clean; protective covers removed'],
    ['old_parts', 'Replaced parts tagged and kept for the customer unless they declined'],
  ] },
  { category: 'SERVICE', independent: false, roadTest: false, postScan: false, items: [
    ['work_matches_approval', 'Work done matches the approved quotation lines'],
    ['fluid_levels', 'Engine oil, coolant, brake and washer fluid at correct levels'],
    ['filters', 'Filters replaced as quoted and housings sealed'],
    ['no_leaks', 'No leaks after engine run'],
    ['service_reset', 'Service indicator reset and next-service sticker fitted'],
    ['clean', 'Vehicle left clean; protective covers removed'],
  ] },
  { category: 'BRAKES', independent: true, roadTest: true, postScan: false, items: [
    ['work_matches_approval', 'Work done matches the approved quotation lines'],
    ['torque', 'Caliper and wheel fasteners torqued to specification'],
    ['fluid', 'Brake fluid level correct and system bled; no air in the pedal'],
    ['pedal', 'Pedal height and feel correct; parking brake holds'],
    ['no_leaks', 'No leaks at lines, hoses or calipers'],
    ['abs', 'ABS warning light off'],
  ] },
  { category: 'STEERING_SUSPENSION', independent: true, roadTest: true, postScan: false, items: [
    ['work_matches_approval', 'Work done matches the approved quotation lines'],
    ['torque', 'Suspension and steering fasteners torqued to specification'],
    ['play', 'No free play in steering or worked joints'],
    ['alignment', 'Alignment checked or customer advised if not quoted'],
    ['noise', 'No knocks or noises over bumps on road test'],
  ] },
  { category: 'ENGINE', independent: true, roadTest: true, postScan: true, items: [
    ['work_matches_approval', 'Work done matches the approved quotation lines'],
    ['start_idle', 'Engine starts and idles smoothly'],
    ['no_leaks', 'No oil, coolant or fuel leaks after warm-up'],
    ['temperature', 'Operating temperature normal; fan operates'],
    ['no_dtc', 'No stored or pending fault codes after repair'],
  ] },
  { category: 'TRANSMISSION', independent: true, roadTest: true, postScan: true, items: [
    ['work_matches_approval', 'Work done matches the approved quotation lines'],
    ['fluid', 'Transmission fluid at correct level and grade'],
    ['shifts', 'All gears engage; shifts smooth without slip or flare'],
    ['no_leaks', 'No leaks at pan, seals or lines'],
    ['no_dtc', 'No transmission fault codes after repair'],
  ] },
  { category: 'ELECTRICAL_SAFETY', independent: true, roadTest: true, postScan: true, items: [
    ['work_matches_approval', 'Work done matches the approved quotation lines'],
    ['circuit_protected', 'Repaired circuits protected with correct fuse rating'],
    ['wiring_secured', 'Wiring routed, insulated and secured away from heat and moving parts'],
    ['systems_function', 'Airbag, ABS, lighting and other affected safety systems function'],
    ['no_dtc', 'No stored or pending fault codes after repair'],
  ] },
  { category: 'ELECTRICAL', independent: false, roadTest: false, postScan: true, items: [
    ['work_matches_approval', 'Work done matches the approved quotation lines'],
    ['circuit_protected', 'Repaired circuits protected with correct fuse rating'],
    ['wiring_secured', 'Wiring routed, insulated and secured'],
    ['function', 'Repaired system operates as specified'],
    ['charging', 'Battery and charging voltage within specification'],
  ] },
];

export async function seed(db: Db, opts: { adminEmail?: string; adminPassword?: string; adminName?: string; branchCode?: string; branchName?: string } = {}) {
  const branchCode = opts.branchCode ?? 'PH';
  await db.insertInto('branches').values({ code: branchCode, name: opts.branchName ?? 'IKETECH AUTO LTD — Port Harcourt HQ', address: 'Port Harcourt, Rivers State, Nigeria' })
    .onConflict((oc) => oc.column('code').doNothing()).execute();
  const branch = await db.selectFrom('branches').select('id').where('code', '=', branchCode).executeTakeFirstOrThrow();

  for (const [code, name] of Object.entries(PERMISSIONS)) {
    await db.insertInto('permissions').values({ code, name }).onConflict((oc) => oc.column('code').doUpdateSet({ name })).execute();
  }
  const perms = new Map((await db.selectFrom('permissions').select(['id', 'code']).execute()).map((p) => [p.code, p.id]));
  for (const [code, role] of Object.entries(ROLES)) {
    await db.insertInto('roles').values({ code, name: role.name }).onConflict((oc) => oc.column('code').doUpdateSet({ name: role.name })).execute();
    const r = await db.selectFrom('roles').select('id').where('code', '=', code).executeTakeFirstOrThrow();
    for (const p of role.permissions) {
      await db.insertInto('role_permissions').values({ role_id: r.id, permission_id: perms.get(p)! }).onConflict((oc) => oc.doNothing()).execute();
    }
  }

  for (const a of Object.values(ACCOUNTS)) {
    await db.insertInto('accounts').values({ code: a.code, name: a.name, type: a.type as any }).onConflict((oc) => oc.column('code').doNothing()).execute();
  }

  // Tax codes are configuration data. The standard VAT rate below reflects Nigerian VAT at 7.5% since 1 Feb 2020;
  // `tax.confirmed_by_adviser` stays false until a qualified tax professional confirms the setup for IKETECH.
  const taxes: [string, string, number][] = [['VAT_STANDARD', 'VAT — standard rate', 750], ['VAT_EXEMPT', 'VAT exempt', 0], ['VAT_ZERO', 'VAT zero-rated', 0]];
  for (const [code, name, bp] of taxes) {
    const exists = await db.selectFrom('tax_configurations').select('id').where('tax_code', '=', code).executeTakeFirst();
    if (!exists) await db.insertInto('tax_configurations').values({ tax_code: code, name, rate_bp: bp, effective_from: '2020-02-01' as any }).execute();
  }

  const limits: [string, string, number][] = [
    ['SERVICE_ADVISOR', 'DISCOUNT_PERCENT_BP', 0], ['OPS_MANAGER', 'DISCOUNT_PERCENT_BP', 1000], ['CEO', 'DISCOUNT_PERCENT_BP', 10000],
  ];
  for (const [role, action, max] of limits) {
    await db.insertInto('approval_limits').values({ role_code: role, action, max_value: max }).onConflict((oc) => oc.columns(['role_code', 'action']).doNothing()).execute();
  }

  for (const t of QC_TEMPLATES) {
    const exists = await db.selectFrom('qc_templates').select('id').where('repair_category', '=', t.category).executeTakeFirst();
    if (exists) continue;
    const tpl = await db.insertInto('qc_templates').values({
      repair_category: t.category, requires_independent: t.independent, requires_road_test: t.roadTest, requires_post_scan: t.postScan,
    }).returning('id').executeTakeFirstOrThrow();
    let sort = 0;
    for (const [code, text] of t.items) await db.insertInto('qc_template_items').values({ template_id: tpl.id, code, text, sort: sort++ }).execute();
  }

  if (opts.adminEmail && opts.adminPassword) {
    const email = opts.adminEmail.toLowerCase();
    const existing = await db.selectFrom('users').select('id').where('email', '=', email).executeTakeFirst();
    if (!existing) {
      AuthService.checkPasswordStrength(opts.adminPassword);
      const u = await db.insertInto('users').values({
        email, full_name: opts.adminName ?? 'Administrator', password_hash: await AuthService.hashPassword(opts.adminPassword), branch_id: branch.id,
      }).returning('id').executeTakeFirstOrThrow();
      const ceo = await db.selectFrom('roles').select('id').where('code', '=', 'CEO').executeTakeFirstOrThrow();
      await db.insertInto('user_roles').values({ user_id: u.id, role_id: ceo.id }).execute();
      await db.insertInto('audit_logs').values({ actor_id: null, action: 'user.bootstrap_admin', entity: 'user', entity_id: u.id, after: JSON.stringify({ email }) as any, prev_hash: '', hash: '' }).execute();
    }
  }
  return { branchId: branch.id };
}

if (require.main === module) {
  const db = createDb(process.env.DATABASE_URL!);
  seed(db, { adminEmail: process.env.ADMIN_EMAIL, adminPassword: process.env.ADMIN_PASSWORD, adminName: process.env.ADMIN_NAME })
    .then(() => { console.log('Seed complete'); if (!process.env.ADMIN_EMAIL) console.log('No ADMIN_EMAIL given: no admin user created.'); })
    .catch((e) => { console.error(e.message); process.exitCode = 1; })
    .finally(() => db.destroy());
}
