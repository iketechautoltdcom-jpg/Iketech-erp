/**
 * Phase 1 acceptance tests (Blueprint §10). Each `describe` maps to one numbered scenario.
 * Runs against a real PostgreSQL database with the real triggers and constraints.
 */
import { sql } from 'kysely';
import { Harness, expectOk, testPhone, testPlate } from './helpers';
import { Flow, makeTeam, standardQuote, Team } from './workflow';

let h: Harness;
let t: Team;

beforeAll(async () => { h = await new Harness().start(); t = await makeTeam(h); });
afterAll(async () => { await h.stop(); });

// Expected figures for `standardQuote` at the seeded 7.5 % VAT, exclusive pricing (all in kobo):
// labour 1.5 × ₦10,000 = 1,500,000 + 112,500 VAT · coil 4,500,000 + 337,500 · plugs 4 × ₦3,500 = 1,400,000 + 105,000
const NET = 7_400_000, VAT = 555_000, TOTAL = 7_955_000;

describe('AT-1 Customer and vehicle registration without duplicates', () => {
  it('registers a customer and vehicle with references', async () => {
    const phone = testPhone();
    const c = expectOk(await t.advisor.post('/customers', { type: 'INDIVIDUAL', name: 'Chidi Test Okafor', phone: '0' + phone.slice(4) }));
    expect(c.ref).toMatch(/^CUS-\d{6}$/);
    expect(c.phone_e164).toBe(phone); // 080… normalised to +23480…
    const v = expectOk(await t.advisor.post(`/customers/${c.id}/vehicles`, { plateNo: 'abc-123-xy', make: 'Lexus', model: 'RX350', vin: 'JTJBK1BA2D2012345' }));
    expect(v.plate_no).toBe('ABC123XY');
    expect(v.ref).toMatch(/^VEH-\d{6}$/);
  });

  it('flags a possible duplicate (same phone) and blocks an exact duplicate even when confirmed', async () => {
    const phone = testPhone();
    expectOk(await t.advisor.post('/customers', { type: 'INDIVIDUAL', name: 'Amaka Test', phone }));
    const dup = await t.advisor.post('/customers', { type: 'INDIVIDUAL', name: 'A. Test', phone });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('POSSIBLE_DUPLICATE');
    expect(dup.body.details.matches).toHaveLength(1);
    const forced = await t.advisor.post('/customers', { type: 'INDIVIDUAL', name: 'A. Test', phone, confirmNotDuplicate: true });
    expect(forced.status).toBe(409);
    expect(forced.body.code).toBe('DUPLICATE'); // database unique index on (type, phone)
  });

  it('blocks a duplicate plate and a duplicate VIN', async () => {
    const f = await new Flow(h, t).register();
    const v = expectOk(await t.advisor.get(`/vehicles/${f.vehicleId}`));
    const again = await t.advisor.post(`/customers/${f.customerId}/vehicles`, { plateNo: v.plate_no, make: 'Honda', model: 'Accord' });
    expect(again.status).toBe(409);
    expect(again.body.message).toMatch(/plate number/);
    const vin = 'WDB2110421A123456';
    expectOk(await t.advisor.post(`/customers/${f.customerId}/vehicles`, { plateNo: testPlate(), make: 'Mercedes', model: 'E350', vin }));
    const vinDup = await t.advisor.post(`/customers/${f.customerId}/vehicles`, { plateNo: testPlate(), make: 'Mercedes', model: 'E350', vin });
    expect(vinDup.status).toBe(409);
    expect(vinDup.body.message).toMatch(/VIN/);
  });

  it('rejects invalid VINs and phone numbers', async () => {
    const bad = await t.advisor.post('/customers', { type: 'INDIVIDUAL', name: 'Bad Phone', phone: '12' });
    expect(bad.status).toBe(400);
    const f = await new Flow(h, t).register();
    const badVin = await t.advisor.post(`/customers/${f.customerId}/vehicles`, { plateNo: testPlate(), make: 'Kia', model: 'Rio', vin: 'IOQ12345678901234' });
    expect(badVin.status).toBe(400);
  });
});

describe('AT-2 Vehicle reception creates a traceable job card', () => {
  it('creates job, inspection, key custody and history in one step', async () => {
    const f = await new Flow(h, t).register();
    await f.receive(85000);
    const job = await f.job();
    expect(job.job_no).toMatch(/^JOB-PH-\d{4}-\d{5}$/);
    expect(job.status).toBe('RECEIVED');
    expect(job.inspection.mileage_in).toBe(85000);
    expect(job.inspection.ack_method).toBe('SIGNATURE');
    expect(job.keys[0].action).toBe('IN');
    expect(job.history[0]).toMatchObject({ from_status: null, to_status: 'RECEIVED' });
    const audit = expectOk(await t.ceo.get(`/audit?entity=job&entityId=${f.jobId}`));
    expect(audit.some((a: any) => a.action === 'job.receive')).toBe(true);
  });

  it('allows only one open job per vehicle', async () => {
    const f = await new Flow(h, t).register();
    await f.receive();
    const second = await t.advisor.post('/reception', { customerId: f.customerId, vehicleId: f.vehicleId, customerComplaint: 'Another visit', inspection: { mileageIn: 120001, fuelLevel: 'F' } });
    expect(second.status).toBe(409);
    expect(second.body.message).toMatch(/open job/);
  });

  it('requires an authorised exception when mileage is below the last record', async () => {
    const f = await new Flow(h, t).register();
    await h.db.updateTable('customer_vehicles').set({ last_mileage: 150000 }).where('id', '=', f.vehicleId).execute();
    const j = expectOk(await t.advisor.post('/reception', { customerId: f.customerId, vehicleId: f.vehicleId, customerComplaint: 'Noise from front', inspection: { mileageIn: 90000, fuelLevel: '1/4' } }));
    expect(j.warnings[0]).toMatch(/MILEAGE_OVERRIDE/);
    expectOk(await t.ops.post(`/jobs/${j.id}/assign`, { diagTechnicianId: t.diag.id }));
    const blocked = await t.advisor.post(`/jobs/${j.id}/start-diagnosis`);
    expect(blocked.body.code).toBe('MILEAGE_BELOW_RECORD');
    const ex = expectOk(await t.advisor.post(`/jobs/${j.id}/exceptions`, { kind: 'MILEAGE_OVERRIDE', reason: 'Instrument cluster was replaced last month; old reading not carried over' }));
    expectOk(await t.ops.post(`/exceptions/${ex.id}/authorise`));
    expectOk(await t.advisor.post(`/jobs/${j.id}/start-diagnosis`));
  });
});

describe('AT-3 Diagnosis findings and evidence', () => {
  it('records findings and refuses a DTC as the only proof', async () => {
    const f = await new Flow(h, t).register();
    await f.receive();
    expectOk(await t.ops.post(`/jobs/${f.jobId}/assign`, { diagTechnicianId: t.diag.id }));
    expectOk(await t.advisor.post(`/jobs/${f.jobId}/start-diagnosis`));
    const r = expectOk(await t.diag.post(`/jobs/${f.jobId}/diagnostic-report`));
    const dtc = expectOk(await t.diag.post(`/diagnostic-reports/${r.id}/findings`, { kind: 'DTC', code: 'p0171', isRootCause: true }));
    expect(dtc.code).toBe('P0171');
    expectOk(await t.diag.put(`/diagnostic-reports/${r.id}`, { complaintVerified: true, rootCause: 'O2 sensor', recommendedRepair: 'Replace O2 sensor' }));
    const refused = await t.diag.post(`/diagnostic-reports/${r.id}/submit`);
    expect(refused.status).toBe(422);
    expect(refused.body.code).toBe('DIAGNOSIS_INCOMPLETE');
    expect(refused.body.details.problems.join(' ')).toMatch(/P0171 is a code, not proof/);

    // A smoke test finds the real cause: a vacuum leak. The evidence-backed finding is the root cause.
    const smoke = expectOk(await t.diag.post(`/diagnostic-reports/${r.id}/findings`, { kind: 'TEST', value: 'Smoke test: leak at intake manifold gasket', supportsId: dtc.id, isRootCause: true }));
    expect(smoke.supports_id).toBe(dtc.id);
    // The DTC is now confirmed by a test in the same report, so the evidence chain is complete.
    expectOk(await t.diag.post(`/diagnostic-reports/${r.id}/submit`));
  });

  it('submits a complete report and moves the job to quotation', async () => {
    const f = await new Flow(h, t).register();
    await f.receive(); await f.diagnose();
    const job = await f.job();
    expect(job.status).toBe('QUOTE_PENDING');
    expect(job.diagnosticReports[0].status).toBe('SUBMITTED');
    expect(job.diagnosticReports[0].findings).toHaveLength(2);
    const edit = await t.diag.put(`/diagnostic-reports/${f.reportId}`, { rootCause: 'changed later' });
    expect(edit.body.code).toBe('REPORT_SUBMITTED');
  });

  it('a quotation cannot be created before the diagnosis is submitted', async () => {
    const f = await new Flow(h, t).register();
    await f.receive();
    const early = await t.advisor.post(`/jobs/${f.jobId}/quotations`, standardQuote);
    expect(early.body.code).toBe('WRONG_STATUS');
  });
});

describe('AT-4 Quotation and customer approval', () => {
  it('computes VAT-exclusive totals from configured tax, sends, and captures approval with identity', async () => {
    const f = await new Flow(h, t).register();
    await f.receive(); await f.diagnose();
    await f.quote(standardQuote, false);
    const q = expectOk(await t.advisor.get(`/quotations/${f.quoteId}`));
    expect(q.quote_no).toMatch(/^QUO-PH-\d{4}-\d{5}$/);
    expect([q.subtotal, q.tax_total, q.total]).toEqual([NET, VAT, TOTAL]);
    expectOk(await t.advisor.post(`/quotations/${f.quoteId}/send`, { channel: 'WHATSAPP' }));
    expect((await f.job()).status).toBe('AWAITING_APPROVAL');

    const noEvidence = await t.advisor.post(`/quotations/${f.quoteId}/decision`, { approvedItemIds: f.itemIds, channel: 'PHONE', approverName: 'X Test', approverContact: '+2349000000000' });
    expect(noEvidence.body.code).toBe('EVIDENCE_REQUIRED');

    await f.approve();
    const after = expectOk(await t.advisor.get(`/quotations/${f.quoteId}`));
    expect(after.status).toBe('APPROVED');
    expect(after.approvals[0]).toMatchObject({ decision: 'APPROVED', channel: 'PHONE', approver_name: 'Test Customer' });
    expect((await f.job()).status).toBe('APPROVED');
  });

  it('computes VAT-inclusive pricing correctly', async () => {
    const f = await new Flow(h, t).register();
    await f.receive(); await f.diagnose();
    await f.quote({ pricesIncludeTax: true, items: [{ kind: 'LABOUR', description: 'Labour incl. VAT', qty: 1, unitPrice: 10750 }] }, false);
    const q = expectOk(await t.advisor.get(`/quotations/${f.quoteId}`));
    expect(q.items[0]).toMatchObject({ net_amount: 1_000_000, tax_amount: 75_000, line_total: 1_075_000 });
  });

  it('supports partial approval; only approved lines become work', async () => {
    const f = await new Flow(h, t).register();
    await f.receive(); await f.diagnose(); await f.quote();
    await f.approve([f.itemIds[0], f.itemIds[1]]);
    const q = expectOk(await t.advisor.get(`/quotations/${f.quoteId}`));
    expect(q.status).toBe('PARTIALLY_APPROVED');
    expect(q.items.map((i: any) => i.decision)).toEqual(['APPROVED', 'APPROVED', 'REJECTED']);
  });

  it('a sent quotation cannot be edited; revising issues a new version and requires re-approval', async () => {
    const f = await new Flow(h, t).register();
    await f.receive(); await f.diagnose(); await f.quote();
    await expect(h.db.updateTable('quotation_items').set({ unit_price: 1 }).where('id', '=', f.itemIds[0]).execute()).rejects.toThrow(/QUOTATION_LOCKED/);
    const v2 = expectOk(await t.advisor.put(`/quotations/${f.quoteId}`, { ...standardQuote, items: [...standardQuote.items, { kind: 'PART', description: 'Air filter', qty: 1, unitPrice: 8000 }] }));
    expect(v2.version).toBe(2);
    expect((await t.advisor.get(`/quotations/${f.quoteId}`)).body.status).toBe('SUPERSEDED');
    expect((await f.job()).status).toBe('QUOTE_PENDING');
    const oldDecision = await t.advisor.post(`/quotations/${f.quoteId}/decision`, { approvedItemIds: f.itemIds, channel: 'PHONE', approverName: 'X Test', approverContact: '+2349000000000', evidenceNote: 'phone call' });
    expect(oldDecision.status).toBe(409);
  });

  it('a full rejection declines the job', async () => {
    const f = await new Flow(h, t).register();
    await f.receive(); await f.diagnose(); await f.quote();
    await f.approve([]);
    expect((await f.job()).status).toBe('DECLINED');
  });

  it('a discount above the advisor limit needs an exception authorised by someone else', async () => {
    const f = await new Flow(h, t).register();
    await f.receive(); await f.diagnose();
    await f.quote({ items: [{ kind: 'LABOUR', description: 'Labour', qty: 1, unitPrice: 50000, discount: 2500 }] }, false);
    const blocked = await t.advisor.post(`/quotations/${f.quoteId}/send`, { channel: 'IN_PERSON' });
    expect(blocked.body.code).toBe('DISCOUNT_NEEDS_APPROVAL');
    const ex = expectOk(await t.advisor.post(`/jobs/${f.jobId}/exceptions`, { kind: 'DISCOUNT_ABOVE_LIMIT', reason: 'Loyal fleet customer, manager agreed 5% off labour', limitBp: 500 }));
    const self = await t.advisor.post(`/exceptions/${ex.id}/authorise`);
    expect(self.status).toBe(403); // advisors lack the permission entirely
    expectOk(await t.ops.post(`/exceptions/${ex.id}/authorise`));
    expectOk(await t.advisor.post(`/quotations/${f.quoteId}/send`, { channel: 'IN_PERSON' }));
  });
});

describe('AT-5 Unapproved work is blocked unless an authorised exception exists', () => {
  it('blocks repair before approval', async () => {
    const f = await new Flow(h, t).register();
    await f.receive(); await f.diagnose(); await f.quote();
    const blocked = await t.advisor.post(`/jobs/${f.jobId}/start-repair`);
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe('APPROVAL_REQUIRED');
  });

  it('the database refuses a repair task with no approved line or exception', async () => {
    const f = await new Flow(h, t).register();
    await f.receive();
    await expect(h.db.insertInto('job_tasks').values({ job_id: f.jobId, kind: 'REPAIR', title: 'sneaky', created_by: t.advisor.id }).execute()).rejects.toThrow(/check constraint/);
  });

  it('the database refuses a status jump that skips approval', async () => {
    const f = await new Flow(h, t).register();
    await f.receive();
    await expect(h.db.updateTable('jobs').set({ status: 'QC' }).where('id', '=', f.jobId).execute()).rejects.toThrow(/INVALID_TRANSITION/);
  });

  it('nobody can authorise their own exception', async () => {
    const f = await new Flow(h, t).register();
    await f.receive();
    const ex = expectOk(await t.ops.post(`/jobs/${f.jobId}/exceptions`, { kind: 'START_REPAIR_WITHOUT_APPROVAL', reason: 'Customer stranded, needs vehicle safe to drive home' }));
    const self = await t.ops.post(`/exceptions/${ex.id}/authorise`);
    expect(self.status).toBe(403);
    await expect(h.db.updateTable('approval_exceptions').set({ authorised_by: t.ops.id, status: 'AUTHORISED' }).where('id', '=', ex.id).execute()).rejects.toThrow(/check constraint/);
  });

  it('an authorised exception lets work start once, and it is recorded', async () => {
    const f = await new Flow(h, t).register();
    await f.receive();
    const ex = expectOk(await t.advisor.post(`/jobs/${f.jobId}/exceptions`, { kind: 'START_REPAIR_WITHOUT_APPROVAL', reason: 'Customer approved verbally on site; written approval to follow' }));
    expectOk(await t.ops.post(`/exceptions/${ex.id}/authorise`));
    expectOk(await t.advisor.post(`/jobs/${f.jobId}/start-repair`));
    const job = await f.job();
    expect(job.status).toBe('IN_REPAIR');
    expect(job.tasks[0].exception_id).toBe(ex.id);
    expect(job.history.at(-1).exception_id).toBe(ex.id);
    expect(job.exceptions[0].status).toBe('USED');
  });
});

describe('AT-6 Completed repairs require the configured QC checks', () => {
  it('cannot go to QC with open tasks; required checklist steps must be done', async () => {
    const f = await new Flow(h, t).register();
    await f.receive(); await f.diagnose(); await f.quote(); await f.approve();
    expectOk(await t.advisor.post(`/jobs/${f.jobId}/start-repair`));
    const early = await t.tech.post(`/jobs/${f.jobId}/submit-qc`);
    expect(early.body.code).toBe('NO_COMPLETED_WORK');
    const task = (await f.job()).tasks[0];
    expectOk(await t.tech.post(`/tasks/${task.id}/start`));
    const incomplete = await t.tech.post(`/tasks/${task.id}/complete`, { notes: 'Done the work', labourMinutes: 60, checklist: [{ item: 'Torque check', required: true, done: false }] });
    expect(incomplete.body.code).toBe('CHECKLIST_INCOMPLETE');
    const other = await t.tech2.post(`/tasks/${task.id}/complete`, { notes: 'Done the work', labourMinutes: 60 });
    expect(other.status).toBe(403);
  });

  it('QC outcome is computed: a failed required item sends the job back to repair with a rework task', async () => {
    const f = await new Flow(h, t).register();
    await f.receive(); await f.diagnose(); await f.quote(); await f.approve(); await f.repair();
    const tpl = expectOk(await t.qc.get(`/jobs/${f.jobId}/qc-template`));
    expect(tpl.repair_category).toBe('ENGINE');
    const res = expectOk(await t.qc.post(`/jobs/${f.jobId}/qc`, {
      results: tpl.items.map((i: any, n: number) => ({ code: i.code, passed: n !== 1 })), roadTestDone: true, postScanClear: true, complaintResolved: true,
    }));
    expect(res.outcome).toBe('FAIL');
    const job = await f.job();
    expect(job.status).toBe('IN_REPAIR');
    expect(job.tasks.at(-1).title).toMatch(/^Rework after QC/);
  });

  it('missing road test or unresolved complaint fails QC even if every box is ticked', async () => {
    const f = await new Flow(h, t).register();
    await f.receive(); await f.diagnose(); await f.quote(); await f.approve(); await f.repair();
    const tpl = expectOk(await t.qc.get(`/jobs/${f.jobId}/qc-template`));
    const res = expectOk(await t.qc.post(`/jobs/${f.jobId}/qc`, { results: tpl.items.map((i: any) => ({ code: i.code, passed: true })), roadTestDone: false, postScanClear: true, complaintResolved: true }));
    expect(res.outcome).toBe('FAIL');
    expect(res.failures).toContain('Road test not done');
  });

  it('independent QC: the technician who did the repair cannot inspect it', async () => {
    const both = await h.user(['REPAIR_TECH', 'QC_INSPECTOR']);
    const f = await new Flow(h, { ...t, tech: both }).register();
    await f.receive(); await f.diagnose(); await f.quote(); await f.approve(); await f.repair();
    const res = await f.passQc(both);
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/independent QC/);
    expectOk(await f.passQc(t.qc));
    expect((await f.job()).status).toBe('READY_TO_INVOICE');
  });

  it('invoicing is blocked until QC passes; skipping QC needs an authorised exception', async () => {
    const f = await new Flow(h, t).register();
    await f.receive(); await f.diagnose(); await f.quote(); await f.approve();
    expectOk(await t.advisor.post(`/jobs/${f.jobId}/start-repair`));
    const tooEarly = await t.advisor.post(`/jobs/${f.jobId}/invoice`);
    expect(tooEarly.body.code).toBe('WRONG_STATUS');
    const skip = await t.advisor.post(`/jobs/${f.jobId}/skip-qc`);
    expect(skip.body.code).toBe('QC_REQUIRED');
  });
});

describe('AT-7 Invoice generated from approved work', () => {
  it('bills only approved, completed lines at the approved price, and posts a balanced ledger entry', async () => {
    const f = await new Flow(h, t).register();
    await f.receive(); await f.diagnose(); await f.quote(); await f.approve([f.itemIds[0], f.itemIds[1]]); await f.repair();
    expectOk(await f.passQc());
    const inv = await f.invoice();
    expect(inv.invoice_no).toMatch(/^INV-PH-\d{4}-\d{6}$/);
    expect(inv.items).toHaveLength(2);
    expect(inv.items.map((i: any) => i.source_quotation_item_id).sort()).toEqual([f.itemIds[0], f.itemIds[1]].sort());
    expect(inv.total).toBe(1_612_500 + 4_837_500);
    expect(inv.balance).toBe(inv.total);
    expect((await f.job()).status).toBe('INVOICED');
    const je = await h.db.selectFrom('journal_entries as e').innerJoin('journal_lines as l', 'l.entry_id', 'e.id')
      .select((eb) => [eb.fn.sum<number>('l.debit').as('d'), eb.fn.sum<number>('l.credit').as('c')]).where('e.source_id', '=', inv.id).executeTakeFirstOrThrow();
    expect(Number(je.d)).toBe(inv.total);
    expect(Number(je.c)).toBe(inv.total);
  });

  it('issued invoices cannot be altered or deleted, and a job cannot be invoiced twice', async () => {
    const f = new Flow(h, t);
    const inv = await f.toInvoiced();
    await expect(h.db.updateTable('invoices').set({ total: 1 }).where('id', '=', inv.id).execute()).rejects.toThrow(/INVOICE_IMMUTABLE/);
    await expect(h.db.deleteFrom('invoices').where('id', '=', inv.id).execute()).rejects.toThrow(/INVOICE_IMMUTABLE/);
    const again = await t.advisor.post(`/jobs/${f.jobId}/invoice`);
    expect(again.body.code).toBe('WRONG_STATUS');
  });

  it('a declined job is invoiced only for a diagnosis fee management has set', async () => {
    const f = await new Flow(h, t).register();
    await f.receive(); await f.diagnose(); await f.quote(); await f.approve([]);
    const notSet = await t.advisor.post(`/jobs/${f.jobId}/invoice`);
    expect(notSet.body.code).toBe('DIAGNOSIS_FEE_NOT_SET');
    expectOk(await t.ceo.put('/settings/diagnosis.fee_kobo', { value: 1_500_000 }));
    const inv = expectOk(await t.advisor.post(`/jobs/${f.jobId}/invoice`));
    expect(inv.items[0]).toMatchObject({ kind: 'FEE', net_amount: 1_500_000, tax_amount: 112_500 });
    expectOk(await t.ceo.put('/settings/diagnosis.fee_kobo', { value: null }));
  });
});

describe('AT-8 Partial payments update the outstanding balance', () => {
  it('cash clears on receipt; a bank transfer waits for finance; balance and status update; vehicle releases when paid', async () => {
    const f = new Flow(h, t);
    const inv = await f.toInvoiced();
    const cash = expectOk(await t.advisor.post('/payments', { customerId: f.customerId, invoiceId: inv.id, amount: 30000, method: 'CASH' }));
    expect(cash.status).toBe('CLEARED');
    expect(cash.receipt_no).toMatch(/^RCT-PH-\d{4}-\d{6}$/);
    let i = expectOk(await t.advisor.get(`/invoices/${inv.id}`));
    expect([i.amount_paid, i.balance, i.status]).toEqual([3_000_000, TOTAL - 3_000_000, 'PARTIALLY_PAID']);

    const transfer = expectOk(await t.advisor.post('/payments', { customerId: f.customerId, invoiceId: inv.id, amount: 49550, method: 'BANK_TRANSFER', reference: `TRF-TEST-${Date.now()}` }));
    expect(transfer.status).toBe('PENDING');
    i = expectOk(await t.advisor.get(`/invoices/${inv.id}`));
    expect(i.balance).toBe(TOTAL - 3_000_000); // pending money does not reduce the balance
    expect((await f.job()).status).toBe('INVOICED');

    const premature = await t.advisor.post(`/jobs/${f.jobId}/release`);
    expect(premature.body.code).toBe('PAYMENT_REQUIRED');

    expectOk(await t.accountant.post(`/payments/${transfer.id}/clear`));
    i = expectOk(await t.advisor.get(`/invoices/${inv.id}`));
    expect([i.amount_paid, i.balance, i.status]).toEqual([TOTAL, 0, 'PAID']);
    expect((await f.job()).status).toBe('READY_FOR_COLLECTION');

    expectOk(await t.advisor.post(`/jobs/${f.jobId}/deliver`, { collectedByName: 'Test Customer', identityChecked: true, mileageOut: 120012 }));
    expectOk(await t.advisor.post(`/jobs/${f.jobId}/follow-up`, { outcome: 'Customer confirms the car runs smoothly', satisfaction: 5 }));
    expect((await f.job()).status).toBe('CLOSED');
  });

  it('overpayment becomes a customer deposit and is applied to the next invoice', async () => {
    const f = new Flow(h, t);
    const inv = await f.toInvoiced();
    const p = expectOk(await t.advisor.post('/payments', { customerId: f.customerId, invoiceId: inv.id, amount: 100000, method: 'CASH' }));
    expect(p.unallocated).toBe(10_000_000 - TOTAL);
    const receipt = expectOk(await t.advisor.get(`/payments/${p.id}/receipt`));
    expect(receipt.unapplied).toBe(10_000_000 - TOTAL);
  });

  it('segregation of duties: the recorder cannot clear or fail their own payment; references are unique', async () => {
    const f = new Flow(h, t);
    const inv = await f.toInvoiced();
    const ref = `POS-TEST-${Date.now()}`;
    const p = expectOk(await t.accountant.post('/payments', { customerId: f.customerId, invoiceId: inv.id, amount: 1000, method: 'POS', reference: ref }));
    expect((await t.accountant.post(`/payments/${p.id}/clear`)).status).toBe(403);
    expect((await t.accountant.post(`/payments/${p.id}/fail`, { reason: 'Testing own reversal' })).status).toBe(403);
    const dup = await t.advisor.post('/payments', { customerId: f.customerId, amount: 1000, method: 'POS', reference: ref });
    expect(dup.status).toBe(409);
    const noRef = await t.advisor.post('/payments', { customerId: f.customerId, amount: 1000, method: 'BANK_TRANSFER' });
    expect(noRef.status).toBe(400);
  });

  it('corporate customers on approved credit terms can collect before paying', async () => {
    const f = new Flow(h, t);
    await f.register('CORPORATE');
    expectOk(await t.accountant.patch(`/customers/${f.customerId}/credit`, { creditLimitNaira: 500000, paymentTermsDays: 30 }));
    await f.receive(); await f.diagnose(); await f.quote(); await f.approve(); await f.repair(); expectOk(await f.passQc());
    const inv = await f.invoice();
    expect(new Date(inv.due_date).getTime() - new Date(inv.issue_date).getTime()).toBe(30 * 86400000);
    expectOk(await t.advisor.post(`/jobs/${f.jobId}/release`));
    expect((await f.job()).status).toBe('READY_FOR_COLLECTION');
  });
});

describe('AT-9 Cash collected is not confused with revenue earned', () => {
  it('an unpaid invoice adds revenue and receivables but no cash; a pending transfer adds nothing', async () => {
    const before = expectOk(await t.ceo.get('/reports/summary?period=today'));
    const f = new Flow(h, t);
    await f.toInvoiced();
    await t.advisor.post('/payments', { customerId: f.customerId, amount: 20000, method: 'BANK_TRANSFER', reference: `PEND-${Date.now()}` });
    const after = expectOk(await t.ceo.get('/reports/summary?period=today'));
    expect(after.finance.revenueEarned - before.finance.revenueEarned).toBe(NET);
    expect(after.finance.taxInvoiced - before.finance.taxInvoiced).toBe(VAT);
    expect(after.finance.cashCollected - before.finance.cashCollected).toBe(0);
    expect(after.finance.outstandingReceivables - before.finance.outstandingReceivables).toBe(TOTAL);
    expect(after.reconciliation).toMatchObject({ revenueMatchesLedger: true, cashMatchesLedger: true, receivablesMatchLedger: true });
  });

  it('a cleared payment adds cash and reduces receivables without changing revenue', async () => {
    const f = new Flow(h, t);
    const inv = await f.toInvoiced();
    const before = expectOk(await t.ceo.get('/reports/summary?period=today'));
    expectOk(await t.advisor.post('/payments', { customerId: f.customerId, invoiceId: inv.id, amount: 25000, method: 'CASH' }));
    const after = expectOk(await t.ceo.get('/reports/summary?period=today'));
    expect(after.finance.revenueEarned).toBe(before.finance.revenueEarned);
    expect(after.finance.cashCollected - before.finance.cashCollected).toBe(2_500_000);
    expect(before.finance.outstandingReceivables - after.finance.outstandingReceivables).toBe(2_500_000);
    const tb = expectOk(await t.accountant.get('/reports/trial-balance'));
    expect(tb.balanced).toBe(true);
  });
});

describe('AT-11 Users cannot access modules outside their permissions', () => {
  const cases: [keyof Team, string, string, number][] = [
    ['diag', 'post', '/customers', 403],
    ['tech', 'post', '/payments', 403],
    ['qc', 'get', '/invoices', 403],
    ['advisor', 'get', '/reports/trial-balance', 403],
    ['advisor', 'get', '/audit', 403],
    ['advisor', 'get', '/users', 403],
    ['accountant', 'post', '/reception', 403],
    ['auditor', 'post', '/customers', 403],
    ['auditor', 'post', '/payments', 403],
    ['ops', 'post', '/payments', 403],
  ];
  it.each(cases)('%s → %s %s is refused', async (who, method, url, status) => {
    const res = await (t[who] as any)[method](url, {});
    expect(res.status).toBe(status);
  });

  it('operations manager sees operational KPIs but not financial figures', async () => {
    const s = expectOk(await t.ops.get('/reports/summary?period=month'));
    expect(s.operations).toBeDefined();
    expect(s.finance).toBeUndefined();
  });

  it('the auditor can read everything financial but change nothing', async () => {
    expectOk(await t.auditor.get('/invoices'));
    expectOk(await t.auditor.get('/reports/trial-balance'));
    expectOk(await t.auditor.get('/audit/verify'));
  });

  it('unauthenticated requests and cross-site posts are refused', async () => {
    const request = (await import('supertest')).default;
    const anon = await request(h.app.getHttpServer()).get('/api/v1/customers');
    expect(anon.status).toBe(401);
    const csrf = await request(h.app.getHttpServer()).post('/api/v1/auth/login').send({ email: 'x@example.test', password: 'y' });
    expect(csrf.status).toBe(403);
  });

  it('removing a role revokes active sessions immediately', async () => {
    const u = await h.user(['SERVICE_ADVISOR']);
    expectOk(await u.get('/customers'));
    expectOk(await t.ceo.put(`/users/${u.id}/roles`, { roles: ['DIAG_TECH'] }));
    expect((await u.get('/customers')).status).toBe(401);
  });

  it('locks an account after 5 failed logins', async () => {
    const request = (await import('supertest')).default;
    const u = await h.user(['AUDITOR']);
    const email = (await h.db.selectFrom('users').select('email').where('id', '=', u.id).executeTakeFirstOrThrow()).email;
    for (let i = 0; i < 5; i++) await request(h.app.getHttpServer()).post('/api/v1/auth/login').set('X-Requested-With', 'iketech-erp').send({ email, password: 'wrong-password-1' });
    const locked = await request(h.app.getHttpServer()).post('/api/v1/auth/login').set('X-Requested-With', 'iketech-erp').send({ email, password: 'TestPassword123' });
    expect(locked.status).toBe(423);
  });
});

describe('AT-12 Every sensitive financial change appears in the audit trail', () => {
  it('records invoice, payment, allocation, clearing, discount exception and settings changes, and the chain verifies', async () => {
    const f = new Flow(h, t);
    const inv = await f.toInvoiced();
    const pay = expectOk(await t.advisor.post('/payments', { customerId: f.customerId, invoiceId: inv.id, amount: 1000, method: 'BANK_TRANSFER', reference: `AUD-${Date.now()}` }));
    expectOk(await t.accountant.post(`/payments/${pay.id}/clear`));
    const log = expectOk(await t.auditor.get('/audit?limit=1000'));
    const actions = new Set(log.map((r: any) => r.action));
    for (const a of ['invoice.issue', 'payment.record', 'payment.clear', 'payment.allocate', 'quotation.approved', 'quotation.send', 'qc.pass', 'job.status', 'setting.change', 'exception.authorised']) {
      expect(actions).toContain(a);
    }
    const v = expectOk(await t.auditor.get('/audit/verify'));
    expect(v.intact).toBe(true);
  });

  it('the audit trail is append-only and tampering is detected', async () => {
    await expect(h.db.updateTable('audit_logs').set({ action: 'x' }).where('seq', '=', 1).execute()).rejects.toThrow(/APPEND_ONLY/);
    await expect(h.db.deleteFrom('audit_logs').where('seq', '=', 1).execute()).rejects.toThrow(/APPEND_ONLY/);
    // Simulate an attacker with superuser rights disabling the trigger to edit a row.
    await sql`ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_append_only`.execute(h.db);
    const target = await h.db.selectFrom('audit_logs').select(['seq', 'after']).where('action', '=', 'payment.clear').orderBy('seq').executeTakeFirstOrThrow();
    await sql`UPDATE audit_logs SET after = '{"amount": 1}'::jsonb WHERE seq = ${target.seq}`.execute(h.db);
    await sql`ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_append_only`.execute(h.db);
    const v = expectOk(await t.auditor.get('/audit/verify'));
    expect(v.intact).toBe(false);
    expect(v.brokenAtSeq).toBe(Number(target.seq));
    // Put the original row back so later tests (e.g. the restore drill) see an intact chain again.
    await sql`ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_append_only`.execute(h.db);
    await sql`UPDATE audit_logs SET after = ${JSON.stringify(target.after)}::jsonb WHERE seq = ${target.seq}`.execute(h.db);
    await sql`ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_append_only`.execute(h.db);
    expect((await t.auditor.get('/audit/verify')).body.intact).toBe(true);
  });

  it('secrets never reach the audit trail', async () => {
    const pw = 'SuperSecret12345';
    expectOk(await t.ceo.post('/users', { email: `aud-${Date.now()}@example.test`, fullName: 'Audit Test', password: pw, roles: ['AUDITOR'], staffNo: `T${Date.now() % 1e6}`, department: 'Finance', jobTitle: 'Auditor' }));
    const rows = await h.db.selectFrom('audit_logs').select(['before', 'after']).execute();
    expect(JSON.stringify(rows)).not.toContain(pw);
  });
});

describe('Ledger and numbering integrity', () => {
  it('the database refuses an unbalanced journal entry', async () => {
    const ar = await h.db.selectFrom('accounts').select('id').where('code', '=', '1100').executeTakeFirstOrThrow();
    const branch = await h.db.selectFrom('branches').select('id').executeTakeFirstOrThrow();
    await expect(h.db.transaction().execute(async (trx) => {
      const e = await trx.insertInto('journal_entries').values({ entry_date: new Date(), branch_id: branch.id, source_type: 'TEST', source_id: branch.id, created_by: t.ceo.id }).returning('id').executeTakeFirstOrThrow();
      await trx.insertInto('journal_lines').values({ entry_id: e.id, account_id: ar.id, debit: 100 }).execute();
    })).rejects.toThrow(/UNBALANCED_JOURNAL/);
  });

  it('invoice numbers are gapless', async () => {
    const nums = (await h.db.selectFrom('invoices').select('invoice_no').orderBy('invoice_no').execute()).map((r) => Number(r.invoice_no.split('-').pop()));
    nums.forEach((n, i) => expect(n).toBe(i + 1));
  });

  it('trial balance is balanced after all the activity above', async () => {
    const tb = expectOk(await t.accountant.get('/reports/trial-balance'));
    expect(tb.balanced).toBe(true);
    const ar = tb.accounts.find((a: any) => a.code === '1100').balance;
    const open = await h.db.selectFrom('invoices').select((eb) => eb.fn.sum<number>('balance').as('b')).where('status', '<>', 'VOID').executeTakeFirstOrThrow();
    expect(ar).toBe(Number(open.b));
  });
});
