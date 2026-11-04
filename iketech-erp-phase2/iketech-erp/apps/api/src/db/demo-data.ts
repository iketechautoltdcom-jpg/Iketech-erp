/**
 * DEMO DATA — for development and staging only. Never run against production.
 * Creates clearly labelled demo staff (example.test emails), demo customers ("DEMO" in the name, +234 900 test numbers)
 * and drives jobs through the real API so every gate, ledger entry and audit row is produced the normal way.
 *
 * Usage (API running, admin seeded): API_URL=http://localhost:4000 ADMIN_EMAIL=... ADMIN_PASSWORD=... npm run db:demo
 */
import './env';

if (process.env.NODE_ENV === 'production') { console.error('Refusing to load demo data in production.'); process.exit(1); }

const API = (process.env.API_URL || 'http://localhost:4000') + '/api/v1';
const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'DemoPassword2026';

class Session {
  cookie = '';
  constructor(public label: string) {}
  async req(method: string, path: string, body?: unknown): Promise<any> {
    const res = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'iketech-erp', Cookie: this.cookie }, body: body ? JSON.stringify(body) : undefined });
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0];
    const data: any = res.status === 204 ? null : await res.json();
    if (!res.ok) throw new Error(`${this.label} ${method} ${path} → ${res.status} ${JSON.stringify(data)}`);
    return data;
  }
  login(email: string, password: string) { return this.req('POST', '/auth/login', { email, password }); }
  get(p: string) { return this.req('GET', p); }
  post(p: string, b: unknown = {}) { return this.req('POST', p, b); }
  put(p: string, b: unknown = {}) { return this.req('PUT', p, b); }
  patch(p: string, b: unknown = {}) { return this.req('PATCH', p, b); }
}

const STAFF: [string, string, string, string][] = [
  ['advisor', 'Demo Service Advisor', 'SERVICE_ADVISOR', 'Service Advisor'],
  ['ops', 'Demo Operations Manager', 'OPS_MANAGER', 'Operations Manager'],
  ['diag', 'Demo Diagnostic Technician', 'DIAG_TECH', 'Diagnostic Technician'],
  ['tech', 'Demo Repair Technician', 'REPAIR_TECH', 'Repair Technician'],
  ['qc', 'Demo QC Inspector', 'QC_INSPECTOR', 'QC Inspector'],
  ['finance', 'Demo Accountant', 'ACCOUNTANT', 'Accountant'],
];

async function main() {
  const admin = new Session('admin');
  await admin.login(process.env.ADMIN_EMAIL!, process.env.ADMIN_PASSWORD!);
  const existing: any[] = await admin.get('/users');
  const s: Record<string, Session> = {};
  let n = 0;
  for (const [key, name, role, title] of STAFF) {
    const email = `demo.${key}@example.test`;
    if (!existing.some((u) => u.email === email)) {
      await admin.post('/users', { email, fullName: name, password: DEMO_PASSWORD, roles: [role], staffNo: `DEMO-${++n}`, department: role === 'ACCOUNTANT' ? 'Finance' : 'Workshop', jobTitle: title });
    }
    s[key] = new Session(key);
    await s[key].login(email, DEMO_PASSWORD);
  }
  const me = async (k: string) => (await s[k].get('/auth/me')).id;
  const diagId = await me('diag');

  async function customer(name: string, phone: string, plate: string, car: [string, string, number], type = 'INDIVIDUAL', company?: string) {
    const found: any[] = await s.advisor.get(`/customers?q=${encodeURIComponent(phone.slice(-9))}`);
    const c = found[0] ?? await s.advisor.post('/customers', { type, name, companyName: company, phone, confirmNotDuplicate: true });
    const full = await s.advisor.get(`/customers/${c.id}`);
    const v = full.vehicles.find((x: any) => x.plate_no === plate) ?? await s.advisor.post(`/customers/${c.id}/vehicles`, { plateNo: plate, make: car[0], model: car[1], year: car[2] });
    return { c, v };
  }
  async function receive(c: any, v: any, complaint: string, mileage: number, lights: string[] = []) {
    return s.advisor.post('/reception', { customerId: c.id, vehicleId: v.id, customerComplaint: complaint, inspection: { mileageIn: mileage, fuelLevel: '1/2', warningLights: lights, accessories: ['Spare tyre', 'Jack and wheel spanner'], customerAck: { method: 'SIGNATURE', name: c.name } } });
  }
  async function diagnose(jobId: string, category: string, dtc: string | null, test: string, cause: string, repair: string) {
    await s.ops.post(`/jobs/${jobId}/assign`, { diagTechnicianId: diagId, repairCategory: category });
    await s.advisor.post(`/jobs/${jobId}/start-diagnosis`);
    const r = await s.diag.post(`/jobs/${jobId}/diagnostic-report`);
    let supports: string | undefined;
    if (dtc) supports = (await s.diag.post(`/diagnostic-reports/${r.id}/findings`, { kind: 'DTC', code: dtc, isRootCause: false })).id;
    await s.diag.post(`/diagnostic-reports/${r.id}/findings`, { kind: 'TEST', value: test, supportsId: supports, isRootCause: true });
    await s.diag.put(`/diagnostic-reports/${r.id}`, { complaintVerified: true, toolsUsed: 'Scan tool, multimeter', rootCause: cause, recommendedRepair: repair });
    await s.diag.post(`/diagnostic-reports/${r.id}/submit`);
  }
  async function quote(jobId: string, items: any[], send = true) {
    const q = await s.advisor.post(`/jobs/${jobId}/quotations`, { items });
    if (send) await s.advisor.post(`/quotations/${q.id}/send`, { channel: 'WHATSAPP' });
    return q;
  }
  const approve = (q: any, name: string, phone: string) => s.advisor.post(`/quotations/${q.id}/decision`, { approvedItemIds: q.items.map((i: any) => i.id), channel: 'PHONE', approverName: name, approverContact: phone, evidenceNote: 'DEMO: approved by phone' });
  async function repairAndQc(jobId: string) {
    await s.advisor.post(`/jobs/${jobId}/start-repair`);
    const job = await s.advisor.get(`/jobs/${jobId}`);
    for (const t of job.tasks) {
      await s.tech.post(`/tasks/${t.id}/start`);
      await s.tech.post(`/tasks/${t.id}/complete`, { notes: 'DEMO: work completed and verified', labourMinutes: 75, checklist: [{ item: 'Torque to specification', required: true, done: true }] });
    }
    await s.tech.post(`/jobs/${jobId}/submit-qc`);
    const tpl = await s.qc.get(`/jobs/${jobId}/qc-template`);
    await s.qc.post(`/jobs/${jobId}/qc`, { results: tpl.items.map((i: any) => ({ code: i.code, passed: true })), roadTestDone: true, postScanClear: true, complaintResolved: true });
  }

  // 1. Just received
  const a = await customer('DEMO Adaeze Nwosu', '+2349000000101', 'DEMO101AA', ['Toyota', 'Corolla', 2014]);
  await receive(a.c, a.v, 'Air conditioning blows warm air after 10 minutes of driving', 143200);

  // 2. Awaiting approval
  const b = await customer('DEMO Tunde Bakare', '+2349000000102', 'DEMO102BB', ['Lexus', 'RX350', 2012]);
  const jb = await receive(b.c, b.v, 'Engine shakes at idle, check-engine light on', 188400, ['Check engine']);
  await diagnose(jb.id, 'ENGINE', 'P0303', 'Swapped coil 3 with coil 1; misfire moved to cylinder 1', 'Failed ignition coil, cylinder 3', 'Replace ignition coil 3 and spark plugs');
  await quote(jb.id, [
    { kind: 'LABOUR', description: 'Replace ignition coil and plugs, clear codes, verify', qty: 1.5, unitPrice: 12000 },
    { kind: 'PART', description: 'Ignition coil (OEM)', qty: 1, unitPrice: 58000 },
    { kind: 'PART', description: 'Iridium spark plugs', qty: 6, unitPrice: 6500 },
  ]);

  // 3. In repair
  const c = await customer('DEMO Ifeoma Eze', '+2349000000103', 'DEMO103CC', ['Honda', 'Accord', 2016]);
  const jc = await receive(c.c, c.v, 'Grinding noise when braking', 97500, ['Brake']);
  await diagnose(jc.id, 'BRAKES', null, 'Front pads measured 1.5 mm; discs scored beyond minimum thickness', 'Front pads worn to backing plate, discs damaged', 'Replace front pads and discs, flush brake fluid');
  const qc = await quote(jc.id, [{ kind: 'LABOUR', description: 'Replace front pads and discs, bleed brakes', qty: 2, unitPrice: 10000 }, { kind: 'PART', description: 'Front brake discs (pair)', qty: 1, unitPrice: 85000 }, { kind: 'PART', description: 'Front brake pads', qty: 1, unitPrice: 32000 }]);
  await approve(qc, c.c.name, '+2349000000103');
  await s.advisor.post(`/jobs/${jc.id}/start-repair`);

  // 4. Invoiced, part-paid by cash, transfer pending confirmation
  const d = await customer('DEMO Musa Ibrahim', '+2349000000104', 'DEMO104DD', ['Toyota', 'Hilux', 2019]);
  const jd = await receive(d.c, d.v, 'Battery light comes on while driving', 64300, ['Battery / charging']);
  await diagnose(jd.id, 'ELECTRICAL', 'P0562', 'Charging voltage 12.1 V at 2000 rpm; alternator output test failed', 'Alternator not charging', 'Replace alternator and test charging system');
  const qd = await quote(jd.id, [{ kind: 'LABOUR', description: 'Replace alternator, test charging', qty: 1, unitPrice: 15000 }, { kind: 'PART', description: 'Alternator (remanufactured, 6-month warranty)', qty: 1, unitPrice: 145000 }]);
  await approve(qd, d.c.name, '+2349000000104');
  await repairAndQc(jd.id);
  const invD = await s.advisor.post(`/jobs/${jd.id}/invoice`);
  await s.advisor.post('/payments', { customerId: d.c.id, invoiceId: invD.id, amount: 80000, method: 'CASH' });
  await s.advisor.post('/payments', { customerId: d.c.id, invoiceId: invD.id, amount: 92000, method: 'BANK_TRANSFER', reference: `DEMO-TRF-${Date.now()}` });

  // 5. Paid and ready for collection
  const e = await customer('DEMO Grace Okon', '+2349000000105', 'DEMO105EE', ['Kia', 'Sorento', 2017]);
  const je = await receive(e.c, e.v, 'Due for routine service', 72000);
  await diagnose(je.id, 'SERVICE', null, 'Oil condition dark, filter due by mileage', 'Scheduled service due', 'Oil and filter service with inspection');
  const qe = await quote(je.id, [{ kind: 'LABOUR', description: 'Oil and filter service, 30-point inspection', qty: 1, unitPrice: 15000 }, { kind: 'PART', description: 'Synthetic engine oil 5W-30 (5 L)', qty: 1, unitPrice: 38000 }, { kind: 'PART', description: 'Oil filter', qty: 1, unitPrice: 6000 }]);
  await approve(qe, e.c.name, '+2349000000105');
  await repairAndQc(je.id);
  const invE = await s.advisor.post(`/jobs/${je.id}/invoice`);
  await s.finance.post('/payments', { customerId: e.c.id, invoiceId: invE.id, amount: invE.total / 100, method: 'POS', reference: `DEMO-POS-${Date.now()}` });
  const pending: any[] = await s.advisor.get('/payments?status=PENDING');
  const pos = pending.find((p) => p.reference?.startsWith('DEMO-POS'));
  if (pos) await admin.post(`/payments/${pos.id}/clear`); // confirmed by someone other than the recorder

  // 6. A pending exception for the approvals queue
  const f = await customer('DEMO Rivers Haulage Ltd contact', '+2349000000106', 'DEMO106FF', ['Mercedes-Benz', 'Actros', 2015], 'CORPORATE', 'DEMO Rivers Haulage Ltd');
  const jf = await receive(f.c, f.v, 'Truck will not start; customer needs it back for a delivery tomorrow', 412000);
  await s.advisor.post(`/jobs/${jf.id}/exceptions`, { kind: 'START_REPAIR_WITHOUT_APPROVAL', reason: 'DEMO: fleet manager approved by phone; written PO to follow in the morning' });

  console.log('Demo data loaded. Staff logins: demo.<advisor|ops|diag|tech|qc|finance>@example.test');
}

main().catch((e) => { console.error(e.message); process.exit(1); });
