'use client';
import { useEffect, useState } from 'react';
import { api, naira, when } from '@/lib/api';
import { Action, Msg, useLoad } from '@/components/ui';

type P = { job: any; reload: () => void; can: (...p: string[]) => boolean; meId: string };

function StaffSelect({ role, value, onChange, label }: { role: string; value: string; onChange: (v: string) => void; label: string }) {
  const staff = useLoad(() => api.get<any[]>(`/staff?role=${role}`), [role]);
  return (
    <label className="field">{label}
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose…</option>
        {staff.data?.map((s) => <option key={s.id} value={s.id}>{s.full_name}</option>)}
      </select>
    </label>
  );
}

const CATEGORIES = ['GENERAL', 'SERVICE', 'BRAKES', 'STEERING_SUSPENSION', 'ENGINE', 'TRANSMISSION', 'ELECTRICAL', 'ELECTRICAL_SAFETY'];

export function AssignStep({ job, reload, can }: P) {
  const [tech, setTech] = useState(job.diag_technician_id ?? '');
  const [cat, setCat] = useState(job.repair_category ?? '');
  return (
    <div className="stack">
      {can('jobs.assign') ? (
        <div className="form">
          <div className="two">
            <StaffSelect role="DIAG_TECH" label="Diagnostic technician" value={tech} onChange={setTech} />
            <label className="field">Repair category (sets the QC checklist)
              <select value={cat} onChange={(e) => setCat(e.target.value)}><option value="">Decide after diagnosis</option>{CATEGORIES.map((c) => <option key={c} value={c}>{c.replace(/_/g, ' ').toLowerCase()}</option>)}</select>
            </label>
          </div>
          <div><Action label="Save assignment" run={() => api.post(`/jobs/${job.id}/assign`, { diagTechnicianId: tech || undefined, repairCategory: cat || undefined })} onDone={reload} /></div>
        </div>
      ) : <p className="muted">{job.diag_tech ? `Assigned to ${job.diag_tech}.` : 'Waiting for the operations manager to assign a diagnostic technician.'}</p>}
      {can('jobs.advance', 'jobs.assign') && <Action className="primary" label="Start diagnosis" disabled={!job.diag_technician_id} run={() => api.post(`/jobs/${job.id}/start-diagnosis`)} onDone={reload} />}
    </div>
  );
}

const KINDS = [['DTC', 'Fault code'], ['FREEZE_FRAME', 'Freeze frame'], ['LIVE_DATA', 'Live data'], ['TEST', 'Test'], ['MEASUREMENT', 'Measurement'], ['OBSERVATION', 'Observation']];

export function DiagnosisStep({ job, reload, can }: P) {
  const report = job.diagnosticReports.find((r: any) => r.status === 'DRAFT');
  const [f, setF] = useState({ kind: 'DTC', code: '', value: '', unit: '', interpretation: '', isRootCause: false, supportsId: '' });
  const [r, setR] = useState({ complaintVerified: !!report?.complaint_verified, toolsUsed: report?.tools_used ?? '', summary: report?.summary ?? '', rootCause: report?.root_cause ?? '', recommendedRepair: report?.recommended_repair ?? '', safetyNotes: report?.safety_notes ?? '' });
  useEffect(() => { if (report) setR({ complaintVerified: !!report.complaint_verified, toolsUsed: report.tools_used ?? '', summary: report.summary ?? '', rootCause: report.root_cause ?? '', recommendedRepair: report.recommended_repair ?? '', safetyNotes: report.safety_notes ?? '' }); }, [report?.id]); // eslint-disable-line
  if (!can('diagnostics.write')) return <p className="muted">{job.diag_tech ?? 'The technician'} is diagnosing the vehicle.</p>;
  if (!report) return <Action className="primary" label="Open diagnostic report" run={() => api.post(`/jobs/${job.id}/diagnostic-report`)} onDone={reload} />;
  const findings = report.findings as any[];
  return (
    <div className="stack">
      <div className="alert info small">A fault code is a clue, not proof. Mark the root cause on a test, measurement or observation, or confirm the code with one.</div>
      {findings.length > 0 && (
        <table><thead><tr><th>Type</th><th>Code / value</th><th>What it means</th><th>Root cause</th></tr></thead><tbody>{findings.map((x) => (
          <tr key={x.id}><td>{KINDS.find((k) => k[0] === x.kind)?.[1]}</td><td><b>{x.code}</b> {x.value} {x.unit}{x.supports_id && <div className="small muted">confirms {findings.find((y) => y.id === x.supports_id)?.code ?? 'finding'}</div>}</td><td>{x.interpretation}</td><td>{x.is_root_cause ? 'Yes' : ''}</td></tr>
        ))}</tbody></table>
      )}
      <div className="form panel" style={{ padding: 14 }}>
        <h3>Add a finding</h3>
        <div className="three">
          <label className="field">Type<select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <label className="field">{f.kind === 'DTC' ? 'Code' : 'Reading or result'}{f.kind === 'DTC' ? <input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} placeholder="P0301" /> : <input value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} />}</label>
          <label className="field">Unit<input value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} placeholder="V, Ω, kPa…" /></label>
        </div>
        <label className="field">Interpretation<input value={f.interpretation} onChange={(e) => setF({ ...f, interpretation: e.target.value })} /></label>
        <div className="two">
          <label className="field">Confirms which finding?<select value={f.supportsId} onChange={(e) => setF({ ...f, supportsId: e.target.value })}><option value="">None</option>{findings.map((x) => <option key={x.id} value={x.id}>{x.code ?? x.value ?? x.kind}</option>)}</select></label>
          <label className="check" style={{ alignSelf: 'end' }}><input type="checkbox" checked={f.isRootCause} onChange={(e) => setF({ ...f, isRootCause: e.target.checked })} /> This is the root cause</label>
        </div>
        <div><Action label="Add finding" run={() => api.post(`/diagnostic-reports/${report.id}/findings`, { ...f, code: f.code || undefined, value: f.value || undefined, unit: f.unit || undefined, interpretation: f.interpretation || undefined, supportsId: f.supportsId || undefined })}
          onDone={() => { setF({ kind: 'TEST', code: '', value: '', unit: '', interpretation: '', isRootCause: false, supportsId: '' }); reload(); }} /></div>
      </div>
      <div className="form">
        <label className="check"><input type="checkbox" checked={r.complaintVerified} onChange={(e) => setR({ ...r, complaintVerified: e.target.checked })} /> I reproduced or verified the customer&apos;s complaint</label>
        <label className="field">Tools used<input value={r.toolsUsed} onChange={(e) => setR({ ...r, toolsUsed: e.target.value })} /></label>
        <label className="field">Root cause<textarea value={r.rootCause} onChange={(e) => setR({ ...r, rootCause: e.target.value })} /></label>
        <label className="field">Recommended repair<textarea value={r.recommendedRepair} onChange={(e) => setR({ ...r, recommendedRepair: e.target.value })} /></label>
        <label className="field">Safety precautions<input value={r.safetyNotes} onChange={(e) => setR({ ...r, safetyNotes: e.target.value })} /></label>
        <div className="row">
          <Action label="Save report" run={() => api.put(`/diagnostic-reports/${report.id}`, r)} onDone={reload} />
          <Action className="primary" label="Submit diagnosis" run={async () => { await api.put(`/diagnostic-reports/${report.id}`, r); await api.post(`/diagnostic-reports/${report.id}/submit`); }} onDone={reload} />
        </div>
      </div>
    </div>
  );
}

type Line = { kind: string; description: string; qty: string; unitPrice: string; discount: string; taxCode: string };
const blank: Line = { kind: 'LABOUR', description: '', qty: '1', unitPrice: '', discount: '', taxCode: 'VAT_STANDARD' };

export function QuoteBuilder({ job, reload, existing }: { job: any; reload: () => void; existing?: any }) {
  const [lines, setLines] = useState<Line[]>(existing ? existing.items.map((i: any) => ({ kind: i.kind, description: i.description, qty: String(i.qty), unitPrice: String(i.unit_price / 100), discount: i.discount ? String(i.discount / 100) : '', taxCode: i.tax_code })) : [{ ...blank }, { ...blank, kind: 'PART' }]);
  const [inclusive, setInclusive] = useState(existing?.prices_include_tax ?? false);
  const set = (i: number, k: keyof Line, v: string) => setLines(lines.map((l, n) => (n === i ? { ...l, [k]: v } : l)));
  const body = () => ({ pricesIncludeTax: inclusive, items: lines.filter((l) => l.description.trim()).map((l) => ({ kind: l.kind, description: l.description, qty: Number(l.qty), unitPrice: Number(l.unitPrice || 0), discount: Number(l.discount || 0), taxCode: l.taxCode })) });
  const rough = lines.reduce((s, l) => s + Number(l.qty || 0) * Number(l.unitPrice || 0) - Number(l.discount || 0), 0);
  const report = job.diagnosticReports.find((r: any) => r.status === 'SUBMITTED');
  return (
    <div className="stack">
      {report && <div className="alert info small"><b>Recommended repair:</b> {report.recommended_repair}</div>}
      <table>
        <thead><tr><th>Type</th><th style={{ width: '40%' }}>Description</th><th>Qty / hours</th><th>Unit price ₦</th><th>Discount ₦</th><th>Tax</th><th /></tr></thead>
        <tbody>{lines.map((l, i) => (
          <tr key={i}>
            <td><select value={l.kind} onChange={(e) => set(i, 'kind', e.target.value)}><option value="LABOUR">Labour</option><option value="PART">Part</option><option value="SUBLET">Sublet</option><option value="FEE">Fee</option></select></td>
            <td><input value={l.description} onChange={(e) => set(i, 'description', e.target.value)} aria-label="Description" /></td>
            <td><input inputMode="decimal" value={l.qty} onChange={(e) => set(i, 'qty', e.target.value)} aria-label="Quantity" /></td>
            <td><input inputMode="decimal" value={l.unitPrice} onChange={(e) => set(i, 'unitPrice', e.target.value)} aria-label="Unit price" /></td>
            <td><input inputMode="decimal" value={l.discount} onChange={(e) => set(i, 'discount', e.target.value)} aria-label="Discount" /></td>
            <td><select value={l.taxCode} onChange={(e) => set(i, 'taxCode', e.target.value)}><option value="VAT_STANDARD">VAT</option><option value="VAT_EXEMPT">Exempt</option><option value="VAT_ZERO">Zero-rated</option></select></td>
            <td><button className="link" onClick={() => setLines(lines.filter((_, n) => n !== i))} aria-label="Remove line">Remove</button></td>
          </tr>
        ))}</tbody>
      </table>
      <div className="row">
        <button onClick={() => setLines([...lines, { ...blank, kind: 'PART' }])}>Add line</button>
        <label className="check"><input type="checkbox" checked={inclusive} onChange={(e) => setInclusive(e.target.checked)} /> Prices include VAT</label>
        <span className="spacer" /><span className="muted">Before tax: <b className="num">{naira(Math.round(rough * 100))}</b></span>
      </div>
      <Action className="primary" label={existing ? (existing.status === 'DRAFT' ? 'Save draft' : 'Issue new version') : 'Save quotation'}
        run={() => (existing ? api.put(`/quotations/${existing.id}`, body()) : api.post(`/jobs/${job.id}/quotations`, body()))} onDone={reload} />
    </div>
  );
}

export function QuoteView({ q }: { q: any }) {
  return (
    <table>
      <thead><tr><th>#</th><th>Description</th><th className="r">Qty</th><th className="r">Unit</th><th className="r">Discount</th><th className="r">VAT</th><th className="r">Total</th><th>Decision</th></tr></thead>
      <tbody>{q.items.map((i: any) => (
        <tr key={i.id}><td>{i.line_no}</td><td>{i.description} <span className="small muted">{i.kind.toLowerCase()}</span></td><td className="r num">{i.qty}</td><td className="r num">{naira(i.unit_price)}</td><td className="r num">{i.discount ? naira(i.discount) : ''}</td><td className="r num">{naira(i.tax_amount)}</td><td className="r num">{naira(i.line_total)}</td><td>{i.decision !== 'PENDING' ? i.decision.toLowerCase() : ''}</td></tr>
      ))}</tbody>
      <tfoot>
        <tr><td colSpan={6} className="r">Subtotal</td><td className="r num">{naira(q.subtotal)}</td><td /></tr>
        {q.discount_total > 0 && <tr><td colSpan={6} className="r">Discount</td><td className="r num">−{naira(q.discount_total)}</td><td /></tr>}
        <tr><td colSpan={6} className="r">VAT</td><td className="r num">{naira(q.tax_total)}</td><td /></tr>
        <tr><td colSpan={6} className="r">Total</td><td className="r num">{naira(q.total)}</td><td /></tr>
      </tfoot>
    </table>
  );
}

export function QuoteStep({ job, reload, can }: P) {
  const open = job.quotations.find((q: any) => ['DRAFT', 'SENT'].includes(q.status));
  const [channel, setChannel] = useState('WHATSAPP');
  if (!can('quotations.write')) return <p className="muted">The service advisor is preparing the quotation.</p>;
  if (!open) return <QuoteBuilder job={job} reload={reload} />;
  return (
    <div className="stack">
      <QuoteBuilder job={job} reload={reload} existing={open} key={open.id} />
      <div className="row panel" style={{ padding: 14 }}>
        <span><b>{open.quote_no} v{open.version}</b> · {naira(open.total)} · valid until {new Date(open.valid_until).toLocaleDateString('en-NG')}</span>
        <span className="spacer" />
        <a href={`/print/quotation/${open.id}`} target="_blank" rel="noreferrer"><button>Print / PDF</button></a>
        <select value={channel} onChange={(e) => setChannel(e.target.value)} style={{ width: 170 }} aria-label="Sent by"><option value="WHATSAPP">Sent on WhatsApp</option><option value="EMAIL">Sent by email</option><option value="IN_PERSON">Handed over</option><option value="PHONE">Read by phone</option></select>
        <Action className="primary" label="Mark as sent to customer" run={() => api.post(`/quotations/${open.id}/send`, { channel })} onDone={reload} />
      </div>
    </div>
  );
}

export function ApprovalStep({ job, reload, can }: P) {
  const q = job.quotations.find((x: any) => x.status === 'SENT');
  const [picked, setPicked] = useState<string[]>(q ? q.items.filter((i: any) => !i.is_optional).map((i: any) => i.id) : []);
  const [d, setD] = useState({ channel: 'PHONE', approverName: '', approverContact: job.phone_e164 ?? '', evidenceNote: '' });
  if (!q) return null;
  return (
    <div className="stack">
      <p>Sent {({ WHATSAPP: 'on WhatsApp', EMAIL: 'by email', IN_PERSON: 'in person', PHONE: 'by phone' } as Record<string, string>)[q.sent_channel] ?? ''} · decision due {when(q.approval_deadline)}</p>
      {can('quotations.record_approval') ? (
        <div className="form">
          <table><thead><tr><th>Approve</th><th>Line</th><th className="r">Total</th></tr></thead><tbody>{q.items.map((i: any) => (
            <tr key={i.id}><td><input type="checkbox" checked={picked.includes(i.id)} onChange={() => setPicked(picked.includes(i.id) ? picked.filter((x) => x !== i.id) : [...picked, i.id])} aria-label={`Approve ${i.description}`} /></td><td>{i.description}</td><td className="r num">{naira(i.line_total)}</td></tr>
          ))}</tbody></table>
          <div className="three">
            <label className="field">How did they decide?<select value={d.channel} onChange={(e) => setD({ ...d, channel: e.target.value })}><option value="PHONE">Phone call</option><option value="IN_PERSON">In person</option><option value="WHATSAPP">WhatsApp message</option><option value="EMAIL">Email</option></select></label>
            <label className="field">Who decided<input value={d.approverName} onChange={(e) => setD({ ...d, approverName: e.target.value })} /></label>
            <label className="field">Their phone or email<input value={d.approverContact} onChange={(e) => setD({ ...d, approverContact: e.target.value })} /></label>
          </div>
          <label className="field">Evidence (what was said, time, message reference)<input value={d.evidenceNote} onChange={(e) => setD({ ...d, evidenceNote: e.target.value })} /></label>
          <div className="row">
            <Action className="gate" label={picked.length === q.items.length ? 'Record approval' : picked.length ? `Record partial approval (${picked.length} of ${q.items.length})` : 'Record rejection'}
              run={() => api.post(`/quotations/${q.id}/decision`, { ...d, approvedItemIds: picked })} onDone={reload} />
          </div>
        </div>
      ) : <QuoteView q={q} />}
    </div>
  );
}

export function RepairStep({ job, reload, can, meId }: P) {
  const [done, setDone] = useState<Record<string, { notes: string; minutes: string; procedureRef: string; checks: string }>>({});
  const tasks = job.tasks.filter((t: any) => t.kind === 'REPAIR');
  const [showSupp, setShowSupp] = useState(false);
  return (
    <div className="stack">
      {job.status === 'APPROVED' && can('jobs.advance', 'jobs.assign') && (
        <Action className="primary" label="Start repair (creates tasks from approved lines)" run={() => api.post(`/jobs/${job.id}/start-repair`)} onDone={reload} />
      )}
      {tasks.map((t: any) => {
        const form = done[t.id] ?? { notes: '', minutes: '', procedureRef: '', checks: '' };
        const mine = t.assigned_to === meId;
        return (
          <div key={t.id} className="panel" style={{ padding: 14 }}>
            <div className="row"><b>{t.title}</b><span className="pill">{t.status.replace('_', ' ').toLowerCase()}</span><span className="spacer" /><span className="small muted">{t.assignee ?? 'Unassigned'}{t.labour_minutes ? ` · ${t.labour_minutes} min` : ''}</span></div>
            {t.repair_notes && <p className="small" style={{ marginTop: 8 }}>{t.repair_notes}</p>}
            {job.status === 'IN_REPAIR' && t.status !== 'DONE' && (
              <div className="row" style={{ marginTop: 10 }}>
                {can('jobs.assign') && <AssignTask task={t} reload={reload} />}
                {can('repairs.write') && ['PENDING', 'PAUSED'].includes(t.status) && (!t.assigned_to || mine) && <Action label="Start task" run={() => api.post(`/tasks/${t.id}/start`)} onDone={reload} />}
              </div>
            )}
            {job.status === 'IN_REPAIR' && t.status === 'IN_PROGRESS' && mine && (
              <div className="form" style={{ marginTop: 10 }}>
                <label className="field">What was done and verified<textarea value={form.notes} onChange={(e) => setDone({ ...done, [t.id]: { ...form, notes: e.target.value } })} /></label>
                <div className="three">
                  <label className="field">Labour minutes<input inputMode="numeric" value={form.minutes} onChange={(e) => setDone({ ...done, [t.id]: { ...form, minutes: e.target.value } })} /></label>
                  <label className="field">Procedure reference<input value={form.procedureRef} onChange={(e) => setDone({ ...done, [t.id]: { ...form, procedureRef: e.target.value } })} /></label>
                  <label className="field">Checklist steps done (one per line)<textarea style={{ minHeight: 44 }} value={form.checks} onChange={(e) => setDone({ ...done, [t.id]: { ...form, checks: e.target.value } })} /></label>
                </div>
                <div><Action className="primary" label="Complete task" run={() => api.post(`/tasks/${t.id}/complete`, {
                  notes: form.notes, labourMinutes: Number(form.minutes), procedureRef: form.procedureRef || undefined,
                  checklist: form.checks.split('\n').map((s) => s.trim()).filter(Boolean).map((item) => ({ item, required: true, done: true })),
                })} onDone={reload} /></div>
              </div>
            )}
          </div>
        );
      })}
      {job.status === 'IN_REPAIR' && (
        <div className="row">
          {can('repairs.write', 'jobs.advance') && <Action className="primary" label="Send to quality control" run={() => api.post(`/jobs/${job.id}/submit-qc`)} onDone={reload} />}
          {can('quotations.write') && <button onClick={() => setShowSupp(!showSupp)}>Extra work found — supplementary quotation</button>}
        </div>
      )}
      {showSupp && <div className="panel"><h3 style={{ marginBottom: 10 }}>Supplementary quotation</h3><QuoteBuilder job={job} reload={() => { setShowSupp(false); reload(); }} /></div>}
      {job.status === 'IN_REPAIR' && job.quotations.some((q: any) => q.is_supplementary && q.status === 'DRAFT') && <QuoteStep job={job} reload={reload} can={can} meId={meId} />}
    </div>
  );
}

function AssignTask({ task, reload }: { task: any; reload: () => void }) {
  const [u, setU] = useState(task.assigned_to ?? '');
  return (
    <span className="row" style={{ gap: 8 }}>
      <span style={{ width: 220 }}><StaffSelect role="REPAIR_TECH" label="" value={u} onChange={setU} /></span>
      <Action label="Assign" disabled={!u} run={() => api.post(`/tasks/${task.id}/assign`, { userId: u })} onDone={reload} />
    </span>
  );
}

export function QcStep({ job, reload, can }: P) {
  const tpl = useLoad(() => api.get<any>(`/jobs/${job.id}/qc-template`), [job.id]);
  const [res, setRes] = useState<Record<string, boolean>>({});
  const [x, setX] = useState({ roadTestDone: false, roadTestNotes: '', postScanClear: false, postScanNotes: '', complaintResolved: false, notes: '' });
  const [out, setOut] = useState<any>(null);
  if (!can('qc.inspect')) return <p className="muted">Waiting for a QC inspector.</p>;
  const t = tpl.data;
  if (!t) return <Msg error={tpl.error} />;
  return (
    <div className="form">
      <p className="small muted">Checklist: {t.repair_category.replace(/_/g, ' ').toLowerCase()} v{t.version}{t.requires_independent ? ' · must be inspected by someone who did not work on the job' : ''}</p>
      {t.items.map((i: any) => (
        <label key={i.code} className="check"><input type="checkbox" checked={!!res[i.code]} onChange={(e) => setRes({ ...res, [i.code]: e.target.checked })} />{i.text}{i.required ? '' : ' (optional)'}</label>
      ))}
      {t.requires_road_test && <div className="two"><label className="check"><input type="checkbox" checked={x.roadTestDone} onChange={(e) => setX({ ...x, roadTestDone: e.target.checked })} /> Road test done</label><input placeholder="Road test notes" value={x.roadTestNotes} onChange={(e) => setX({ ...x, roadTestNotes: e.target.value })} /></div>}
      {t.requires_post_scan && <div className="two"><label className="check"><input type="checkbox" checked={x.postScanClear} onChange={(e) => setX({ ...x, postScanClear: e.target.checked })} /> Post-repair scan clear</label><input placeholder="Scan notes" value={x.postScanNotes} onChange={(e) => setX({ ...x, postScanNotes: e.target.value })} /></div>}
      <label className="check"><input type="checkbox" checked={x.complaintResolved} onChange={(e) => setX({ ...x, complaintResolved: e.target.checked })} /> Original complaint confirmed resolved: “{job.customer_complaint}”</label>
      <label className="field">Notes<input value={x.notes} onChange={(e) => setX({ ...x, notes: e.target.value })} /></label>
      {out && out.outcome === 'FAIL' && <div className="alert err">QC failed: {out.failures.join('; ')}. The job is back in repair with a rework task.</div>}
      <div><Action className="gate" label="Submit QC inspection" run={async () => {
        const r = await api.post(`/jobs/${job.id}/qc`, { ...x, roadTestNotes: x.roadTestNotes || undefined, postScanNotes: x.postScanNotes || undefined, notes: x.notes || undefined, postScanClear: t.requires_post_scan ? x.postScanClear : undefined, results: t.items.map((i: any) => ({ code: i.code, passed: !!res[i.code] })) });
        setOut(r);
      }} onDone={reload} /></div>
    </div>
  );
}

export function PaymentForm({ job, invoice, reload }: { job: any; invoice: any; reload: () => void }) {
  const [p, setP] = useState({ amount: invoice ? String(invoice.balance / 100) : '', method: 'CASH', reference: '', note: '' });
  const [msg, setMsg] = useState('');
  return (
    <div className="form">
      <div className="three">
        <label className="field">Amount ₦<input inputMode="decimal" value={p.amount} onChange={(e) => setP({ ...p, amount: e.target.value })} /></label>
        <label className="field">Method<select value={p.method} onChange={(e) => setP({ ...p, method: e.target.value })}><option value="CASH">Cash</option><option value="BANK_TRANSFER">Bank transfer</option><option value="POS">POS card</option><option value="CHEQUE">Cheque</option></select></label>
        <label className="field">Reference{p.method === 'CASH' ? ' (optional)' : ''}<input value={p.reference} onChange={(e) => setP({ ...p, reference: e.target.value })} placeholder={p.method === 'POS' ? 'POS slip / RRN' : p.method === 'BANK_TRANSFER' ? 'Transfer session ID' : ''} /></label>
      </div>
      {p.method !== 'CASH' && <p className="small muted">Transfers, POS and cheques count only after finance confirms them in the bank statement.</p>}
      {msg && <div className="alert ok">{msg}</div>}
      <div><Action className="primary" label="Record payment" run={async () => {
        const r = await api.post('/payments', { customerId: job.customer_id, invoiceId: invoice?.id, amount: Number(p.amount), method: p.method, reference: p.reference || undefined, note: p.note || undefined });
        setMsg(r.status === 'CLEARED' ? `Receipt ${r.receipt_no} issued.` : 'Recorded. Finance will confirm it against the bank.');
      }} onDone={reload} /></div>
    </div>
  );
}

export function DeliverStep({ job, reload }: { job: any; reload: () => void }) {
  const [d, setD] = useState({ collectedByName: '', identityChecked: false, mileageOut: String(job.inspection?.mileage_in ?? '') });
  return (
    <div className="form">
      <div className="two">
        <label className="field">Collected by<input value={d.collectedByName} onChange={(e) => setD({ ...d, collectedByName: e.target.value })} /></label>
        <label className="field">Mileage out (km)<input inputMode="numeric" value={d.mileageOut} onChange={(e) => setD({ ...d, mileageOut: e.target.value.replace(/\D/g, '') })} /></label>
      </div>
      <label className="check"><input type="checkbox" checked={d.identityChecked} onChange={(e) => setD({ ...d, identityChecked: e.target.checked })} /> I checked the collector&apos;s identity against the customer record</label>
      <div><Action className="gate" label="Hand over keys" disabled={!d.identityChecked || !d.collectedByName} run={() => api.post(`/jobs/${job.id}/deliver`, { ...d, mileageOut: Number(d.mileageOut) })} onDone={reload} /></div>
    </div>
  );
}

export function FollowUpStep({ job, reload }: { job: any; reload: () => void }) {
  const [f, setF] = useState({ outcome: '', satisfaction: '' });
  return (
    <div className="form">
      <p>Call {job.customer_name} on {job.phone_e164}.</p>
      <div className="two">
        <label className="field">What the customer said<input value={f.outcome} onChange={(e) => setF({ ...f, outcome: e.target.value })} /></label>
        <label className="field">Satisfaction (1–5)<select value={f.satisfaction} onChange={(e) => setF({ ...f, satisfaction: e.target.value })}><option value="">Not given</option>{[5, 4, 3, 2, 1].map((n) => <option key={n}>{n}</option>)}</select></label>
      </div>
      <div><Action className="primary" label="Record follow-up and close job" run={() => api.post(`/jobs/${job.id}/follow-up`, { outcome: f.outcome, satisfaction: f.satisfaction ? Number(f.satisfaction) : undefined })} onDone={reload} /></div>
    </div>
  );
}

export function ExceptionRequest({ job, reload }: { job: any; reload: () => void }) {
  const [kind, setKind] = useState('START_REPAIR_WITHOUT_APPROVAL');
  const [reason, setReason] = useState('');
  const [limit, setLimit] = useState('');
  const [msg, setMsg] = useState('');
  return (
    <div className="form">
      <div className="two">
        <label className="field">Exception<select value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="START_REPAIR_WITHOUT_APPROVAL">Start work before customer approval</option>
          <option value="SKIP_QC">Skip quality control</option>
          <option value="RELEASE_WITHOUT_PAYMENT">Release vehicle with balance due</option>
          <option value="MILEAGE_OVERRIDE">Accept mileage below last record</option>
          <option value="DISCOUNT_ABOVE_LIMIT">Discount above my limit</option>
        </select></label>
        {kind === 'DISCOUNT_ABOVE_LIMIT' && <label className="field">Discount needed (%)<input inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} /></label>}
      </div>
      <label className="field">Reason (a manager will read this)<textarea value={reason} onChange={(e) => setReason(e.target.value)} /></label>
      {msg && <div className="alert ok">{msg}</div>}
      <div><Action label="Request exception" run={async () => { await api.post(`/jobs/${job.id}/exceptions`, { kind, reason, limitBp: kind === 'DISCOUNT_ABOVE_LIMIT' ? Math.round(Number(limit) * 100) : undefined }); setMsg('Sent to a manager for authorisation.'); setReason(''); }} onDone={reload} /></div>
    </div>
  );
}
