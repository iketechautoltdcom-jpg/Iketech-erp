'use client';
import { useState } from 'react';
import { api, naira, day, lagosDay } from '@/lib/api';
import { useLoad, Msg, Pill, Empty } from '@/components/ui';

export default function Invoices() {
  const [status, setStatus] = useState('OPEN');
  const list = useLoad(() => api.get<any[]>(`/invoices${status ? `?status=${status}` : ''}`), [status]);
  const total = (list.data ?? []).reduce((s, i) => s + Number(i.balance), 0);
  return (
    <>
      <div className="pagehead"><div><h1>Invoices</h1><p>{status === 'OPEN' ? 'Unpaid and part-paid' : status === 'OVERDUE' ? 'Past due date' : 'All'} · {naira(total)} outstanding in this list</p></div>
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ width: 200 }} aria-label="Filter"><option value="OPEN">Unpaid</option><option value="OVERDUE">Overdue</option><option value="">All invoices</option></select></div>
      <Msg error={list.error} />
      <section className="panel">
        {list.data?.length ? <table><thead><tr><th>Invoice</th><th>Customer</th><th>Job</th><th>Issued</th><th>Due</th><th className="r">Total</th><th className="r">Balance</th><th>Status</th></tr></thead><tbody>{list.data.map((i) => {
          const overdue = Number(i.balance) > 0 && lagosDay(i.due_date) < lagosDay(new Date().toISOString());
          return (
            <tr key={i.id} className="click" onClick={() => window.open(`/print/invoice/${i.id}`, '_blank')}>
              <td className="num">{i.invoice_no}</td><td>{i.customer_name}</td><td className="num small">{i.job_no}</td><td className="small">{day(i.issue_date)}</td>
              <td className="small" style={overdue ? { color: 'var(--stop)', fontWeight: 600 } : undefined}>{day(i.due_date)}</td>
              <td className="r num">{naira(i.total)}</td><td className="r num">{naira(i.balance)}</td><td><Pill s={overdue ? 'OVERDUE' : i.status} label={overdue ? 'Overdue' : undefined} /></td>
            </tr>
          );
        })}</tbody></table> : <Empty>No invoices in this list.</Empty>}
      </section>
    </>
  );
}
