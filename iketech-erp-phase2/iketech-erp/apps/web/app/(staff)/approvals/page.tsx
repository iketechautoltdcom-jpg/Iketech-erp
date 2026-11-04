'use client';
import Link from 'next/link';
import { api, when } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useLoad, Msg, Action, Empty } from '@/components/ui';

const KIND: Record<string, string> = {
  START_REPAIR_WITHOUT_APPROVAL: 'Start work before customer approval', SKIP_QC: 'Skip quality control',
  RELEASE_WITHOUT_PAYMENT: 'Release vehicle with balance due', MILEAGE_OVERRIDE: 'Accept mileage below last record', DISCOUNT_ABOVE_LIMIT: 'Discount above limit',
};

export default function Approvals() {
  const { me } = useSession();
  const list = useLoad(() => api.get<any[]>('/exceptions/pending'), []);
  return (
    <>
      <div className="pagehead"><div><h1>Approvals</h1><p>Requests to bypass a workflow gate. Each decision is recorded against your name. You cannot decide your own requests.</p></div></div>
      <Msg error={list.error} />
      <section className="panel">
        {list.data?.length ? <table><thead><tr><th>Job</th><th>Request</th><th>Reason</th><th>Asked by</th><th /></tr></thead><tbody>{list.data.map((e) => (
          <tr key={e.id}>
            <td><Link href={`/jobs/${e.job_id}`} className="num">{e.job_no}</Link><div className="small muted">{when(e.created_at)}</div></td>
            <td><b>{KIND[e.kind]}</b>{e.limit_amount != null && <div className="small">{e.limit_amount / 100}% discount</div>}</td>
            <td className="small" style={{ maxWidth: 360 }}>{e.reason}</td><td className="small">{e.requested_by_name}</td>
            <td>{e.requested_by === me?.id ? <span className="small muted">Your request</span> : <div className="row" style={{ gap: 6 }}>
              <Action className="gate" label="Authorise" run={() => api.post(`/exceptions/${e.id}/authorise`)} onDone={list.reload} />
              <Action label="Reject" run={() => api.post(`/exceptions/${e.id}/reject`)} onDone={list.reload} />
            </div>}</td>
          </tr>
        ))}</tbody></table> : <Empty>No requests waiting.</Empty>}
      </section>
    </>
  );
}
