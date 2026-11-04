'use client';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { api, naira, when, errorText, STATUS_LABEL } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Action, Msg, Pill, Plate, Rail, useLoad, Empty } from '@/components/ui';
import { ApprovalStep, AssignStep, DeliverStep, DiagnosisStep, ExceptionRequest, FollowUpStep, PaymentForm, QcStep, QuoteStep, QuoteView, RepairStep } from './steps';

const NEXT: Record<string, string> = {
  RECEIVED: 'Assign a technician and start diagnosis',
  DIAGNOSING: 'Find and prove the root cause',
  QUOTE_PENDING: 'Prepare the quotation',
  AWAITING_APPROVAL: 'Record the customer’s decision',
  APPROVED: 'Start the approved repair',
  IN_REPAIR: 'Complete the repair tasks',
  QC: 'Quality control inspection',
  READY_TO_INVOICE: 'Issue the invoice',
  INVOICED: 'Collect payment',
  READY_FOR_COLLECTION: 'Hand the vehicle back',
  DELIVERED: 'Follow-up call',
  DECLINED: 'Customer declined the repair',
  ON_HOLD: 'Job on hold',
};

export default function JobPage() {
  const { id } = useParams<{ id: string }>();
  const { me, can } = useSession();
  const { data: job, error, reload } = useLoad(() => api.get<any>(`/jobs/${id}`), [id]);
  const [tab, setTab] = useState('overview');
  if (error) return <Msg error={error} />;
  if (!job || !me) return <p className="muted">Loading job…</p>;
  const p = { job, reload, can, meId: me.id };
  const invoice = job.invoices.find((i: any) => i.status !== 'VOID');

  return (
    <>
      <div className="pagehead">
        <div className="row" style={{ alignItems: 'center', gap: 16 }}>
          <Plate no={job.plate_no} big />
          <div>
            <h1>{job.make} {job.model}{job.year ? ` ${job.year}` : ''}</h1>
            <p className="num">{job.job_no} · {job.customer_name} · {job.phone_e164} · received {when(job.received_at)}</p>
          </div>
        </div>
        <Pill s={job.status} />
      </div>
      <Rail status={job.status} holdFrom={job.hold_from_status} />

      <section className={`next ${job.status === 'ON_HOLD' || job.status === 'DECLINED' ? 'blocked' : ''}`} style={{ marginTop: 16 }}>
        <h2>{NEXT[job.status] ?? STATUS_LABEL[job.status]}</h2>
        <div style={{ marginTop: 12 }}>
          {job.status === 'RECEIVED' && <AssignStep {...p} />}
          {job.status === 'DIAGNOSING' && <DiagnosisStep {...p} />}
          {job.status === 'QUOTE_PENDING' && <QuoteStep {...p} />}
          {job.status === 'AWAITING_APPROVAL' && <><ApprovalStep {...p} />{can('quotations.write') && <details style={{ marginTop: 12 }}><summary>Revise this quotation (issues a new version)</summary><div style={{ marginTop: 12 }}><QuoteStep {...p} /></div></details>}</>}
          {(job.status === 'APPROVED' || job.status === 'IN_REPAIR') && <RepairStep {...p} />}
          {job.status === 'QC' && <QcStep {...p} />}
          {job.status === 'READY_TO_INVOICE' && (can('invoices.create') ? <Action className="primary" label="Issue invoice from approved work" run={() => api.post(`/jobs/${job.id}/invoice`)} onDone={reload} /> : <p className="muted">Waiting for the invoice to be issued.</p>)}
          {job.status === 'DECLINED' && (
            <div className="stack">
              <p>No repair was approved. Invoice the diagnosis fee if your policy charges one, then close after the follow-up.</p>
              <div className="row">
                {can('invoices.create') && <Action label="Invoice diagnosis fee" run={() => api.post(`/jobs/${job.id}/invoice`)} onDone={reload} />}
              </div>
              {can('jobs.advance') && <FollowUpStep job={job} reload={reload} />}
            </div>
          )}
          {job.status === 'INVOICED' && invoice && (
            <div className="stack">
              <p><b className="num">{naira(invoice.balance)}</b> due on invoice <a href={`/print/invoice/${invoice.id}`} target="_blank" rel="noreferrer">{invoice.invoice_no}</a>. The vehicle is released automatically when it is paid in full.</p>
              {can('payments.record') && <PaymentForm job={job} invoice={invoice} reload={reload} />}
              {can('jobs.advance', 'payments.clear') && <div><Action label="Release on credit terms or approved exception" run={() => api.post(`/jobs/${job.id}/release`)} onDone={reload} /></div>}
            </div>
          )}
          {job.status === 'READY_FOR_COLLECTION' && (can('jobs.advance') ? <DeliverStep job={job} reload={reload} /> : <p className="muted">Ready for the customer to collect.</p>)}
          {job.status === 'DELIVERED' && (can('jobs.advance') ? <FollowUpStep job={job} reload={reload} /> : <p className="muted">Follow-up due {when(job.follow_up_at)}.</p>)}
          {job.status === 'ON_HOLD' && <p>On hold from “{STATUS_LABEL[job.hold_from_status]}”. Reason: {job.history.at(-1)?.reason}</p>}
          {['CLOSED', 'CANCELLED'].includes(job.status) && <p className="muted">This job is {job.status.toLowerCase()}.</p>}
        </div>
        {can('jobs.hold') && !['CLOSED', 'CANCELLED', 'DELIVERED'].includes(job.status) && <HoldControls job={job} reload={reload} />}
      </section>

      <div className="tabs" role="tablist">
        {[['overview', 'Reception'], ['diagnosis', 'Diagnosis'], ['quotes', `Quotations (${job.quotations.length})`], ['work', 'Work & QC'], ['billing', 'Billing'], ['files', 'Photos & files'], ['history', 'History']].map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="grid2">
          <section className="panel"><h2>Customer concern</h2><p>{job.customer_complaint}</p>{job.requested_work && <p className="muted">Requested: {job.requested_work}</p>}
            <dl className="facts" style={{ marginTop: 12 }}>
              <dt>Advisor</dt><dd>{job.advisor}</dd><dt>Diagnostic tech</dt><dd>{job.diag_tech ?? '—'}</dd><dt>Category</dt><dd>{job.repair_category?.replace(/_/g, ' ').toLowerCase() ?? '—'}</dd>
              <dt>Promised</dt><dd>{when(job.promised_at)}</dd><dt>VIN</dt><dd className="num">{job.vin ?? '—'}</dd>
            </dl></section>
          <section className="panel"><h2>Condition at reception</h2>
            {job.inspection && <dl className="facts">
              <dt>Mileage in</dt><dd className="num">{job.inspection.mileage_in.toLocaleString()} km</dd>
              <dt>Fuel</dt><dd>{job.inspection.fuel_level}</dd>
              <dt>Warning lights</dt><dd>{job.inspection.warning_lights.join(', ') || 'None'}</dd>
              <dt>Items in car</dt><dd>{job.inspection.accessories.join(', ') || 'None recorded'}</dd>
              <dt>Damage</dt><dd>{job.inspection.damage_notes.map((d: any) => `${d.area}: ${d.note}`).join('; ') || 'None recorded'}</dd>
              <dt>Acknowledged</dt><dd>{job.inspection.ack_name ? `${job.inspection.ack_name} (${job.inspection.ack_method.toLowerCase().replace('_', ' ')})` : 'Not yet'}</dd>
              <dt>Keys</dt><dd>{job.keys.at(-1) ? `${job.keys.at(-1).action === 'OUT' ? 'Handed to' : 'At'} ${job.keys.at(-1).action === 'OUT' ? job.keys.at(-1).holder_name : job.keys.at(-1).location}` : '—'}</dd>
            </dl>}
          </section>
        </div>
      )}

      {tab === 'diagnosis' && (job.diagnosticReports.length ? job.diagnosticReports.map((r: any) => (
        <section key={r.id} className="panel">
          <div className="row"><h2>Diagnostic report</h2><Pill s={r.status} /><span className="spacer" /><span className="small muted">{r.technician} · {when(r.submitted_at ?? r.created_at)}</span></div>
          <dl className="facts" style={{ margin: '12px 0' }}>
            <dt>Complaint verified</dt><dd>{r.complaint_verified ? 'Yes' : 'No'}</dd><dt>Root cause</dt><dd>{r.root_cause ?? '—'}</dd>
            <dt>Recommended repair</dt><dd>{r.recommended_repair ?? '—'}</dd><dt>Safety</dt><dd>{r.safety_notes ?? '—'}</dd><dt>Tools</dt><dd>{r.tools_used ?? '—'}</dd>
          </dl>
          <table><thead><tr><th>Type</th><th>Code / value</th><th>Interpretation</th><th>Root cause</th></tr></thead><tbody>{r.findings.map((f: any) => (
            <tr key={f.id}><td>{f.kind.replace('_', ' ').toLowerCase()}</td><td><b>{f.code}</b> {f.value} {f.unit}</td><td>{f.interpretation}</td><td>{f.is_root_cause ? 'Yes' : ''}</td></tr>
          ))}</tbody></table>
        </section>
      )) : <Empty>No diagnosis recorded yet.</Empty>)}

      {tab === 'quotes' && (job.quotations.length ? [...job.quotations].reverse().map((q: any) => (
        <section key={q.id} className="panel">
          <div className="row"><h2 className="num">{q.quote_no} v{q.version}{q.is_supplementary ? ' (supplementary)' : ''}</h2><Pill s={q.status} /><span className="spacer" /><a href={`/print/quotation/${q.id}`} target="_blank" rel="noreferrer">Print</a></div>
          <div style={{ marginTop: 12 }}><QuoteView q={q} /></div>
          {q.approvals.map((a: any) => <p key={a.id} className="small muted" style={{ marginTop: 8 }}>{a.decision.toLowerCase()} by {a.approver_name} ({a.approver_contact}) via {a.channel.toLowerCase().replace('_', ' ')} at {when(a.decided_at)}. {a.evidence_note}</p>)}
        </section>
      )) : <Empty>No quotation yet.</Empty>)}

      {tab === 'work' && (
        <>
          <section className="panel"><h2>Repair tasks</h2>
            {job.tasks.length ? <table><thead><tr><th>Task</th><th>Technician</th><th>Status</th><th className="r">Minutes</th><th>Notes</th></tr></thead><tbody>{job.tasks.map((t: any) => (
              <tr key={t.id}><td>{t.title}{t.exception_id && <div className="small" style={{ color: 'var(--wait)' }}>under exception</div>}</td><td>{t.assignee ?? '—'}</td><td><Pill s={t.status} /></td><td className="r num">{t.labour_minutes || ''}</td><td className="small">{t.repair_notes}</td></tr>
            ))}</tbody></table> : <Empty>No tasks yet — they are created from approved quotation lines.</Empty>}
          </section>
          <section className="panel"><h2>Quality control</h2>
            {job.qcInspections.length ? <table><thead><tr><th>When</th><th>Inspector</th><th>Outcome</th><th>Road test</th><th>Post scan</th><th>Notes</th></tr></thead><tbody>{job.qcInspections.map((q: any) => (
              <tr key={q.id}><td>{when(q.created_at)}</td><td>{q.inspector}</td><td><Pill s={q.outcome} /></td><td>{q.road_test_done ? 'Done' : '—'}</td><td>{q.post_scan_clear == null ? '—' : q.post_scan_clear ? 'Clear' : 'Not clear'}</td><td className="small">{q.notes}</td></tr>
            ))}</tbody></table> : <Empty>No QC inspection yet.</Empty>}
          </section>
        </>
      )}

      {tab === 'billing' && (
        <section className="panel"><h2>Invoices</h2>
          {job.invoices.length ? <table><thead><tr><th>Invoice</th><th>Issued</th><th className="r">Total</th><th className="r">Paid</th><th className="r">Balance</th><th>Status</th></tr></thead><tbody>{job.invoices.map((i: any) => (
            <tr key={i.id}><td><a href={`/print/invoice/${i.id}`} target="_blank" rel="noreferrer" className="num">{i.invoice_no}</a></td><td>{when(i.issue_date)}</td><td className="r num">{naira(i.total)}</td><td className="r num">{naira(i.amount_paid)}</td><td className="r num">{naira(i.balance)}</td><td><Pill s={i.status} /></td></tr>
          ))}</tbody></table> : <Empty>Not invoiced yet.</Empty>}
        </section>
      )}

      {tab === 'files' && <Files jobId={job.id} />}

      {tab === 'history' && (
        <div className="grid2">
          <section className="panel"><h2>Status history</h2>
            <table><tbody>{job.history.map((h: any) => (
              <tr key={h.id}><td className="small num">{when(h.at)}</td><td><b>{STATUS_LABEL[h.to_status]}</b><div className="small muted">{h.reason}</div>{h.exception_id && <div className="small" style={{ color: 'var(--wait)' }}>under authorised exception</div>}</td><td className="small">{h.actor}</td></tr>
            ))}</tbody></table>
          </section>
          <section className="panel"><h2>Exceptions</h2>
            {job.exceptions.length ? <table><tbody>{job.exceptions.map((e: any) => (
              <tr key={e.id}><td><b>{e.kind.replace(/_/g, ' ').toLowerCase()}</b><div className="small">{e.reason}</div><div className="small muted">asked by {e.requested_by_name}{e.authorised_by_name ? `, decided by ${e.authorised_by_name}` : ''}</div></td><td><Pill s={e.status} /></td></tr>
            ))}</tbody></table> : <Empty>No exceptions on this job.</Empty>}
            {can('exceptions.request') && !['CLOSED', 'CANCELLED'].includes(job.status) && <details style={{ marginTop: 12 }}><summary>Request an exception</summary><div style={{ marginTop: 12 }}><ExceptionRequest job={job} reload={reload} /></div></details>}
          </section>
        </div>
      )}
    </>
  );
}

function HoldControls({ job, reload }: { job: any; reload: () => void }) {
  const [reason, setReason] = useState('');
  return (
    <details style={{ marginTop: 16 }}>
      <summary className="small">Hold, resume or cancel this job</summary>
      <div className="row" style={{ marginTop: 10 }}>
        {job.status === 'ON_HOLD' ? <Action label="Resume" run={() => api.post(`/jobs/${job.id}/resume`)} onDone={reload} /> : <>
          <input placeholder="Reason" value={reason} onChange={(e) => setReason(e.target.value)} style={{ width: 300 }} aria-label="Reason" />
          <Action label="Put on hold" disabled={reason.length < 5} run={() => api.post(`/jobs/${job.id}/hold`, { reason })} onDone={reload} />
          <Action className="danger" label="Cancel job" disabled={reason.length < 5} confirm="Cancel this job? This cannot be undone." run={() => api.post(`/jobs/${job.id}/cancel`, { reason })} onDone={reload} />
        </>}
      </div>
    </details>
  );
}

function Files({ jobId }: { jobId: string }) {
  const list = useLoad(() => api.get<any[]>(`/attachments?ownerType=job&ownerId=${jobId}`), [jobId]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  async function upload(file: File, visibility: string) {
    setBusy(true); setErr('');
    const fd = new FormData();
    fd.append('file', file); fd.append('ownerType', 'job'); fd.append('ownerId', jobId); fd.append('visibility', visibility);
    const r = await fetch('/api/v1/attachments', { method: 'POST', body: fd, credentials: 'same-origin', headers: { 'X-Requested-With': 'iketech-erp' } });
    if (!r.ok) setErr((await r.json().catch(() => ({}))).message ?? 'Upload failed');
    setBusy(false); list.reload();
  }
  return (
    <section className="panel">
      <h2>Photos & files</h2>
      <p className="small muted">Photos, videos and PDFs up to 50 MB. Files are private to staff unless marked visible to the customer.</p>
      <Msg error={err || list.error} />
      <div className="row" style={{ margin: '12px 0' }}>
        <label className="btn" style={{ cursor: 'pointer' }}>{busy ? 'Uploading…' : 'Add internal photo or file'}<input type="file" accept="image/*,video/*,application/pdf" capture="environment" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0], 'INTERNAL')} /></label>
        <label className="btn" style={{ cursor: 'pointer' }}>Add photo the customer can see<input type="file" accept="image/*,video/*,application/pdf" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0], 'CUSTOMER')} /></label>
      </div>
      {list.data?.length ? <table><tbody>{list.data.map((a) => (
        <tr key={a.id}><td><a href={`/api/v1/attachments/${a.id}`} target="_blank" rel="noreferrer">{a.file_name}</a></td><td className="small muted">{(a.size / 1024).toFixed(0)} KB</td><td>{a.visibility === 'CUSTOMER' ? <span className="pill go">customer can see</span> : <span className="pill">internal</span>}</td><td className="small muted">{when(a.created_at)}</td></tr>
      ))}</tbody></table> : <Empty>No files yet.</Empty>}
    </section>
  );
}
