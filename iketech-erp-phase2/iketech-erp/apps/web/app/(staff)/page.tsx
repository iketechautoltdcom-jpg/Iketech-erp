'use client';
import Link from 'next/link';
import { useState } from 'react';
import { api, naira, when, STATUS_LABEL } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Plate, Pill, useLoad, Msg, Empty } from '@/components/ui';

const LANES: { title: string; statuses: string[] }[] = [
  { title: 'Intake & diagnosis', statuses: ['RECEIVED', 'DIAGNOSING'] },
  { title: 'Customer decision', statuses: ['QUOTE_PENDING', 'AWAITING_APPROVAL'] },
  { title: 'Workshop', statuses: ['APPROVED', 'IN_REPAIR', 'QC'] },
  { title: 'Billing', statuses: ['READY_TO_INVOICE', 'INVOICED'] },
  { title: 'Ready for collection', statuses: ['READY_FOR_COLLECTION'] },
];

export default function Board() {
  const { can } = useSession();
  const [q, setQ] = useState('');
  const jobs = useLoad(() => api.get<any[]>(`/jobs?status=OPEN${q ? `&q=${encodeURIComponent(q)}` : ''}`), [q]);
  const followUps = useLoad(() => api.get<any[]>('/jobs?status=DELIVERED'), []);
  const summary = useLoad(() => (can('reports.operational', 'reports.financial') ? api.get<any>('/reports/summary?period=today') : Promise.resolve(null)), [can('reports.operational', 'reports.financial')]);
  const s = summary.data;
  const list = jobs.data ?? [];
  const onHold = list.filter((j) => j.status === 'ON_HOLD');

  return (
    <>
      <div className="pagehead">
        <div><h1>Job board</h1><p>{list.length} open jobs in the workshop</p></div>
        <div className="row">
          <input type="search" placeholder="Search job no, plate or customer" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 280 }} aria-label="Search jobs" />
          {can('reception.create') && <Link href="/reception"><button className="primary">Receive a vehicle</button></Link>}
        </div>
      </div>

      {s && (
        <div className="kpis" aria-label="Today">
          <div className="kpi"><div className="v">{s.operations.vehiclesReceived}</div><div className="l">Received today</div></div>
          <div className="kpi"><div className="v">{s.operations.vehiclesDelivered}</div><div className="l">Delivered today</div></div>
          <div className="kpi"><div className="v">{s.operations.awaitingApproval}</div><div className="l">Awaiting customer approval</div></div>
          <div className={`kpi ${s.operations.delayedJobs ? 'flag' : ''}`}><div className="v">{s.operations.delayedJobs}</div><div className="l">Past promised time</div></div>
          {s.finance && <>
            <div className="kpi"><div className="v">{naira(s.finance.revenueEarned)}</div><div className="l">Revenue invoiced today (excl. VAT)</div></div>
            <div className="kpi"><div className="v">{naira(s.finance.cashCollected)}</div><div className="l">Cash collected today</div></div>
          </>}
        </div>
      )}

      <Msg error={jobs.error} />
      <div className="board">
        {LANES.map((lane) => {
          const items = list.filter((j) => lane.statuses.includes(j.status));
          return (
            <section className="lane" key={lane.title} aria-label={lane.title}>
              <h3><span>{lane.title}</span><span className="num">{items.length}</span></h3>
              {items.map((j) => {
                const late = j.promised_at && new Date(j.promised_at) < new Date() && j.status !== 'READY_FOR_COLLECTION';
                return (
                  <Link key={j.id} href={`/jobs/${j.id}`} className={`ticket ${late ? 'late' : ''}`}>
                    <div className="top"><Plate no={j.plate_no} /><span className="meta num" style={{ whiteSpace: 'nowrap' }}>No. {j.job_no.split('-').pop()}</span></div>
                    <div className="car">{j.make} {j.model}{j.year ? ` ${j.year}` : ''}</div>
                    <div className="meta">{j.customer_name}</div>
                    <div className="row" style={{ marginTop: 6, gap: 6 }}><Pill s={j.status} />{j.priority !== 'NORMAL' && <span className="pill stop">{j.priority.toLowerCase()}</span>}</div>
                    {late && <div className="meta" style={{ color: 'var(--stop)' }}>Promised {when(j.promised_at)}</div>}
                  </Link>
                );
              })}
              {!items.length && <p className="small muted" style={{ margin: 4 }}>None</p>}
            </section>
          );
        })}
      </div>

      <div className="grid2" style={{ marginTop: 20 }}>
        <section className="panel">
          <h2>On hold</h2>
          {onHold.length ? <table><tbody>{onHold.map((j) => (
            <tr key={j.id} className="click" onClick={() => (location.href = `/jobs/${j.id}`)}><td><Plate no={j.plate_no} /></td><td>{j.make} {j.model}</td><td>{j.customer_name}</td></tr>
          ))}</tbody></table> : <Empty>No jobs on hold.</Empty>}
        </section>
        <section className="panel">
          <h2>Follow-up calls due</h2>
          {followUps.data?.length ? <table><tbody>{followUps.data.map((j) => (
            <tr key={j.id} className="click" onClick={() => (location.href = `/jobs/${j.id}`)}><td><Plate no={j.plate_no} /></td><td>{j.customer_name}</td><td className="small muted">{j.phone_e164}</td></tr>
          ))}</tbody></table> : <Empty>No delivered vehicles waiting for a follow-up call.</Empty>}
        </section>
      </div>
    </>
  );
}
