'use client';

import { useEffect, useState } from 'react';
import useSWR from 'swr';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Trash2, Calendar, Clock, MessageSquare } from 'lucide-react';
import { toast } from 'sonner';
import { ContactPicker, type PickedContact } from '@/components/recurring-messages/ContactPicker';

const fetcher = (url: string) => fetch(url).then(r => r.json());

type Rule = {
  id: number;
  name: string;
  scheduleType: 'day_of_month' | 'every_n_days' | 'day_of_week' | 'once';
  scheduleValue: number;
  sendHour: number;
  sendMinute: number;
  messageBody: string;
  targetType: string;
  isActive: boolean;
  nextRunAt: string | null;
  totalMessagesSent: number;
  instanceId: number | null;
};

const SCHEDULE_LABELS: Record<string, (v: number) => string> = {
  day_of_month: v => `Día ${v} de cada mes`,
  every_n_days: v => `Cada ${v} día${v === 1 ? '' : 's'}`,
  day_of_week: v => ['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo'][v - 1] || `Día ${v}`,
  once: () => 'Envío único',
};

export default function RecurringMessagesPage() {
  const { data, mutate, isLoading } = useSWR<{ rules: Rule[] }>('/api/recurring-messages', fetcher);
  const { data: instData } = useSWR<any>('/api/instance/list', fetcher);
  const instances: any[] = Array.isArray(instData) ? instData : (instData?.instances || []);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<any>({
    name: '',
    instanceId: null,
    scheduleType: 'once',
    scheduleValue: 1,
    runOnceAt: '',
    sendHour: 9,
    sendMinute: 0,
    messageBody: 'Hola {{nombre}}, te recordamos que tu pago vence pronto. ¡Gracias!',
    mediaUrl: '',
    mediaType: '',
    targetType: 'contacts',
    targetValue: '',
    pickedContacts: [] as PickedContact[],
    delayBetweenMessages: 8,
    isActive: true,
  });

  async function handleSubmit() {
    if (!form.name || !form.messageBody) { toast.error('Nombre y mensaje son obligatorios'); return; }
    if (form.scheduleType === 'once' && !form.runOnceAt) {
      toast.error('Selecciona fecha y hora del envío único');
      return;
    }
    if (form.targetType === 'contacts' && (!form.pickedContacts || form.pickedContacts.length === 0)) {
      toast.error('Seleccioná al menos un contacto');
      return;
    }
    const payload: any = { ...form };
    if (form.targetType === 'contacts') {
      payload.targetValue = JSON.stringify(form.pickedContacts);
    }
    delete payload.pickedContacts;
    const res = await fetch('/api/recurring-messages', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) { toast.success('Regla creada'); setShowForm(false); mutate(); }
    else { const e = await res.json(); toast.error(e.error || 'Error al crear'); }
  }

  async function toggleRule(rule: Rule) {
    await fetch(`/api/recurring-messages/${rule.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !rule.isActive }),
    });
    mutate();
  }

  async function deleteRule(id: number) {
    if (!confirm('¿Eliminar esta regla?')) return;
    await fetch(`/api/recurring-messages/${id}`, { method: 'DELETE' });
    toast.success('Regla eliminada');
    mutate();
  }

  return (
    <div className="container mx-auto p-6 max-w-5xl space-y-6" data-testid="recurring-messages-page">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Calendar className="w-6 h-6" /> Mensajes Programados</h1>
          <p className="text-muted-foreground text-sm">Envíos únicos en fecha y hora específica, o recurrentes (día del mes, cada N días, día de la semana).</p>
        </div>
        <Button onClick={() => setShowForm(!showForm)} data-testid="new-rule-btn">
          <Plus className="w-4 h-4 mr-2" /> Nueva regla
        </Button>
      </div>

      {showForm && (
        <Card className="p-6 space-y-4" data-testid="rule-form">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label>Nombre</Label>
              <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Ej: Recordatorio pago mensual" data-testid="rule-name-input" />
            </div>
            <div>
              <Label>Instancia WhatsApp</Label>
              <Select value={form.instanceId?.toString() || ''} onValueChange={v => setForm({ ...form, instanceId: parseInt(v, 10) })}>
                <SelectTrigger data-testid="rule-instance-select"><SelectValue placeholder="Selecciona instancia" /></SelectTrigger>
                <SelectContent>
                  {instances.map((i: any) => (
                    <SelectItem key={i.id} value={String(i.id)}>
                      {i.instanceName || i.displayName || i.name || `Instancia #${i.id}`}
                    </SelectItem>
                  ))}
                  {instances.length === 0 && (
                    <SelectItem value="0" disabled>No hay instancias configuradas</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Tipo de programación</Label>
              <Select value={form.scheduleType} onValueChange={v => setForm({ ...form, scheduleType: v, scheduleValue: v === 'once' ? 0 : 1 })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="once">Una sola vez</SelectItem>
                  <SelectItem value="day_of_month">Día específico del mes</SelectItem>
                  <SelectItem value="every_n_days">Cada N días</SelectItem>
                  <SelectItem value="day_of_week">Día de la semana</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {form.scheduleType === 'once' ? (
              <div>
                <Label>Fecha y hora del envío</Label>
                <Input
                  type="datetime-local"
                  value={form.runOnceAt}
                  onChange={e => setForm({ ...form, runOnceAt: e.target.value })}
                  data-testid="rule-runonce-input"
                />
              </div>
            ) : (
              <div>
                <Label>Valor</Label>
                <Input type="number" min={1} max={form.scheduleType === 'day_of_week' ? 7 : 31} value={form.scheduleValue} onChange={e => setForm({ ...form, scheduleValue: parseInt(e.target.value, 10) || 1 })} />
              </div>
            )}
            {form.scheduleType !== 'once' && (
              <div>
                <Label>Hora envío (24h)</Label>
                <div className="flex gap-2">
                  <Input type="number" min={0} max={23} value={form.sendHour} onChange={e => setForm({ ...form, sendHour: parseInt(e.target.value, 10) || 0 })} />
                  <span className="self-center">:</span>
                  <Input type="number" min={0} max={59} value={form.sendMinute} onChange={e => setForm({ ...form, sendMinute: parseInt(e.target.value, 10) || 0 })} />
                </div>
              </div>
            )}
            <div>
              <Label>Delay entre mensajes (seg)</Label>
              <Input type="number" min={1} value={form.delayBetweenMessages} onChange={e => setForm({ ...form, delayBetweenMessages: parseInt(e.target.value, 10) || 8 })} />
            </div>
            <div>
              <Label>Destinatarios</Label>
              <Select value={form.targetType} onValueChange={v => setForm({ ...form, targetType: v, targetValue: '', pickedContacts: [] })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="contacts">Contactos específicos</SelectItem>
                  <SelectItem value="all">Todos los contactos</SelectItem>
                  <SelectItem value="tag">Por etiqueta (tag id)</SelectItem>
                  <SelectItem value="funnel">Por etapa funnel (id)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {form.targetType === 'tag' || form.targetType === 'funnel' ? (
              <div>
                <Label>ID de etiqueta o funnel</Label>
                <Input value={form.targetValue} onChange={e => setForm({ ...form, targetValue: e.target.value })} placeholder="Ej: 1" />
              </div>
            ) : null}
          </div>
          {form.targetType === 'contacts' && (
            <div>
              <Label>Seleccionar contactos</Label>
              <ContactPicker
                value={form.pickedContacts}
                onChange={(next) => setForm({ ...form, pickedContacts: next })}
              />
            </div>
          )}
          <div>
            <Label>Mensaje (variables: {'{{nombre}}'}, {'{{telefono}}'})</Label>
            <Textarea rows={4} value={form.messageBody} onChange={e => setForm({ ...form, messageBody: e.target.value })} data-testid="rule-message-input" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="md:col-span-2">
              <Label>Archivo adjunto (URL pública opcional)</Label>
              <Input
                placeholder="https://...../imagen.jpg ó .../documento.pdf"
                value={form.mediaUrl}
                onChange={e => setForm({ ...form, mediaUrl: e.target.value })}
                data-testid="rule-media-url-input"
              />
            </div>
            <div>
              <Label>Tipo de archivo</Label>
              <Select value={form.mediaType || ''} onValueChange={v => setForm({ ...form, mediaType: v })}>
                <SelectTrigger><SelectValue placeholder="Sin archivo" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="image">Imagen</SelectItem>
                  <SelectItem value="video">Video</SelectItem>
                  <SelectItem value="document">PDF / Documento</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShowForm(false)}>Cancelar</Button>
            <Button onClick={handleSubmit} data-testid="save-rule-btn">Crear regla</Button>
          </div>
        </Card>
      )}

      <div className="grid gap-4">
        {isLoading && <p className="text-sm text-muted-foreground">Cargando...</p>}
        {!isLoading && (data?.rules?.length ?? 0) === 0 && (
          <Card className="p-8 text-center text-muted-foreground"><MessageSquare className="w-10 h-10 mx-auto mb-2 opacity-40" /><p>Aún no tienes reglas. Crea la primera con el botón de arriba.</p></Card>
        )}
        {data?.rules?.map(rule => (
          <Card key={rule.id} className="p-5" data-testid={`rule-card-${rule.id}`}>
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 mb-1">
                  <h3 className="font-semibold">{rule.name}</h3>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${rule.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-600'}`}>
                    {rule.isActive ? 'Activa' : 'Pausada'}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground flex items-center gap-1.5"><Clock className="w-3.5 h-3.5" /> {SCHEDULE_LABELS[rule.scheduleType]?.(rule.scheduleValue) || rule.scheduleType} a las {String(rule.sendHour).padStart(2, '0')}:{String(rule.sendMinute).padStart(2, '0')}</p>
                <p className="text-sm mt-2 line-clamp-2 italic">"{rule.messageBody.substring(0, 120)}{rule.messageBody.length > 120 ? '…' : ''}"</p>
                <p className="text-xs text-muted-foreground mt-2">
                  Próximo envío: {rule.nextRunAt ? new Date(rule.nextRunAt).toLocaleString() : '—'}
                  {' · '}Mensajes enviados: {rule.totalMessagesSent}
                </p>
              </div>
              <div className="flex flex-col items-end gap-2">
                <Switch checked={rule.isActive} onCheckedChange={() => toggleRule(rule)} data-testid={`toggle-rule-${rule.id}`} />
                <Button size="sm" variant="ghost" onClick={() => deleteRule(rule.id)} data-testid={`delete-rule-${rule.id}`}>
                  <Trash2 className="w-4 h-4 text-red-500" />
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
