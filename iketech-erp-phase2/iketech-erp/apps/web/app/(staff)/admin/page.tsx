'use client';
import { useState } from 'react';
import { api, when } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useLoad, Msg, Action, Pill } from '@/components/ui';

export default function Admin() {
  const { can } = useSession();
  const [tab, setTab] = useState(can('users.manage') ? 'users' : 'audit');
  return (
    <>
      <div className="pagehead"><div><h1>Administration</h1><p>Every change here is recorded in the audit trail.</p></div></div>
      <div className="tabs" role="tablist">
        {[['users', 'Users', can('users.manage')], ['settings', 'Settings & tax', can('settings.manage', 'audit.read')], ['audit', 'Audit trail', can('audit.read')]].filter((t) => t[2]).map(([k, l]) => (
          <button key={k as string} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k as string)}>{l}</button>
        ))}
      </div>
      {tab === 'users' && <Users />}
      {tab === 'settings' && <Settings />}
      {tab === 'audit' && <Audit />}
    </>
  );
}

function Users() {
  const users = useLoad(() => api.get<any[]>('/users'), []);
  const roles = useLoad(() => api.get<any[]>('/roles'), []);
  const [n, setN] = useState({ fullName: '', email: '', password: '', staffNo: '', department: 'Workshop', jobTitle: '', roles: [] as string[] });
  return (
    <div className="grid2">
      <section className="panel"><h2>Staff accounts</h2><Msg error={users.error} />
        <table><tbody>{users.data?.map((u) => (
          <tr key={u.id}><td><b>{u.fullName}</b><div className="small muted">{u.email}</div></td><td className="small">{u.roles.join(', ').replace(/_/g, ' ').toLowerCase()}</td><td><Pill s={u.status === 'ACTIVE' ? 'APPROVED' : 'CANCELLED'} label={u.status.toLowerCase()} /></td>
            <td><Action className="link" label={u.status === 'ACTIVE' ? 'Disable' : 'Enable'} confirm={u.status === 'ACTIVE' ? `Disable ${u.fullName}? They will be signed out.` : undefined} run={() => api.post(`/users/${u.id}/status`, { status: u.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE' })} onDone={users.reload} /></td></tr>
        ))}</tbody></table>
      </section>
      <section className="panel form"><h2>Add a staff member</h2>
        <div className="two"><label className="field">Full name<input value={n.fullName} onChange={(e) => setN({ ...n, fullName: e.target.value })} /></label><label className="field">Email<input type="email" value={n.email} onChange={(e) => setN({ ...n, email: e.target.value })} /></label></div>
        <div className="three"><label className="field">Staff no.<input value={n.staffNo} onChange={(e) => setN({ ...n, staffNo: e.target.value })} /></label><label className="field">Department<input value={n.department} onChange={(e) => setN({ ...n, department: e.target.value })} /></label><label className="field">Job title<input value={n.jobTitle} onChange={(e) => setN({ ...n, jobTitle: e.target.value })} /></label></div>
        <label className="field">Temporary password (12+ characters, letters and numbers)<input type="password" autoComplete="new-password" value={n.password} onChange={(e) => setN({ ...n, password: e.target.value })} /></label>
        <fieldset style={{ border: 0, padding: 0 }}><legend className="small"><b>Roles</b></legend>
          {roles.data?.map((r) => <label key={r.code} className="check"><input type="checkbox" checked={n.roles.includes(r.code)} onChange={() => setN({ ...n, roles: n.roles.includes(r.code) ? n.roles.filter((x) => x !== r.code) : [...n.roles, r.code] })} />{r.name}</label>)}
        </fieldset>
        <div><Action className="primary" label="Create account" run={() => api.post('/users', n)} onDone={() => { setN({ ...n, fullName: '', email: '', password: '', staffNo: '', jobTitle: '', roles: [] }); users.reload(); }} /></div>
      </section>
    </div>
  );
}

function Settings() {
  const { can } = useSession();
  const settings = useLoad(() => api.get<any[]>('/settings'), []);
  const taxes = useLoad(() => api.get<any[]>('/tax-configurations'), []);
  const [edit, setEdit] = useState<Record<string, string>>({});
  const [tax, setTax] = useState({ taxCode: 'VAT_STANDARD', name: 'VAT — standard rate', ratePercent: '', effectiveFrom: '' });
  const confirmed = settings.data?.find((s) => s.key === 'tax.confirmed_by_adviser')?.value;
  return (
    <>
      {confirmed === false && <div className="alert warn" style={{ marginBottom: 16 }}>The tax setup has not yet been confirmed by a qualified Nigerian tax professional. Do not use invoices for filing until it is, then switch “tax.confirmed_by_adviser” on.</div>}
      <div className="grid2">
        <section className="panel"><h2>Business settings</h2><Msg error={settings.error} />
          <table><tbody>{settings.data?.map((s) => (
            <tr key={s.key}><td><b className="small num">{s.key}</b><div className="small muted">{s.description}</div></td>
              <td style={{ width: 200 }}>{can('settings.manage') ? <div className="row" style={{ gap: 6 }}>
                <input value={edit[s.key] ?? JSON.stringify(s.value)} onChange={(e) => setEdit({ ...edit, [s.key]: e.target.value })} aria-label={s.key} />
                {edit[s.key] !== undefined && <Action label="Save" run={() => api.put(`/settings/${s.key}`, { value: JSON.parse(edit[s.key]) })} onDone={() => { setEdit({ ...edit, [s.key]: undefined as any }); settings.reload(); }} />}
              </div> : <span className="num">{JSON.stringify(s.value)}</span>}</td></tr>
          ))}</tbody></table>
          <p className="small muted" style={{ marginTop: 8 }}>Values are JSON: numbers as 7, money in kobo (₦15,000 = 1500000), true/false, or null.</p>
        </section>
        <section className="panel"><h2>Tax rates</h2>
          <table><thead><tr><th>Code</th><th className="r">Rate</th><th>From</th><th>To</th></tr></thead><tbody>{taxes.data?.map((t) => (
            <tr key={t.id}><td>{t.name}<div className="small muted num">{t.tax_code}</div></td><td className="r num">{(t.rate_bp / 100).toFixed(2)}%</td><td className="small">{String(t.effective_from).slice(0, 10)}</td><td className="small">{t.effective_to ? String(t.effective_to).slice(0, 10) : 'open'}</td></tr>
          ))}</tbody></table>
          {can('settings.manage') && <div className="form" style={{ marginTop: 12 }}>
            <h3>Schedule a rate change</h3>
            <div className="two"><label className="field">Tax code<input value={tax.taxCode} onChange={(e) => setTax({ ...tax, taxCode: e.target.value.toUpperCase() })} /></label><label className="field">Name<input value={tax.name} onChange={(e) => setTax({ ...tax, name: e.target.value })} /></label></div>
            <div className="two"><label className="field">Rate %<input inputMode="decimal" value={tax.ratePercent} onChange={(e) => setTax({ ...tax, ratePercent: e.target.value })} /></label><label className="field">Effective from<input type="date" value={tax.effectiveFrom} onChange={(e) => setTax({ ...tax, effectiveFrom: e.target.value })} /></label></div>
            <div><Action label="Add rate" run={() => api.post('/tax-configurations', { ...tax, ratePercent: Number(tax.ratePercent) })} onDone={taxes.reload} /></div>
          </div>}
        </section>
      </div>
    </>
  );
}

function Audit() {
  const log = useLoad(() => api.get<any[]>('/audit?limit=300'), []);
  const [verify, setVerify] = useState<any>(null);
  return (
    <section className="panel">
      <div className="row"><h2>Audit trail</h2><span className="spacer" />
        <Action label="Verify integrity" run={async () => setVerify(await api.get('/audit/verify'))} />
      </div>
      {verify && <div className={`alert ${verify.intact ? 'ok' : 'err'}`} style={{ margin: '12px 0' }}>{verify.intact ? `All ${verify.rows} audit records verify. No record has been altered or removed.` : `Tampering detected at record ${verify.brokenAtSeq}. Escalate to the CEO immediately.`}</div>}
      <Msg error={log.error} />
      <table style={{ marginTop: 12 }}><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Record</th></tr></thead><tbody>{log.data?.map((a) => (
        <tr key={a.seq}><td className="small num">{when(a.at)}</td><td className="small">{a.actor ?? 'System'}</td><td><b className="small">{a.action}</b></td><td className="small muted num">{a.entity} {a.entity_id?.slice(0, 8)}</td></tr>
      ))}</tbody></table>
    </section>
  );
}
