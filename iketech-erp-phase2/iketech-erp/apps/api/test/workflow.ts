import { Client, Harness, expectOk, testPhone, testPlate } from './helpers';

export interface Team { advisor: Client; ops: Client; diag: Client; tech: Client; tech2: Client; qc: Client; accountant: Client; ceo: Client; auditor: Client }

export async function makeTeam(h: Harness): Promise<Team> {
  return {
    advisor: await h.user(['SERVICE_ADVISOR']), ops: await h.user(['OPS_MANAGER']), diag: await h.user(['DIAG_TECH']),
    tech: await h.user(['REPAIR_TECH']), tech2: await h.user(['REPAIR_TECH']), qc: await h.user(['QC_INSPECTOR']),
    accountant: await h.user(['ACCOUNTANT']), ceo: await h.user(['CEO']), auditor: await h.user(['AUDITOR']),
  };
}

export const standardQuote = {
  pricesIncludeTax: false,
  items: [
    { kind: 'LABOUR', description: 'Replace ignition coil cylinder 3 and verify misfire cleared', qty: 1.5, unitPrice: 10000 },
    { kind: 'PART', description: 'Ignition coil (OEM)', qty: 1, unitPrice: 45000 },
    { kind: 'PART', description: 'Spark plug set', qty: 4, unitPrice: 3500 },
  ],
};

/** Drives a job step by step. Each method performs exactly one real API call sequence through the gates. */
export class Flow {
  customerId!: string; vehicleId!: string; jobId!: string; reportId!: string; quoteId!: string; invoiceId!: string; itemIds: string[] = [];
  constructor(private h: Harness, private t: Team) {}

  async register(type: 'INDIVIDUAL' | 'CORPORATE' = 'INDIVIDUAL', extra: object = {}) {
    const c = expectOk(await this.t.advisor.post('/customers', {
      type, name: `Test Customer ${Date.now()}`, companyName: type === 'CORPORATE' ? 'Test Logistics Ltd' : undefined, phone: testPhone(), ...extra,
    }));
    this.customerId = c.id;
    const v = expectOk(await this.t.advisor.post(`/customers/${c.id}/vehicles`, { plateNo: testPlate(), make: 'Toyota', model: 'Camry', year: 2015 }));
    this.vehicleId = v.id;
    return this;
  }

  async receive(mileageIn = 120000) {
    const j = expectOk(await this.t.advisor.post('/reception', {
      customerId: this.customerId, vehicleId: this.vehicleId, customerComplaint: 'Engine shakes at idle and check-engine light is on',
      inspection: { mileageIn, fuelLevel: '1/2', warningLights: ['CHECK_ENGINE'], accessories: ['Spare tyre', 'Jack'], customerAck: { method: 'SIGNATURE', name: 'Test Customer' } },
    }));
    this.jobId = j.id;
    return this;
  }

  async diagnose() {
    expectOk(await this.t.ops.post(`/jobs/${this.jobId}/assign`, { diagTechnicianId: this.t.diag.id, repairCategory: 'ENGINE' }));
    expectOk(await this.t.advisor.post(`/jobs/${this.jobId}/start-diagnosis`));
    const r = expectOk(await this.t.diag.post(`/jobs/${this.jobId}/diagnostic-report`));
    this.reportId = r.id;
    const dtc = expectOk(await this.t.diag.post(`/diagnostic-reports/${r.id}/findings`, { kind: 'DTC', code: 'P0303', interpretation: 'Cylinder 3 misfire detected', isRootCause: true }));
    expectOk(await this.t.diag.post(`/diagnostic-reports/${r.id}/findings`, { kind: 'TEST', value: 'Misfire followed coil when swapped from cyl 3 to cyl 1', supportsId: dtc.id }));
    expectOk(await this.t.diag.put(`/diagnostic-reports/${r.id}`, { complaintVerified: true, rootCause: 'Failed ignition coil on cylinder 3', recommendedRepair: 'Replace coil 3; replace worn plugs' }));
    expectOk(await this.t.diag.post(`/diagnostic-reports/${r.id}/submit`));
    return this;
  }

  async quote(body: object = standardQuote, send = true) {
    const q = expectOk(await this.t.advisor.post(`/jobs/${this.jobId}/quotations`, body));
    this.quoteId = q.id;
    this.itemIds = q.items.map((i: any) => i.id);
    if (send) expectOk(await this.t.advisor.post(`/quotations/${q.id}/send`, { channel: 'WHATSAPP' }));
    return this;
  }

  async approve(ids = this.itemIds) {
    expectOk(await this.t.advisor.post(`/quotations/${this.quoteId}/decision`, {
      approvedItemIds: ids, channel: 'PHONE', approverName: 'Test Customer', approverContact: '+2349000000000', evidenceNote: 'Approved on a recorded phone call',
    }));
    return this;
  }

  async repair() {
    expectOk(await this.t.advisor.post(`/jobs/${this.jobId}/start-repair`));
    const job = expectOk(await this.t.advisor.get(`/jobs/${this.jobId}`));
    for (const task of job.tasks.filter((x: any) => x.status !== 'DONE')) {
      expectOk(await this.t.tech.post(`/tasks/${task.id}/start`));
      expectOk(await this.t.tech.post(`/tasks/${task.id}/complete`, {
        notes: 'Replaced coil and plugs, cleared codes, verified no misfire on live data', labourMinutes: 90,
        checklist: [{ item: 'Torque plugs to spec', required: true, done: true }],
      }));
    }
    expectOk(await this.t.tech.post(`/jobs/${this.jobId}/submit-qc`));
    return this;
  }

  async passQc(by: Client = this.t.qc) {
    const tpl = expectOk(await by.get(`/jobs/${this.jobId}/qc-template`));
    return by.post(`/jobs/${this.jobId}/qc`, {
      results: tpl.items.map((i: any) => ({ code: i.code, passed: true })), roadTestDone: true, postScanClear: true, complaintResolved: true,
    });
  }

  async invoice() {
    const inv = expectOk(await this.t.advisor.post(`/jobs/${this.jobId}/invoice`));
    this.invoiceId = inv.id;
    return inv;
  }

  async toInvoiced() {
    await this.register(); await this.receive(); await this.diagnose(); await this.quote(); await this.approve(); await this.repair();
    expectOk(await this.passQc());
    return this.invoice();
  }

  job() { return this.t.advisor.get(`/jobs/${this.jobId}`).then((r) => r.body); }
}
