'use client';
import { useState } from 'react';
import { api, naira, when } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useLoad, Msg, Pill, Action, Empty } from '@/components/ui';

const METHOD: Record<string, string> = { CASH: 'Cash', BANK_TRANSFER: 'Transfer', POS: 'POS', GATEWAY: 'Online', CHEQUE: 'Cheque' };

export default function Payments() {
  const { me, can } = useSession();
  const [status, setStatus] = useState('PENDING');
  const list = useLoad(() => api.get<any[]>(`/payments${status ? `?status=${status}` : ''}`), [status]);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  return (
    <>
      <div className="pagehead"><div><h1>Payments</h1><p>{status === 'PENDING' ? 'Transfers, POS and cheques waiting to be confirmed against the bank statement. They are not counted as cash until confirmed.' : 'Payment register'}</p></div>
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 220 }} aria-label="Filter"><option value="PENDING">Waiting for confirmation</option><option value="CLEARED">Confirmed</option><option value="">All</option></select></div>
      <Msg error={list.error} />
      <section className="panel">
        {list.data?.length ? <table><thead><tr><th>Received</th><th>Customer</th><th>Method</th><th>Reference</th><th className="r">Amount</th><th>Recorded by</th><th>Status</th><th /></tr></thead><tbody>{list.data.map((p) => (
          <tr key={p.id}>
            <td className="small">{when(p.received_at)}</td><td>{p.customer_name}{p.intended_invoice_no && <div className="small muted num">for {p.intended_invoice_no}</div>}</td>
            <td>{METHOD[p.method]}</td><td className="small num">{p.reference ?? '—'}</td><td className="r num">{naira(p.amount)}</td><td className="small">{p.received_by_name}</td>
            <td><Pill s={p.status} />{p.receipt_no && <div className="small"><a href={`/print/receipt/${p.id}`} target="_blank" rel="noreferrer" className="num">{p.receipt_no}</a></div>}</td>
            <td>{p.status === 'PENDING' && (p.received_by === me?.id ? <span className="small muted">Another person must confirm</span> : (
              <div className="row" style={{ gap: 6 }}>
                {can('payments.clear') && <Action className="primary" label="Confirmed in bank" run={() => api.post(`/payments/${p.id}/clear`)} onDone={list.reload} />}
                {can('payments.reverse') && <><input placeholder="Why it failed" value={reasons[p.id] ?? ''} onChange={(e) => setReasons({ ...reasons, [p.id]: e.target.value })} style={{ width: 150 }} aria-label="Failure reason" />
                  <Action className="danger" label="Not received" disabled={(reasons[p.id] ?? '').length < 5} run={() => api.post(`/payments/${p.id}/fail`, { reason: reasons[p.id] })} onDone={list.reload} /></>}
              </div>
            ))}</td>
          </tr>
        ))}</tbody></table> : <Empty>{status === 'PENDING' ? 'Nothing waiting for confirmation.' : 'No payments.'}</Empty>}
      </section>
    </>
  );
}
