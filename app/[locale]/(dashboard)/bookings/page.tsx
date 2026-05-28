'use client';

import { useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Plus, ExternalLink, Calendar, MapPin, Phone, Settings as SettingsIcon } from 'lucide-react';
import { toast } from 'sonner';

const fetcher = (url: string) => fetch(url).then(r => r.json());

type Business = {
  id: number;
  slug: string;
  name: string;
  type: string;
  timezone: string;
  address: string | null;
  phone: string | null;
  primaryColor: string | null;
  description: string | null;
  isActive: boolean;
  createdAt: string;
};

const BUSINESS_TYPES = [
  { value: 'barbershop', label: 'Barbería / Peluquería' },
  { value: 'hostel', label: 'Hostal / Hotel' },
  { value: 'generic', label: 'Otro (genérico)' },
];

const COMMON_TIMEZONES = [
  'Europe/Madrid', 'Europe/London', 'Europe/Paris',
  'America/Mexico_City', 'America/Bogota', 'America/Lima',
  'America/Santiago', 'America/Argentina/Buenos_Aires',
  'America/New_York', 'America/Los_Angeles', 'UTC',
];

export default function BookingsListPage() {
  const { data, mutate, isLoading } = useSWR<{ businesses: Business[] }>('/api/businesses', fetcher);
  const [showDialog, setShowDialog] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    slug: '',
    name: '',
    type: 'barbershop',
    timezone: (typeof Intl !== 'undefined') ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'Europe/Madrid',
    address: '',
    phone: '',
    primaryColor: '#0ea5e9',
    description: '',
  });

  const rootDomain = (typeof window !== 'undefined' && (window as any).__ROOT_DOMAIN__) || 'mitiendapro.com';

  async function handleCreate() {
    if (!form.name.trim() || !form.slug.trim()) {
      toast.error('Nombre y slug son obligatorios');
      return;
    }
    setCreating(true);
    try {
      const res = await fetch('/api/businesses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error || 'Error al crear');
        return;
      }
      toast.success('Negocio creado');
      setShowDialog(false);
      setForm({ ...form, slug: '', name: '', address: '', phone: '', description: '' });
      mutate();
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="p-6 max-w-6xl mx-auto" data-testid="bookings-page">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <Calendar className="h-7 w-7 text-primary" /> Reservas
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Crea páginas públicas de reserva para tus barberías, hostales o cualquier negocio.
          </p>
        </div>

        <Dialog open={showDialog} onOpenChange={setShowDialog}>
          <DialogTrigger asChild>
            <Button data-testid="new-business-btn">
              <Plus className="h-4 w-4 mr-2" /> Nuevo negocio
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Crear nuevo negocio</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div>
                <Label>Nombre del negocio *</Label>
                <Input
                  data-testid="new-business-name"
                  value={form.name}
                  onChange={e => setForm({ ...form, name: e.target.value })}
                  placeholder="Barbería Juan"
                />
              </div>
              <div>
                <Label>Slug público (URL) *</Label>
                <div className="flex items-center gap-1 mt-1">
                  <Input
                    data-testid="new-business-slug"
                    value={form.slug}
                    onChange={e => setForm({ ...form, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })}
                    placeholder="barberia-juan"
                  />
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Tu página será: <code className="bg-muted px-1 rounded">{form.slug || 'tu-slug'}.{rootDomain}</code>
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Tipo</Label>
                  <Select value={form.type} onValueChange={v => setForm({ ...form, type: v })}>
                    <SelectTrigger data-testid="new-business-type"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {BUSINESS_TYPES.map(t => (
                        <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Zona horaria</Label>
                  <Select value={form.timezone} onValueChange={v => setForm({ ...form, timezone: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {COMMON_TIMEZONES.map(tz => (
                        <SelectItem key={tz} value={tz}>{tz}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Teléfono</Label>
                  <Input
                    value={form.phone}
                    onChange={e => setForm({ ...form, phone: e.target.value })}
                    placeholder="+34 600 00 00 00"
                  />
                </div>
                <div>
                  <Label>Color principal</Label>
                  <div className="flex gap-2">
                    <Input
                      type="color"
                      className="w-14 h-10 p-1"
                      value={form.primaryColor}
                      onChange={e => setForm({ ...form, primaryColor: e.target.value })}
                    />
                    <Input
                      value={form.primaryColor}
                      onChange={e => setForm({ ...form, primaryColor: e.target.value })}
                    />
                  </div>
                </div>
              </div>
              <div>
                <Label>Dirección</Label>
                <Input
                  value={form.address}
                  onChange={e => setForm({ ...form, address: e.target.value })}
                  placeholder="Calle Mayor 12, Madrid"
                />
              </div>
              <div>
                <Label>Descripción corta</Label>
                <Textarea
                  rows={2}
                  value={form.description}
                  onChange={e => setForm({ ...form, description: e.target.value })}
                  placeholder="Cortes modernos, barbería tradicional desde 1995"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setShowDialog(false)}>Cancelar</Button>
              <Button onClick={handleCreate} disabled={creating} data-testid="confirm-create-business-btn">
                {creating ? 'Creando...' : 'Crear negocio'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Cargando...</div>
      ) : !data?.businesses?.length ? (
        <Card className="p-12 text-center">
          <Calendar className="h-12 w-12 mx-auto text-muted-foreground/40 mb-3" />
          <h3 className="font-semibold mb-1">Aún no tienes negocios</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Crea tu primer negocio para que tus clientes puedan reservar online.
          </p>
          <Button onClick={() => setShowDialog(true)}>
            <Plus className="h-4 w-4 mr-2" /> Crear el primero
          </Button>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {data.businesses.map(b => (
            <Card key={b.id} className="p-4 hover:shadow-md transition-shadow" data-testid={`business-card-${b.id}`}>
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="min-w-0">
                  <h3 className="font-semibold truncate" style={{ color: b.primaryColor || undefined }}>{b.name}</h3>
                  <p className="text-xs text-muted-foreground truncate">
                    {b.slug}.{rootDomain}
                  </p>
                </div>
                <span className="text-[10px] uppercase tracking-wide bg-muted px-2 py-1 rounded">{b.type}</span>
              </div>

              <div className="text-xs text-muted-foreground space-y-1 mb-3">
                {b.address && <div className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {b.address}</div>}
                {b.phone && <div className="flex items-center gap-1"><Phone className="h-3 w-3" /> {b.phone}</div>}
                <div className="flex items-center gap-1">🌍 {b.timezone}</div>
              </div>

              <div className="flex gap-2">
                <Button asChild size="sm" variant="default" className="flex-1" data-testid={`manage-business-${b.id}`}>
                  <Link href={`/bookings/${b.id}`}>
                    <SettingsIcon className="h-3.5 w-3.5 mr-1" /> Gestionar
                  </Link>
                </Button>
                <Button asChild size="sm" variant="outline">
                  <a href={`https://${b.slug}.${rootDomain}`} target="_blank" rel="noopener">
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
