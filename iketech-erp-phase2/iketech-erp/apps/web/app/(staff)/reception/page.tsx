'use client';
import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, errorText, ApiError } from '@/lib/api';
import { Plate, Msg } from '@/components/ui';

const LIGHTS = ['Check engine', 'ABS', 'Airbag', 'Battery / charging', 'Oil pressure', 'Coolant temperature', 'Brake', 'Tyre pressure', 'Traction control'];
const ACCESSORIES = ['Spare tyre', 'Jack and wheel spanner', 'Floor mats', 'Radio / head unit', 'Phone charger', 'Fire extinguisher', 'Warning triangle', 'Vehicle papers'];
const CHECKS = ['Exterior body', 'Glass and mirrors', 'Tyres and wheels', 'Lights', 'Interior', 'Under bonnet (visual)'];

export default function Reception() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [q, setQ] = useState('');
  const [results, setResults] = useState<any[] | null>(null);
  const [customer, setCustomer] = useState<any>(null);
  const [vehicle, setVehicle] = useState<any>(null);
  const [error, setError] = useState('');
  const [dups, setDups] = useState<any[] | null>(null);
  const [newCust, setNewCust] = useState({ type: 'INDIVIDUAL', name: '', companyName: '', phone: '', email: '', preferredChannel: 'WHATSAPP', consentMarketing: false });
  const [newVeh, setNewVeh] = useState({ plateNo: '', vin: '', make: '', model: '', year: '', colour: '', transmission: '' });
  const [warnings, setWarnings] = useState<string[]>([]);
  const [insp, setInsp] = useState({ mileageIn: '', fuelLevel: '1/2', lights: [] as string[], accessories: [] as string[], damage: '', complaint: '', requestedWork: '', priority: 'NORMAL', promisedAt: '', keyLocation: 'Reception key cabinet', ackMethod: 'SIGNATURE', ackName: '', checks: {} as Record<string, string> });
  const [busy, setBusy] = useState(false);

  async function search(e: FormEvent) {
    e.preventDefault(); setError('');
    try { setResults(await api.get(`/customers?q=${encodeURIComponent(q)}`)); } catch (err) { setError(errorText(err)); }
  }
  async function pick(id: string) {
    const c = await api.get(`/customers/${id}`);
    setCustomer(c); setStep(2); setResults(null);
  }
  async function createCustomer(confirm = false) {
    setError(''); setBusy(true);
    try {
      const c = await api.post('/customers', { ...newCust, companyName: newCust.companyName || undefined, email: newCust.email || undefined, confirmNotDuplicate: confirm });
      setDups(null); await pick(c.id);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'POSSIBLE_DUPLICATE') setDups(err.details.matches);
      else setError(errorText(err));
    } finally { setBusy(false); }
  }
  async function addVehicle(e: FormEvent) {
    e.preventDefault(); setError(''); setBusy(true);
    try {
      const v = await api.post(`/customers/${customer.id}/vehicles`, { ...newVeh, vin: newVeh.vin || undefined, year: newVeh.year ? Number(newVeh.year) : undefined, colour: newVeh.colour || undefined, transmission: newVeh.transmission || undefined });
      setWarnings(v.warnings ?? []); setVehicle(v); setStep(3);
    } catch (err) { setError(errorText(err)); } finally { setBusy(false); }
  }
  async function receive(e: FormEvent) {
    e.preventDefault(); setError(''); setBusy(true);
    try {
      const job = await api.post('/reception', {
        customerId: customer.id, vehicleId: vehicle.id, customerComplaint: insp.complaint, requestedWork: insp.requestedWork || undefined,
        priority: insp.priority, promisedAt: insp.promisedAt ? new Date(insp.promisedAt).toISOString() : undefined, keyLocation: insp.keyLocation,
        inspection: {
          mileageIn: Number(insp.mileageIn), fuelLevel: insp.fuelLevel, warningLights: insp.lights, accessories: insp.accessories,
          damageNotes: insp.damage.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const [area, ...rest] = l.split(':'); return rest.length ? { area: area.trim(), note: rest.join(':').trim() } : { area: 'General', note: l }; }),
          checklist: insp.checks, customerAck: insp.ackName ? { method: insp.ackMethod, name: insp.ackName } : undefined,
        },
      });
      router.push(`/jobs/${job.id}`);
    } catch (err) { setError(errorText(err)); setBusy(false); }
  }
  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  return (
    <>
      <div className="pagehead"><div><h1>Receive a vehicle</h1><p>Find or register the customer, pick the vehicle, then record its condition. This opens the job card.</p></div></div>
      <Msg error={error} />

      {step === 1 && (
        <div className="grid2" style={{ marginTop: 12 }}>
          <section className="panel">
            <h2>Returning customer</h2>
            <form className="row" onSubmit={search}>
              <input placeholder="Phone, name, plate or VIN" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1 }} aria-label="Search customers" />
              <button className="primary">Search</button>
            </form>
            {results && (results.length ? (
              <table style={{ marginTop: 12 }}><tbody>{results.map((c) => (
                <tr key={c.id} className="click" onClick={() => pick(c.id)}><td><b>{c.name}</b>{c.company_name && <div className="small muted">{c.company_name}</div>}</td><td className="small">{c.phone_e164}</td><td className="small muted">{c.vehicle_count} vehicle(s)</td></tr>
              ))}</tbody></table>
            ) : <p className="muted" style={{ marginTop: 12 }}>No match. Register them as a new customer.</p>)}
          </section>
          <section className="panel">
            <h2>New customer</h2>
            <div className="form">
              <div className="two">
                <label className="field">Type<select value={newCust.type} onChange={(e) => setNewCust({ ...newCust, type: e.target.value })}><option value="INDIVIDUAL">Individual</option><option value="CORPORATE">Company</option></select></label>
                <label className="field">Phone<input value={newCust.phone} onChange={(e) => setNewCust({ ...newCust, phone: e.target.value })} placeholder="0803 123 4567" /></label>
              </div>
              <label className="field">{newCust.type === 'CORPORATE' ? 'Contact person' : 'Full name'}<input value={newCust.name} onChange={(e) => setNewCust({ ...newCust, name: e.target.value })} /></label>
              {newCust.type === 'CORPORATE' && <label className="field">Company name<input value={newCust.companyName} onChange={(e) => setNewCust({ ...newCust, companyName: e.target.value })} /></label>}
              <div className="two">
                <label className="field">Email (optional)<input type="email" value={newCust.email} onChange={(e) => setNewCust({ ...newCust, email: e.target.value })} /></label>
                <label className="field">Preferred channel<select value={newCust.preferredChannel} onChange={(e) => setNewCust({ ...newCust, preferredChannel: e.target.value })}><option value="WHATSAPP">WhatsApp</option><option value="SMS">SMS</option><option value="EMAIL">Email</option><option value="PHONE">Phone call</option></select></label>
              </div>
              <label className="check"><input type="checkbox" checked={newCust.consentMarketing} onChange={(e) => setNewCust({ ...newCust, consentMarketing: e.target.checked })} /> Customer agrees to receive service offers</label>
              {dups && (
                <div className="alert warn">
                  <b>This may be an existing customer.</b>
                  <table style={{ margin: '8px 0' }}><tbody>{dups.map((d) => (
                    <tr key={d.id}><td>{d.name}</td><td>{d.phone_e164}</td><td><button className="link" onClick={() => pick(d.id)}>Use this customer</button></td></tr>
                  ))}</tbody></table>
                  <button onClick={() => createCustomer(true)} disabled={busy}>They are a different person — register anyway</button>
                </div>
              )}
              <button className="primary" onClick={() => createCustomer(false)} disabled={busy || !newCust.name || !newCust.phone}>Register customer</button>
            </div>
          </section>
        </div>
      )}

      {step === 2 && customer && (
        <section className="panel">
          <h2>Which vehicle? — {customer.name}</h2>
          {customer.vehicles.length > 0 && (
            <table style={{ marginBottom: 16 }}><tbody>{customer.vehicles.map((v: any) => (
              <tr key={v.id} className="click" onClick={() => { setVehicle(v); setStep(3); }}><td><Plate no={v.plate_no} /></td><td>{v.make} {v.model} {v.year}</td><td className="small muted">{v.vin ?? 'No VIN recorded'}</td><td className="small muted">{v.last_mileage ? `${v.last_mileage.toLocaleString()} km last visit` : ''}</td></tr>
            ))}</tbody></table>
          )}
          <h3 style={{ margin: '8px 0 12px' }}>Add a vehicle</h3>
          <form className="form" onSubmit={addVehicle}>
            <div className="three">
              <label className="field">Plate number<input required value={newVeh.plateNo} onChange={(e) => setNewVeh({ ...newVeh, plateNo: e.target.value })} placeholder="ABC 123 XY" /></label>
              <label className="field">Make<input required value={newVeh.make} onChange={(e) => setNewVeh({ ...newVeh, make: e.target.value })} /></label>
              <label className="field">Model<input required value={newVeh.model} onChange={(e) => setNewVeh({ ...newVeh, model: e.target.value })} /></label>
            </div>
            <div className="three">
              <label className="field">VIN (17 characters)<input value={newVeh.vin} maxLength={17} onChange={(e) => setNewVeh({ ...newVeh, vin: e.target.value.toUpperCase() })} /></label>
              <label className="field">Year<input inputMode="numeric" value={newVeh.year} onChange={(e) => setNewVeh({ ...newVeh, year: e.target.value })} /></label>
              <label className="field">Transmission<select value={newVeh.transmission} onChange={(e) => setNewVeh({ ...newVeh, transmission: e.target.value })}><option value="">—</option><option value="AUTOMATIC">Automatic</option><option value="MANUAL">Manual</option><option value="CVT">CVT</option><option value="DCT">Dual clutch</option></select></label>
            </div>
            <div className="row"><button className="primary" disabled={busy}>Add vehicle and continue</button><button type="button" className="link" onClick={() => setStep(1)}>Back</button></div>
          </form>
        </section>
      )}

      {step === 3 && vehicle && (
        <form className="panel form" onSubmit={receive}>
          <div className="row"><Plate no={vehicle.plate_no} big /><div><h2>{vehicle.make} {vehicle.model}</h2><span className="muted">{customer.name} · {customer.phone_e164}</span></div></div>
          {warnings.map((w) => <div key={w} className="alert warn">{w}</div>)}
          <label className="field">What the customer reports<textarea required value={insp.complaint} onChange={(e) => setInsp({ ...insp, complaint: e.target.value })} placeholder="In the customer's words: what happens, when, since when" /></label>
          <label className="field">Work the customer asked for (optional)<input value={insp.requestedWork} onChange={(e) => setInsp({ ...insp, requestedWork: e.target.value })} /></label>
          <div className="three">
            <label className="field">Mileage in (km)<input required inputMode="numeric" value={insp.mileageIn} onChange={(e) => setInsp({ ...insp, mileageIn: e.target.value.replace(/\D/g, '') })} /></label>
            <label className="field">Fuel level<select value={insp.fuelLevel} onChange={(e) => setInsp({ ...insp, fuelLevel: e.target.value })}>{['E', '1/4', '1/2', '3/4', 'F'].map((f) => <option key={f}>{f}</option>)}</select></label>
            <label className="field">Priority<select value={insp.priority} onChange={(e) => setInsp({ ...insp, priority: e.target.value })}><option value="LOW">Low</option><option value="NORMAL">Normal</option><option value="HIGH">High</option><option value="URGENT">Urgent</option></select></label>
          </div>
          <fieldset className="panel" style={{ padding: 14 }}><legend className="small"><b>Warning lights on</b></legend>
            <div className="grid3">{LIGHTS.map((l) => <label key={l} className="check"><input type="checkbox" checked={insp.lights.includes(l)} onChange={() => setInsp({ ...insp, lights: toggle(insp.lights, l) })} />{l}</label>)}</div>
          </fieldset>
          <fieldset className="panel" style={{ padding: 14 }}><legend className="small"><b>Items in the vehicle</b></legend>
            <div className="grid3">{ACCESSORIES.map((l) => <label key={l} className="check"><input type="checkbox" checked={insp.accessories.includes(l)} onChange={() => setInsp({ ...insp, accessories: toggle(insp.accessories, l) })} />{l}</label>)}</div>
          </fieldset>
          <fieldset className="panel" style={{ padding: 14 }}><legend className="small"><b>Walk-around check</b></legend>
            <div className="grid3">{CHECKS.map((c) => (
              <label key={c} className="field">{c}<select value={insp.checks[c] ?? 'NOT_CHECKED'} onChange={(e) => setInsp({ ...insp, checks: { ...insp.checks, [c]: e.target.value } })}><option value="NOT_CHECKED">Not checked</option><option value="OK">OK</option><option value="ATTENTION">Needs attention</option></select></label>
            ))}</div>
          </fieldset>
          <label className="field">Visible damage — one per line, e.g. "Rear bumper: scratch near left light"<textarea value={insp.damage} onChange={(e) => setInsp({ ...insp, damage: e.target.value })} /></label>
          <div className="three">
            <label className="field">Promised ready by (optional)<input type="datetime-local" value={insp.promisedAt} onChange={(e) => setInsp({ ...insp, promisedAt: e.target.value })} /></label>
            <label className="field">Keys stored at<input value={insp.keyLocation} onChange={(e) => setInsp({ ...insp, keyLocation: e.target.value })} /></label>
            <label className="field">Customer acknowledged by<select value={insp.ackMethod} onChange={(e) => setInsp({ ...insp, ackMethod: e.target.value })}><option value="SIGNATURE">Signature on job card</option><option value="OTP">One-time code</option><option value="VERBAL_RECORDED">Verbal, recorded</option></select></label>
          </div>
          <label className="field">Name of the person who acknowledged the inspection<input value={insp.ackName} onChange={(e) => setInsp({ ...insp, ackName: e.target.value })} /></label>
          <p className="small muted">Photos and videos of the vehicle can be attached on the job card after it opens.</p>
          <div className="row"><button className="primary" disabled={busy}>Open job card</button><button type="button" className="link" onClick={() => setStep(2)}>Back</button></div>
        </form>
      )}
    </>
  );
}
