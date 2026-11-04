'use client';
import { ReactNode, useCallback, useEffect, useState } from 'react';
import { errorText, STATUS_LABEL } from '@/lib/api';

export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const reload = useCallback(() => { fn().then((d) => { setData(d); setError(''); }).catch((e) => setError(errorText(e))); }, deps); // eslint-disable-line
  useEffect(() => { reload(); }, [reload]);
  return { data, error, reload, setData };
}

export function Plate({ no, big }: { no?: string | null; big?: boolean }) {
  if (!no) return null;
  return <span className={`plate${big ? ' big' : ''}`} aria-label={`Plate ${no}`}>{no}</span>;
}

const TONE: Record<string, string> = {
  AWAITING_APPROVAL: 'wait', QUOTE_PENDING: 'wait', INVOICED: 'wait', ON_HOLD: 'wait', PENDING: 'wait', PARTIALLY_PAID: 'wait', SENT: 'wait', DRAFT: 'wait',
  READY_FOR_COLLECTION: 'go', APPROVED: 'go', PAID: 'go', CLEARED: 'go', DELIVERED: 'go', CLOSED: '', PASS: 'go', DONE: 'go', AUTHORISED: 'go', ISSUED: 'info', PARTIALLY_APPROVED: 'go',
  DECLINED: 'stop', CANCELLED: 'stop', FAILED: 'stop', REVERSED: 'stop', FAIL: 'stop', REJECTED: 'stop', SUPERSEDED: '', EXPIRED: 'stop', OVERDUE: 'stop',
  IN_REPAIR: 'info', QC: 'info', DIAGNOSING: 'info', RECEIVED: 'info', READY_TO_INVOICE: 'info', IN_PROGRESS: 'info',
};
export function Pill({ s, label }: { s: string; label?: string }) {
  return <span className={`pill ${TONE[s] ?? ''}`}>{label ?? STATUS_LABEL[s] ?? s.replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase())}</span>;
}

/** Steps of the service lifecycle, with the four hard gates placed after the step they protect. */
const RAIL: { key: string; label: string; statuses: string[]; gateAfter?: string }[] = [
  { key: 'rec', label: 'Received', statuses: ['RECEIVED'] },
  { key: 'diag', label: 'Diagnosis', statuses: ['DIAGNOSING'] },
  { key: 'quote', label: 'Quotation', statuses: ['QUOTE_PENDING', 'AWAITING_APPROVAL'], gateAfter: 'Customer approval' },
  { key: 'repair', label: 'Repair', statuses: ['APPROVED', 'IN_REPAIR'] },
  { key: 'qc', label: 'QC', statuses: ['QC'], gateAfter: 'QC pass' },
  { key: 'inv', label: 'Invoice', statuses: ['READY_TO_INVOICE', 'INVOICED'], gateAfter: 'Payment or approved credit' },
  { key: 'col', label: 'Collection', statuses: ['READY_FOR_COLLECTION'], gateAfter: 'Identity checked, keys out' },
  { key: 'done', label: 'Follow-up', statuses: ['DELIVERED', 'CLOSED'] },
];
export function Rail({ status, holdFrom }: { status: string; holdFrom?: string | null }) {
  const s = status === 'ON_HOLD' && holdFrom ? holdFrom : status;
  const idx = RAIL.findIndex((r) => r.statuses.includes(s));
  const at = s === 'DECLINED' ? 2 : s === 'CLOSED' ? RAIL.length : idx;
  return (
    <div className="rail" role="img" aria-label={`Workflow position: ${STATUS_LABEL[status] ?? status}`}>
      {RAIL.map((r, i) => (
        <span key={r.key} style={{ display: 'contents' }}>
          <span className={`step ${i < at ? 'done' : i === at ? 'now' : ''}`}>{r.label}</span>
          {r.gateAfter && <span className={`gate ${i < at ? 'passed' : ''}`} title={`Gate: ${r.gateAfter}`} />}
        </span>
      ))}
    </div>
  );
}

export function Msg({ error, ok }: { error?: string; ok?: string }) {
  if (error) return <div className="alert err" role="alert">{error}</div>;
  if (ok) return <div className="alert ok" role="status">{ok}</div>;
  return null;
}

/** A button that runs an async action, shows progress, and reports errors next to itself. */
export function Action({ label, run, className = '', disabled, confirm, onDone }: { label: ReactNode; run: () => Promise<unknown>; className?: string; disabled?: boolean; confirm?: string; onDone?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 6 }}>
      <button className={className} disabled={busy || disabled} onClick={async () => {
        if (confirm && !window.confirm(confirm)) return;
        setBusy(true); setErr('');
        try { await run(); onDone?.(); } catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
      }}>{busy ? 'Working…' : label}</button>
      {err && <span className="alert err small" role="alert">{err}</span>}
    </span>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="muted" style={{ padding: '12px 0' }}>{children}</p>;
}
