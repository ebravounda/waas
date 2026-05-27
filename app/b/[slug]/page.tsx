/* eslint-disable @next/next/no-img-element */
'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';

type Business = {
  id: number; slug: string; name: string; type: string; timezone: string;
  address?: string | null; phone?: string | null; logoUrl?: string | null;
  primaryColor?: string | null; description?: string | null;
};
type Service = { id: number; name: string; durationMin: number; priceCents: number; currency: string; description?: string | null };

export default function PublicBookingPage() {
  const { slug } = useParams<{ slug: string }>();
  const [biz, setBiz] = useState<Business | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [selectedService, setSelectedService] = useState<Service | null>(null);
  const [date, setDate] = useState<string>('');
  const [slots, setSlots] = useState<string[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<string>('');
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [form, setForm] = useState({ customerName: '', customerPhone: '', customerEmail: '', notes: '' });
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    fetch(`/api/public/booking/${slug}`).then(r => r.json()).then((d) => {
      if (d.business) { setBiz(d.business); setServices(d.services || []); }
    });
  }, [slug]);

  useEffect(() => {
    if (!selectedService || !date) { setSlots([]); return; }
    setLoadingSlots(true);
    fetch(`/api/public/booking/${slug}?serviceId=${selectedService.id}&date=${date}`)
      .then(r => r.json())
      .then(d => { setSlots(d.slots || []); setSelectedSlot(''); })
      .finally(() => setLoadingSlots(false));
  }, [selectedService, date, slug]);

  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), []);
  const accent = biz?.primaryColor || '#0ea5e9';

  const submit = async () => {
    if (!selectedService || !date || !selectedSlot) { setErrorMsg('Selecciona servicio, fecha y hora'); return; }
    if (!form.customerName || !form.customerPhone) { setErrorMsg('Nombre y teléfono son obligatorios'); return; }
    setErrorMsg(''); setSubmitting(true);
    try {
      const res = await fetch(`/api/public/booking/${slug}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serviceId: selectedService.id, date, time: selectedSlot, ...form }),
      });
      const d = await res.json();
      if (!res.ok) { setErrorMsg(d.error || 'Error'); return; }
      setDone(true);
    } finally { setSubmitting(false); }
  };

  if (!biz) return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui' }}>Cargando…</div>;

  if (done) return (
    <div style={{ minHeight: '100vh', background: '#fafafa', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <div style={{ maxWidth: 540, margin: '0 auto', padding: '60px 20px', textAlign: 'center' }}>
        <div style={{ fontSize: 56 }}>✅</div>
        <h1 style={{ fontSize: 28, marginTop: 16 }}>¡Reserva confirmada!</h1>
        <p style={{ color: '#555', marginTop: 8 }}>Te enviamos la confirmación por WhatsApp al {form.customerPhone}.</p>
        <p style={{ color: '#888', fontSize: 14, marginTop: 16 }}>Si necesitas reprogramar o cancelar, responde al mensaje de WhatsApp.</p>
        <button onClick={() => { setDone(false); setSelectedService(null); setSelectedSlot(''); setDate(''); setForm({ customerName: '', customerPhone: '', customerEmail: '', notes: '' }); }} style={{ marginTop: 24, padding: '10px 24px', background: accent, color: '#fff', border: 0, borderRadius: 8, cursor: 'pointer' }}>Hacer otra reserva</button>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight: '100vh', background: '#fafafa', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <header style={{ background: accent, color: '#fff', padding: '36px 20px' }}>
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          {biz.logoUrl && <img src={biz.logoUrl} alt={biz.name} style={{ height: 64, marginBottom: 12 }} />}
          <h1 style={{ fontSize: 32, margin: 0 }}>{biz.name}</h1>
          {biz.description && <p style={{ marginTop: 8, opacity: 0.9 }}>{biz.description}</p>}
          {biz.address && <p style={{ marginTop: 4, opacity: 0.85, fontSize: 14 }}>📍 {biz.address}</p>}
        </div>
      </header>

      <main style={{ maxWidth: 720, margin: '0 auto', padding: 24 }}>
        <section style={{ background: '#fff', borderRadius: 12, padding: 20, marginBottom: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
          <h2 style={{ marginTop: 0, fontSize: 18 }}>1. Elige un servicio</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
            {services.map(s => {
              const isSel = selectedService?.id === s.id;
              return (
                <button key={s.id} onClick={() => setSelectedService(s)} style={{ textAlign: 'left', padding: 14, border: `2px solid ${isSel ? accent : '#e5e5e5'}`, borderRadius: 10, background: isSel ? `${accent}10` : '#fff', cursor: 'pointer' }} data-testid={`service-${s.id}`}>
                  <div style={{ fontWeight: 600 }}>{s.name}</div>
                  <div style={{ fontSize: 13, color: '#666', marginTop: 4 }}>{s.durationMin} min · {s.priceCents ? `${(s.priceCents / 100).toFixed(2)} ${s.currency}` : 'Gratis'}</div>
                  {s.description && <div style={{ fontSize: 12, color: '#888', marginTop: 6 }}>{s.description}</div>}
                </button>
              );
            })}
          </div>
        </section>

        {selectedService && (
          <section style={{ background: '#fff', borderRadius: 12, padding: 20, marginBottom: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
            <h2 style={{ marginTop: 0, fontSize: 18 }}>2. Elige fecha y hora</h2>
            <input type="date" min={todayStr} value={date} onChange={e => setDate(e.target.value)} style={{ padding: 10, fontSize: 16, border: '1px solid #ddd', borderRadius: 8, width: '100%', maxWidth: 240 }} data-testid="booking-date" />
            {date && (
              <div style={{ marginTop: 16 }}>
                {loadingSlots ? <div style={{ color: '#888' }}>Buscando horarios…</div> : slots.length === 0 ? <div style={{ color: '#888' }}>No hay horarios disponibles para esta fecha.</div> : (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {slots.map(s => (
                      <button key={s} onClick={() => setSelectedSlot(s)} style={{ padding: '8px 14px', border: `2px solid ${selectedSlot === s ? accent : '#e5e5e5'}`, background: selectedSlot === s ? accent : '#fff', color: selectedSlot === s ? '#fff' : '#222', borderRadius: 8, cursor: 'pointer', fontSize: 14 }} data-testid={`slot-${s}`}>{s}</button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {selectedSlot && (
          <section style={{ background: '#fff', borderRadius: 12, padding: 20, marginBottom: 16, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
            <h2 style={{ marginTop: 0, fontSize: 18 }}>3. Tus datos</h2>
            <div style={{ display: 'grid', gap: 10 }}>
              <input placeholder="Nombre completo" value={form.customerName} onChange={e => setForm({ ...form, customerName: e.target.value })} style={inputStyle} data-testid="customer-name" />
              <input placeholder="Teléfono WhatsApp (ej: 34600850506)" value={form.customerPhone} onChange={e => setForm({ ...form, customerPhone: e.target.value })} style={inputStyle} data-testid="customer-phone" />
              <input placeholder="Email (opcional)" value={form.customerEmail} onChange={e => setForm({ ...form, customerEmail: e.target.value })} style={inputStyle} />
              <textarea placeholder="Notas (opcional)" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2} style={{ ...inputStyle, fontFamily: 'inherit', resize: 'vertical' }} />
            </div>
            {errorMsg && <div style={{ color: '#dc2626', marginTop: 12, fontSize: 14 }}>{errorMsg}</div>}
            <button onClick={submit} disabled={submitting} style={{ marginTop: 16, padding: '12px 28px', background: accent, color: '#fff', border: 0, borderRadius: 8, cursor: 'pointer', fontSize: 16, fontWeight: 600, opacity: submitting ? 0.6 : 1 }} data-testid="confirm-booking-btn">{submitting ? 'Reservando…' : 'Confirmar reserva'}</button>
          </section>
        )}
      </main>
    </div>
  );
}

const inputStyle: React.CSSProperties = { padding: 10, fontSize: 15, border: '1px solid #ddd', borderRadius: 8, outline: 'none' };
