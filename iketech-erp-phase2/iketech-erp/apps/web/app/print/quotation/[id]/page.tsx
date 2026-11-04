'use client';
import { useParams } from 'next/navigation';
import { api, day } from '@/lib/api';
import { useLoad, Msg, Plate } from '@/components/ui';
import { DocShell, Lines } from '../../doc';

export default function QuoteDoc() {
  const { id } = useParams<{ id: string }>();
  const { data, error } = useLoad(async () => { const q = await api.get<any>(`/quotations/${id}`); const job = await api.get<any>(`/jobs/${q.job_id}`); return { q, job }; }, [id]);
  if (error) return <Msg error={error} />;
  if (!data) return null;
  const { q, job } = data;
  const report = job.diagnosticReports.find((r: any) => r.status === 'SUBMITTED');
  return (
    <DocShell title={q.is_supplementary ? 'Supplementary quotation' : 'Quotation'} number={`${q.quote_no} v${q.version}`} meta={[
      ['Customer', <>{job.customer_name}<div className="small">{job.phone_e164}</div></>],
      ['Vehicle', <><Plate no={job.plate_no} /> {job.make} {job.model} {job.year}</>],
      ['Job', <span className="num">{job.job_no}</span>], ['Valid until', day(q.valid_until)],
    ]}>
      {report && <section style={{ marginBottom: 20 }}><h3>What we found</h3><p>{report.root_cause}</p><h3>What we recommend</h3><p>{report.recommended_repair}</p>{report.safety_notes && <p className="small">Safety: {report.safety_notes}</p>}</section>}
      <Lines items={q.items} totals={{ subtotal: q.subtotal, discount: q.discount_total, tax: q.tax_total, total: q.total }} />
      <p className="small muted" style={{ marginTop: 20 }}>No chargeable work starts until you approve. You may approve all or some lines. If we find additional work, we will send a supplementary quotation for your approval first.</p>
    </DocShell>
  );
}
