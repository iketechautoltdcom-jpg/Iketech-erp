'use client';
import { useParams } from 'next/navigation';
import { api, naira, day } from '@/lib/api';
import { useLoad, Msg, Plate } from '@/components/ui';
import { DocShell, Lines } from '../../doc';

export default function InvoiceDoc() {
  const { id } = useParams<{ id: string }>();
  const { data: i, error } = useLoad(() => api.get<any>(`/invoices/${id}`), [id]);
  if (error) return <Msg error={error} />;
  if (!i) return null;
  return (
    <DocShell title="Tax invoice" number={i.invoice_no} meta={[
      ['Billed to', <>{i.company_name ?? i.customer_name}{i.company_name && <div className="small">Attn: {i.customer_name}</div>}{i.tin && <div className="small">TIN {i.tin}</div>}<div className="small">{i.phone_e164}</div></>],
      ['Vehicle', <><Plate no={i.plate_no} /> {i.make} {i.model}{i.vin ? <span className="small num"> · VIN {i.vin}</span> : null}</>],
      ['Job', <span className="num">{i.job_no}</span>], ['Issued', day(i.issue_date)], ['Due', day(i.due_date)],
    ]}>
      <Lines items={i.items} totals={{ subtotal: i.subtotal, discount: i.discount_total, tax: i.tax_total, total: i.total }} />
      <section style={{ marginTop: 20 }}>
        <h3>Payments received</h3>
        {i.allocations.length ? <table><tbody>{i.allocations.map((a: any) => <tr key={a.id}><td className="num">{a.receipt_no}</td><td>{a.method.toLowerCase().replace('_', ' ')}</td><td>{day(a.cleared_at)}</td><td className="r num">{naira(a.amount)}</td></tr>)}</tbody></table> : <p className="muted">None yet.</p>}
        <p style={{ fontSize: 18, marginTop: 12 }}><b>Balance due: <span className="num">{naira(i.balance)}</span></b></p>
      </section>
    </DocShell>
  );
}
