'use client';
import { useParams } from 'next/navigation';
import { api, naira, when } from '@/lib/api';
import { useLoad, Msg } from '@/components/ui';
import { DocShell } from '../../doc';

export default function ReceiptDoc() {
  const { id } = useParams<{ id: string }>();
  const { data: p, error } = useLoad(() => api.get<any>(`/payments/${id}/receipt`), [id]);
  if (error) return <Msg error={error} />;
  if (!p) return null;
  return (
    <DocShell title={p.status === 'REVERSED' ? 'Receipt (reversed)' : 'Receipt'} number={p.receipt_no} meta={[
      ['Received from', `${p.customer_name} (${p.customer_ref})`], ['Amount', <b className="num" style={{ fontSize: 18 }}>{naira(p.amount)}</b>],
      ['Method', `${p.method.toLowerCase().replace('_', ' ')}${p.reference ? ` · ref ${p.reference}` : ''}`], ['Confirmed', when(p.cleared_at)], ['Received by', p.received_by_name],
    ]}>
      <h3>Applied to</h3>
      <table><tbody>{p.allocations.map((a: any) => <tr key={a.invoice_no}><td className="num">{a.invoice_no}</td><td className="r num">{naira(a.amount)}</td><td className="r small muted">balance now {naira(a.balance)}</td></tr>)}</tbody></table>
      {p.unapplied > 0 && <p style={{ marginTop: 12 }}>Held on account as a deposit: <b className="num">{naira(p.unapplied)}</b></p>}
    </DocShell>
  );
}
