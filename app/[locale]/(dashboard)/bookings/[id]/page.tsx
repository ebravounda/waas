'use client';

import { use, useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { ArrowLeft, Plus, Trash2, ExternalLink, Copy, Pencil, Calendar, Clock, Scissors, Users, Save } from 'lucide-react';
import { toast } from 'sonner';

const fetcher = (url: string) => fetch(url).then(r => r.json());

const WEEKDAYS = [
  { i: 0, label: 'Domingo' },
  { i: 1, label: 'Lunes' },
  { i: 2, label: 'Martes' },
  { i: 3, label: 'Miércoles' },
  { i: 4, label: 'Jueves' },
  { i: 5, label: 'Viernes' },
  { i: 6, label: 'Sábado' },
];

type Service = {
  id: number;
  name: string;
  durationMin: number;
  priceCents: number;
  currency: string;
  description: string | null;
  isActive: boolean;
  sortOrder: number;
};
type Hour = { id?: number; weekday: number; openTime: string; closeTime: string; isClosed: boolean };
type Business = {
  id: number; slug: string; name: string; type: string; timezone: string;
  address: string | null; phone: string | null; primaryColor: string | null;
  description: string | null; isActive: boolean; bookingNoticeMinutes: number | null;
};
type Appointment = {
  id: number; customerName: string; customerPhone: string; customerEmail: string | null;
  startAt: string; endAt: string; status: string; notes: string | null;
  serviceName: string | null; durationMin: number | null; source: string;
};

const STATUS_BADGES: Record<string, { label: string; cls: string }> = {
  confirmed: { label: 'Confirmada', cls: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300' },
  completed: { label: 'Completada', cls: 'bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300' },
  cancelled: { label: 'Cancelada', cls: 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300' },
  no_show:   { label: 'No-show', cls: 'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300' },
  checked_in:  { label: 'Check-in', cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300' },
  checked_out: { label: 'Check-out', cls: 'bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-300' },
};

export default function ManageBusinessPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const businessId = parseInt(id, 10);
  const rootDomain = (typeof window !== 'undefined' && (window as any).__ROOT_DOMAIN__) || 'mitiendapro.com';

  const { data, mutate, isLoading } = useSWR<{ business: Business; services: Service[]; hours: Hour[] }>(
    `/api/businesses/${businessId}`,
    fetcher
  );

  if (isLoading) return <div className="p-6 text-muted-foreground">Cargando...</div>;
  if (!data?.business) return (
    <div className="p-6">
      <Link href="/bookings" className="text-sm text-primary underline">← Volver</Link>
      <p className="mt-3 text-muted-foreground">Negocio no encontrado.</p>
    </div>
  );

  const b = data.business;
  const publicUrl = `https://${b.slug}.${rootDomain}`;

  return (
    <div className="p-6 max-w-6xl mx-auto" data-testid="business-detail-page">
      <div className="mb-4">
        <Link href="/bookings" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
          <ArrowLeft className="h-4 w-4" /> Volver a negocios
        </Link>
      </div>

      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold" style={{ color: b.primaryColor || undefined }}>{b.name}</h1>
          <div className="text-sm text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
            <a href={publicUrl} target="_blank" rel="noopener" className="text-primary hover:underline inline-flex items-center gap-1" data-testid="public-url-link">
              {b.slug}.{rootDomain} <ExternalLink className="h-3 w-3" />
            </a>
            <Button
              size="sm" variant="ghost" className="h-6 px-2"
              onClick={() => { navigator.clipboard.writeText(publicUrl); toast.success('Enlace copiado'); }}
            >
              <Copy className="h-3 w-3 mr-1" /> Copiar
            </Button>
          </div>
        </div>
      </div>

      <Tabs defaultValue="services" className="space-y-4">
        <TabsList>
          <TabsTrigger value="services" data-testid="tab-services"><Scissors className="h-4 w-4 mr-1" /> Servicios</TabsTrigger>
          <TabsTrigger value="hours" data-testid="tab-hours"><Clock className="h-4 w-4 mr-1" /> Horarios</TabsTrigger>
          <TabsTrigger value="appointments" data-testid="tab-appointments"><Calendar className="h-4 w-4 mr-1" /> Citas</TabsTrigger>
          <TabsTrigger value="settings" data-testid="tab-settings">⚙️ Ajustes</TabsTrigger>
        </TabsList>

        <TabsContent value="services">
          <ServicesTab businessId={businessId} services={data.services} onChange={mutate} />
        </TabsContent>
        <TabsContent value="hours">
          <HoursTab businessId={businessId} hours={data.hours} onChange={mutate} />
        </TabsContent>
        <TabsContent value="appointments">
          <AppointmentsTab businessId={businessId} tz={b.timezone} type={b.type} />
        </TabsContent>
        <TabsContent value="settings">
          <SettingsTab business={b} onChange={mutate} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Services Tab ───
function ServicesTab({ businessId, services, onChange }: { businessId: number; services: Service[]; onChange: () => void }) {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Service | null>(null);
  const [form, setForm] = useState({ name: '', durationMin: 30, priceEur: 15, currency: 'EUR', description: '', isActive: true });

  function openNew() {
    setEditing(null);
    setForm({ name: '', durationMin: 30, priceEur: 15, currency: 'EUR', description: '', isActive: true });
    setShowForm(true);
  }
  function openEdit(s: Service) {
    setEditing(s);
    setForm({
      name: s.name, durationMin: s.durationMin, priceEur: (s.priceCents || 0) / 100,
      currency: s.currency || 'EUR', description: s.description || '', isActive: s.isActive,
    });
    setShowForm(true);
  }

  async function handleSave() {
    if (!form.name.trim()) { toast.error('Nombre obligatorio'); return; }
    const payload = {
      name: form.name,
      durationMin: form.durationMin,
      priceCents: Math.round(form.priceEur * 100),
      currency: form.currency,
      description: form.description,
      isActive: form.isActive,
    };
    const url = editing
      ? `/api/businesses/${businessId}/services/${editing.id}`
      : `/api/businesses/${businessId}/services`;
    const res = await fetch(url, {
      method: editing ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) { toast.error('Error al guardar'); return; }
    toast.success(editing ? 'Servicio actualizado' : 'Servicio creado');
    setShowForm(false);
    onChange();
  }

  async function handleDelete(s: Service) {
    const res = await fetch(`/api/businesses/${businessId}/services/${s.id}`, { method: 'DELETE' });
    if (!res.ok) { toast.error('Error al eliminar'); return; }
    toast.success('Servicio eliminado');
    onChange();
  }

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold">Servicios ofrecidos</h2>
        <Dialog open={showForm} onOpenChange={setShowForm}>
          <DialogTrigger asChild>
            <Button size="sm" onClick={openNew} data-testid="new-service-btn">
              <Plus className="h-4 w-4 mr-1" /> Nuevo servicio
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editing ? 'Editar servicio' : 'Nuevo servicio'}</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <div>
                <Label>Nombre *</Label>
                <Input data-testid="service-name-input" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Corte de cabello" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Duración (min)</Label>
                  <Input type="number" min={5} step={5} value={form.durationMin} onChange={e => setForm({ ...form, durationMin: parseInt(e.target.value, 10) || 30 })} />
                </div>
                <div>
                  <Label>Precio</Label>
                  <div className="flex gap-2">
                    <Input type="number" step="0.01" min={0} value={form.priceEur} onChange={e => setForm({ ...form, priceEur: parseFloat(e.target.value) || 0 })} />
                    <Select value={form.currency} onValueChange={v => setForm({ ...form, currency: v })}>
                      <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="EUR">EUR</SelectItem>
                        <SelectItem value="USD">USD</SelectItem>
                        <SelectItem value="MXN">MXN</SelectItem>
                        <SelectItem value="ARS">ARS</SelectItem>
                        <SelectItem value="COP">COP</SelectItem>
                        <SelectItem value="CLP">CLP</SelectItem>
                        <SelectItem value="PEN">PEN</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
              <div>
                <Label>Descripción (opcional)</Label>
                <Textarea rows={2} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={form.isActive} onCheckedChange={v => setForm({ ...form, isActive: v })} />
                <Label className="cursor-pointer">Visible públicamente</Label>
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setShowForm(false)}>Cancelar</Button>
              <Button onClick={handleSave} data-testid="save-service-btn">{editing ? 'Guardar' : 'Crear'}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {!services?.length ? (
        <p className="text-sm text-muted-foreground py-6 text-center">Aún no hay servicios. Crea el primero.</p>
      ) : (
        <div className="divide-y">
          {services.map(s => (
            <div key={s.id} className="flex items-center justify-between py-3" data-testid={`service-row-${s.id}`}>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{s.name}</span>
                  {!s.isActive && <span className="text-[10px] uppercase bg-muted px-1.5 py-0.5 rounded">Oculto</span>}
                </div>
                <div className="text-xs text-muted-foreground">
                  {s.durationMin} min · {((s.priceCents || 0) / 100).toFixed(2)} {s.currency || 'EUR'}
                  {s.description ? ` · ${s.description}` : ''}
                </div>
              </div>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => openEdit(s)} data-testid={`edit-service-${s.id}`}>
                  <Pencil className="h-4 w-4" />
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" data-testid={`delete-service-${s.id}`}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>¿Eliminar este servicio?</AlertDialogTitle>
                      <AlertDialogDescription>Las citas existentes mantienen el registro pero no se podrá reservar más.</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancelar</AlertDialogCancel>
                      <AlertDialogAction onClick={() => handleDelete(s)}>Eliminar</AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ─── Hours Tab ───
function HoursTab({ businessId, hours, onChange }: { businessId: number; hours: Hour[]; onChange: () => void }) {
  const byDay: Record<number, Hour> = {};
  for (const h of hours) byDay[h.weekday] = h;
  const initial = WEEKDAYS.map(w => byDay[w.i] || { weekday: w.i, openTime: '09:00', closeTime: '18:00', isClosed: w.i === 0 });
  const [rows, setRows] = useState<Hour[]>(initial);
  const [saving, setSaving] = useState(false);

  function update(idx: number, patch: Partial<Hour>) {
    setRows(rs => rs.map((r, i) => i === idx ? { ...r, ...patch } : r));
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/businesses/${businessId}/hours`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hours: rows }),
      });
      if (!res.ok) { toast.error('Error al guardar horarios'); return; }
      toast.success('Horarios guardados');
      onChange();
    } finally { setSaving(false); }
  }

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold">Horarios de atención</h2>
        <Button size="sm" onClick={save} disabled={saving} data-testid="save-hours-btn">
          <Save className="h-4 w-4 mr-1" /> {saving ? 'Guardando...' : 'Guardar cambios'}
        </Button>
      </div>
      <div className="space-y-2">
        {rows.map((r, idx) => (
          <div key={r.weekday} className="flex items-center gap-3 p-2 border rounded-md" data-testid={`hours-row-${r.weekday}`}>
            <div className="w-28 text-sm font-medium">{WEEKDAYS.find(w => w.i === r.weekday)?.label}</div>
            <div className="flex items-center gap-2">
              <Switch checked={!r.isClosed} onCheckedChange={v => update(idx, { isClosed: !v })} />
              <span className="text-xs text-muted-foreground w-16">{r.isClosed ? 'Cerrado' : 'Abierto'}</span>
            </div>
            <div className={`flex items-center gap-2 ml-auto ${r.isClosed ? 'opacity-30 pointer-events-none' : ''}`}>
              <Input type="time" className="w-28" value={r.openTime} onChange={e => update(idx, { openTime: e.target.value })} />
              <span className="text-muted-foreground">—</span>
              <Input type="time" className="w-28" value={r.closeTime} onChange={e => update(idx, { closeTime: e.target.value })} />
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ─── Appointments Tab ───
function AppointmentsTab({ businessId, tz, type }: { businessId: number; tz: string; type: string }) {
  const [range, setRange] = useState<'today' | 'week' | 'month' | 'all'>('week');
  const [showNew, setShowNew] = useState(false);

  const { from, to } = (() => {
    const now = new Date();
    const start = new Date(now); start.setHours(0, 0, 0, 0);
    if (range === 'today') {
      const end = new Date(start); end.setDate(end.getDate() + 1);
      return { from: start.toISOString(), to: end.toISOString() };
    }
    if (range === 'week') {
      const end = new Date(start); end.setDate(end.getDate() + 7);
      return { from: start.toISOString(), to: end.toISOString() };
    }
    if (range === 'month') {
      const end = new Date(start); end.setMonth(end.getMonth() + 1);
      return { from: start.toISOString(), to: end.toISOString() };
    }
    return { from: '', to: '' };
  })();

  const qs = range === 'all' ? '' : `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  const { data, mutate, isLoading } = useSWR<{ appointments: Appointment[] }>(`/api/businesses/${businessId}/appointments${qs}`, fetcher);

  async function changeStatus(a: Appointment, status: string) {
    const res = await fetch(`/api/appointments/${a.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (!res.ok) { toast.error('Error al actualizar'); return; }
    toast.success('Estado actualizado');
    mutate();
  }

  async function remove(a: Appointment) {
    const res = await fetch(`/api/appointments/${a.id}`, { method: 'DELETE' });
    if (!res.ok) { toast.error('Error al eliminar'); return; }
    toast.success('Cita eliminada');
    mutate();
  }

  function fmt(d: string) {
    return new Intl.DateTimeFormat('es-ES', {
      timeZone: tz, weekday: 'short', day: '2-digit', month: 'short',
      hour: '2-digit', minute: '2-digit',
    }).format(new Date(d));
  }

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <h2 className="font-semibold">Citas</h2>
        <div className="flex gap-1 items-center flex-wrap">
          {(['today', 'week', 'month', 'all'] as const).map(r => (
            <Button
              key={r}
              size="sm"
              variant={range === r ? 'default' : 'outline'}
              onClick={() => setRange(r)}
              data-testid={`range-${r}-btn`}
            >
              {r === 'today' ? 'Hoy' : r === 'week' ? 'Semana' : r === 'month' ? 'Mes' : 'Todas'}
            </Button>
          ))}
          <Button size="sm" variant="secondary" className="ml-2" onClick={() => setShowNew(true)} data-testid="new-appointment-btn">
            <Plus className="h-3.5 w-3.5 mr-1" /> Nueva cita
          </Button>
        </div>
      </div>

      <ManualAppointmentDialog
        open={showNew}
        onOpenChange={setShowNew}
        businessId={businessId}
        tz={tz}
        onCreated={() => mutate()}
      />

      {isLoading ? (
        <p className="text-sm text-muted-foreground py-6 text-center">Cargando...</p>
      ) : !data?.appointments?.length ? (
        <p className="text-sm text-muted-foreground py-6 text-center">No hay citas en este rango.</p>
      ) : (
        <div className="divide-y">
          {data.appointments.map(a => {
            const badge = STATUS_BADGES[a.status] || { label: a.status, cls: 'bg-muted' };
            return (
              <div key={a.id} className="py-3 flex items-start justify-between gap-3 flex-wrap" data-testid={`appointment-row-${a.id}`}>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{a.customerName}</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full ${badge.cls}`}>{badge.label}</span>
                    {a.source === 'online' && <span className="text-[10px] bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300 px-1.5 py-0.5 rounded">Online</span>}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    📅 {fmt(a.startAt)} · {a.serviceName || 'Servicio'} ({a.durationMin || '?'} min)
                  </div>
                  <div className="text-xs text-muted-foreground">
                    📞 {a.customerPhone}{a.customerEmail ? ` · ✉️ ${a.customerEmail}` : ''}
                  </div>
                  {a.notes && <div className="text-xs text-muted-foreground italic mt-1">"{a.notes}"</div>}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  <Select value={a.status} onValueChange={v => changeStatus(a, v)}>
                    <SelectTrigger className="h-8 w-36 text-xs" data-testid={`status-select-${a.id}`}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="confirmed">Confirmada</SelectItem>
                      {type === 'hostel' && <SelectItem value="checked_in">Check-in</SelectItem>}
                      {type === 'hostel' && <SelectItem value="checked_out">Check-out</SelectItem>}
                      <SelectItem value="completed">Completada</SelectItem>
                      <SelectItem value="cancelled">Cancelada</SelectItem>
                      <SelectItem value="no_show">No-show</SelectItem>
                    </SelectContent>
                  </Select>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive h-8 w-8 p-0">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>¿Eliminar esta cita?</AlertDialogTitle>
                        <AlertDialogDescription>Esta acción no se puede deshacer.</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancelar</AlertDialogCancel>
                        <AlertDialogAction onClick={() => remove(a)}>Eliminar</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}

// ─── Settings Tab ───
function SettingsTab({ business, onChange }: { business: Business; onChange: () => void }) {
  const [form, setForm] = useState({
    name: business.name,
    type: business.type,
    timezone: business.timezone,
    address: business.address || '',
    phone: business.phone || '',
    primaryColor: business.primaryColor || '#0ea5e9',
    description: business.description || '',
    bookingNoticeMinutes: business.bookingNoticeMinutes ?? 60,
    isActive: business.isActive,
  });
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/businesses/${business.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (!res.ok) { toast.error('Error al guardar'); return; }
      toast.success('Cambios guardados');
      onChange();
    } finally { setSaving(false); }
  }

  async function deleteBusiness() {
    const res = await fetch(`/api/businesses/${business.id}`, { method: 'DELETE' });
    if (!res.ok) { toast.error('Error al eliminar'); return; }
    toast.success('Negocio eliminado');
    window.location.href = '/bookings';
  }

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <h2 className="font-semibold mb-3">Información del negocio</h2>
        <div className="space-y-3">
          <div>
            <Label>Nombre</Label>
            <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} data-testid="settings-name-input" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Tipo</Label>
              <Select value={form.type} onValueChange={v => setForm({ ...form, type: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="barbershop">Barbería / Peluquería</SelectItem>
                  <SelectItem value="hostel">Hostal / Hotel</SelectItem>
                  <SelectItem value="generic">Otro (genérico)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Zona horaria</Label>
              <Input value={form.timezone} onChange={e => setForm({ ...form, timezone: e.target.value })} placeholder="Europe/Madrid" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Teléfono público</Label>
              <Input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="+34 600 00 00 00" />
            </div>
            <div>
              <Label>Tiempo mínimo de antelación (min)</Label>
              <Input type="number" min={0} value={form.bookingNoticeMinutes} onChange={e => setForm({ ...form, bookingNoticeMinutes: parseInt(e.target.value, 10) || 0 })} />
            </div>
          </div>
          <div>
            <Label>Dirección</Label>
            <Input value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} />
          </div>
          <div>
            <Label>Color principal</Label>
            <div className="flex gap-2">
              <Input type="color" className="w-14 h-10 p-1" value={form.primaryColor} onChange={e => setForm({ ...form, primaryColor: e.target.value })} />
              <Input value={form.primaryColor} onChange={e => setForm({ ...form, primaryColor: e.target.value })} />
            </div>
          </div>
          <div>
            <Label>Descripción</Label>
            <Textarea rows={3} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} />
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={form.isActive} onCheckedChange={v => setForm({ ...form, isActive: v })} />
            <Label className="cursor-pointer">Página pública activa</Label>
          </div>
          <Button onClick={save} disabled={saving} data-testid="save-settings-btn">
            <Save className="h-4 w-4 mr-1" /> {saving ? 'Guardando...' : 'Guardar cambios'}
          </Button>
        </div>
      </Card>

      <Card className="p-4 border-destructive/30">
        <h2 className="font-semibold text-destructive mb-2">Zona peligrosa</h2>
        <p className="text-xs text-muted-foreground mb-3">Eliminar este negocio borrará también todos sus servicios, horarios y citas.</p>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" size="sm" data-testid="delete-business-btn">
              <Trash2 className="h-4 w-4 mr-1" /> Eliminar negocio
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>¿Eliminar "{business.name}"?</AlertDialogTitle>
              <AlertDialogDescription>Esta acción borra el negocio, sus servicios, horarios y citas. No se puede deshacer.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction className="bg-destructive hover:bg-destructive/90" onClick={deleteBusiness}>Eliminar definitivamente</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </Card>
    </div>
  );
}


// ─── Manual Appointment Dialog ───
function ManualAppointmentDialog({
  open, onOpenChange, businessId, tz, onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  businessId: number;
  tz: string;
  onCreated: () => void;
}) {
  const { data: detail } = useSWR<{ services: Service[] }>(open ? `/api/businesses/${businessId}` : null, fetcher);
  const services = (detail?.services || []).filter(s => s.isActive);

  const today = (() => {
    const d = new Date();
    const y = d.getFullYear(); const m = String(d.getMonth() + 1).padStart(2, '0'); const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  })();

  const [form, setForm] = useState({
    serviceId: '', customerName: '', customerPhone: '', customerEmail: '',
    date: today, time: '10:00', notes: '', sendConfirmation: true,
  });
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!form.serviceId || !form.customerName.trim() || !form.customerPhone.trim()) {
      toast.error('Servicio, nombre y teléfono obligatorios');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/businesses/${businessId}/appointments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (!res.ok) { toast.error(json.error || 'Error al crear cita'); return; }
      toast.success('Cita creada');
      onOpenChange(false);
      onCreated();
      setForm({ ...form, customerName: '', customerPhone: '', customerEmail: '', notes: '' });
    } finally { setSaving(false); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Nueva cita manual</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div>
            <Label>Servicio *</Label>
            <Select value={form.serviceId} onValueChange={v => setForm({ ...form, serviceId: v })}>
              <SelectTrigger data-testid="manual-service-select"><SelectValue placeholder="Selecciona servicio" /></SelectTrigger>
              <SelectContent>
                {services.length === 0 && <SelectItem value="none" disabled>No hay servicios</SelectItem>}
                {services.map(s => (
                  <SelectItem key={s.id} value={String(s.id)}>{s.name} ({s.durationMin}min)</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Nombre del cliente *</Label>
            <Input data-testid="manual-customer-name" value={form.customerName} onChange={e => setForm({ ...form, customerName: e.target.value })} />
          </div>
          <div>
            <Label>Teléfono * <span className="text-xs text-muted-foreground">(con código de país, sin +)</span></Label>
            <Input data-testid="manual-customer-phone" value={form.customerPhone} onChange={e => setForm({ ...form, customerPhone: e.target.value })} placeholder="34600000000" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Fecha *</Label>
              <Input type="date" value={form.date} onChange={e => setForm({ ...form, date: e.target.value })} />
            </div>
            <div>
              <Label>Hora *</Label>
              <Input type="time" value={form.time} onChange={e => setForm({ ...form, time: e.target.value })} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">Zona horaria del negocio: <code>{tz}</code></p>
          <div>
            <Label>Notas</Label>
            <Textarea rows={2} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={form.sendConfirmation} onCheckedChange={v => setForm({ ...form, sendConfirmation: v })} />
            <Label className="cursor-pointer">Enviar WhatsApp de confirmación al cliente</Label>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={submit} disabled={saving} data-testid="save-manual-appointment-btn">
            {saving ? 'Creando...' : 'Crear cita'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
