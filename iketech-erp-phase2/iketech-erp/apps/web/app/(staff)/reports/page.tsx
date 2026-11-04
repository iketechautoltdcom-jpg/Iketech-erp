'use client';
import { useState } from 'react';
import { api, naira, STATUS_LABEL } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useLoad, Msg } from '@/components/ui';

export default function Reports() {
  const { can } = useSession();
  const [period, setPeriod] = useState('month');
  const [range, setRange] = useState({ from: '', to: '' });
  const qs = period === 'custom' ? `period=custom&from=${range.from}&to=${range.to}` : `period=${period}`;
  const s = useLoad(() => (period === 'custom' && (!range.from || !range.to) ? Promise.resolve(null) : api.get<any>(`/reports/summary?${qs}`)), [qs]);
  const tb = useLoad(() => (can('reports.financial') ? api.get<any>('/reports/trial-balance') : Promise.resolve(null)), [can('reports.financial')]);
  const d = s.data;
  const recon = d?.reconciliation;
  return (
    <>
      <div className="pagehead"><div><h1>Reports</h1><p>Revenue comes from invoices issued; cash from payments confirmed. They are kept separate and checked against the ledger.</p></div>
        <div className="row">
          <select value={period} onChange={(e) => setPeriod(e.target.value)} style={{ width: 160 }} aria-label="Period">
            <option value="today">Today</option><option value="week">This week</option><option value="month">This month</option><option value="quarter">This quarter</option><option value="year">This year</option><option value="custom">Custom dates</option>
          </select>
          {period === 'custom' && <><input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} aria-label="From" /><input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} aria-label="To" /></>}
          <button onClick={() => window.print()}>Print</button>
        </div>
      </div>
      <Msg error={s.error} />
      {d && <>
        <h2 style={{ margin: '8px 0 10px' }}>Workshop</h2>
        <div className="kpis">
          <div className="kpi"><div className="v">{d.operations.vehiclesReceived}</div><div className="l">Vehicles received</div></div>
          <div className="kpi"><div className="v">{d.operations.vehiclesDelivered}</div><div className="l">Vehicles delivered</div></div>
          <div className="kpi"><div className="v">{d.operations.avgDiagnosisHours ?? '—'}</div><div className="l">Avg. hours to diagnosis</div></div>
          <div className="kpi"><div className="v">{d.operations.avgRepairHours ?? '—'}</div><div className="l">Avg. repair hours</div></div>
          <div className="kpi"><div className="v">{d.operations.qcFailureRatePct == null ? '—' : `${d.operations.qcFailureRatePct}%`}</div><div className="l">QC failure rate ({d.operations.qcInspections} inspections)</div></div>
          <div className={`kpi ${d.operations.delayedJobs ? 'flag' : ''}`}><div className="v">{d.operations.delayedJobs}</div><div className="l">Jobs past promised time</div></div>
        </div>
        <section className="panel" style={{ marginBottom: 20 }}><h2>Open jobs by stage</h2>
          <table><tbody>{Object.entries(d.operations.openJobsByStatus).map(([k, v]) => <tr key={k}><td>{STATUS_LABEL[k]}</td><td className="r num">{v as number}</td></tr>)}</tbody></table>
        </section>
        {d.finance && <>
          <h2 style={{ margin: '8px 0 10px' }}>Money</h2>
          <div className="kpis">
            <div className="kpi"><div className="v">{naira(d.finance.revenueEarned)}</div><div className="l">Revenue earned (excl. VAT)</div></div>
            <div className="kpi"><div className="v">{naira(d.finance.cashCollected)}</div><div className="l">Cash collected</div></div>
            <div className="kpi"><div className="v">{naira(d.finance.outstandingReceivables)}</div><div className="l">Owed by customers (now)</div></div>
            <div className={`kpi ${d.finance.overdueReceivables ? 'flag' : ''}`}><div className="v">{naira(d.finance.overdueReceivables)}</div><div className="l">Overdue (now)</div></div>
            <div className="kpi"><div className="v">{naira(d.finance.customerDeposits)}</div><div className="l">Customer deposits held</div></div>
            <div className="kpi"><div className="v">{naira(d.finance.vatPayable)}</div><div className="l">Output VAT (ledger)</div></div>
          </div>
          <div className="grid2">
            <section className="panel"><h2>Overdue ageing</h2>
              <table><tbody>{Object.entries(d.finance.ageing).map(([k, v]) => <tr key={k}><td>{k} days</td><td className="r num">{naira(v as number)}</td></tr>)}</tbody></table>
            </section>
            <section className="panel"><h2>Ledger checks</h2>
              {[['Revenue matches ledger', recon.revenueMatchesLedger], ['Cash matches ledger', recon.cashMatchesLedger], ['Receivables match ledger', recon.receivablesMatchLedger], ['Trial balance balanced', tb.data?.balanced]].map(([l, ok]) => (
                <div key={l as string} className="row" style={{ padding: '6px 0' }}><span className={`pill ${ok ? 'go' : 'stop'}`}>{ok ? 'Matches' : 'Check'}</span>{l}</div>
              ))}
            </section>
          </div>
          {tb.data && <section className="panel"><h2>Trial balance (all time)</h2>
            <table><thead><tr><th>Account</th><th className="r">Debit</th><th className="r">Credit</th><th className="r">Balance</th></tr></thead><tbody>{tb.data.accounts.map((a: any) => (
              <tr key={a.code}><td><span className="num">{a.code}</span> {a.name}</td><td className="r num">{naira(a.debit)}</td><td className="r num">{naira(a.credit)}</td><td className="r num">{naira(a.balance)}</td></tr>
            ))}</tbody><tfoot><tr><td>Total</td><td className="r num">{naira(tb.data.totalDebit)}</td><td className="r num">{naira(tb.data.totalCredit)}</td><td /></tr></tfoot></table>
          </section>}
        </>}
      </>}
    </>
  );
}
