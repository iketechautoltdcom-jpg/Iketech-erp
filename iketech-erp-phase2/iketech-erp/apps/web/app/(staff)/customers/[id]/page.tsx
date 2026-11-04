'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { api, naira, day } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useLoad, Msg, Pill, Plate, Action, Empty } from '@/components/ui';

export default function Customer() {
  const { id } = useParams<{ id: string }>();
  const { can } = useSession();
  const c = useLoad(() => api.get<any>(`/customers/${id}`), [id]);
  const [credit, setCredit] = useState<{ limit: string; days: string } | null>(null);
  const d = c.data;
  if (c.error) return <Msg error={c.error} />;
  if (!d) return <p className="muted">Loading…</p>;
  return (
    <>
      <div className="pagehead"><div><h1>{d.name}</h1><p className="num">{d.ref} · {d.type === 'CORPORATE' ? d.company_name : 'Individual'} · {d.phone_e164}{d.email ? ` · ${d.email}` : ''}</p></div></div>
      <div className="kpis">
        <div className="kpi"><div className="v">{d.vehicles.length}</div><div className="l">Vehicles</div></div>
        <div className="kpi"><div className="v">{d.jobs.length}</div><div className="l">Visits</div></div>
        <div className="kpi"><div className="v">{naira(d.outstanding)}</div><div className="l">Owes</div></div>
        <div className={`kpi ${d.overdue ? 'flag' : ''}`}><div className="v">{naira(d.overdue)}</div><div className="l">Overdue</div></div>
        <div className="kpi"><div className="v">{d.credit_limit ? naira(d.credit_limit) : 'None'}</div><div className="l">Credit limit{d.payment_terms_days ? ` · ${d.payment_terms_days} days` : ''}</div></div>
      </div>
      <div className="grid2">
        <section className="panel"><h2>Vehicles</h2>
          {d.vehicles.length ? <table><tbody>{d.vehicles.map((v: any) => (
            <tr key={v.id}><td><Plate no={v.plate_no} /></td><td>{v.make} {v.model} {v.year}</td><td className="small muted num">{v.vin ?? ''}</td><td className="small muted num">{v.last_mileage ? `${v.last_mileage.toLocaleString()} km` : ''}</td></tr>
          ))}</tbody></table> : <Empty>No vehicles.</Empty>}
        </section>
        <section className="panel"><h2>Contact preferences</h2>
          <dl className="facts">
            <dt>Preferred channel</dt><dd>{d.preferred_channel.toLowerCase()}</dd><dt>Service messages</dt><dd>{d.consent_service ? 'Agreed' : 'Declined'}</dd>
            <dt>Offers</dt><dd>{d.consent_marketing ? 'Agreed' : 'Not agreed'}</dd><dt>Address</dt><dd>{d.address ?? '—'}</dd><dt>TIN</dt><dd>{d.tin ?? '—'}</dd>
          </dl>
          {can('payments.clear') && (credit ? (
            <div className="form" style={{ marginTop: 12 }}>
              <div className="two"><label className="field">Credit limit ₦<input inputMode="decimal" value={credit.limit} onChange={(e) => setCredit({ ...credit, limit: e.target.value })} /></label>
                <label className="field">Payment terms (days)<input inputMode="numeric" value={credit.days} onChange={(e) => setCredit({ ...credit, days: e.target.value })} /></label></div>
              <div><Action className="primary" label="Save credit terms" run={() => api.patch(`/customers/${id}/credit`, { creditLimitNaira: Number(credit.limit), paymentTermsDays: Number(credit.days) })} onDone={() => { setCredit(null); c.reload(); }} /></div>
            </div>
          ) : <button style={{ marginTop: 12 }} onClick={() => setCredit({ limit: String(d.credit_limit / 100), days: String(d.payment_terms_days) })}>Change credit terms</button>)}
        </section>
      </div>
      <section className="panel"><h2>Service history</h2>
        {d.jobs.length ? <table><thead><tr><th>Job</th><th>Vehicle</th><th>Concern</th><th>Received</th><th>Status</th></tr></thead><tbody>{d.jobs.map((j: any) => (
          <tr key={j.id} className="click" onClick={() => (location.href = `/jobs/${j.id}`)}><td><Link href={`/jobs/${j.id}`} className="num">{j.job_no}</Link></td><td><Plate no={j.plate_no} /></td><td className="small">{j.customer_complaint}</td><td className="small">{day(j.received_at)}</td><td><Pill s={j.status} /></td></tr>
        ))}</tbody></table> : <Empty>No visits yet.</Empty>}
      </section>
    </>
  );
}
