'use client';

import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { X, Plus, Search } from 'lucide-react';

const fetcher = (url: string) => fetch(url).then(r => r.json());

export type PickedContact = { remoteJid?: string; phone?: string; name?: string };

type Chat = {
  id: number;
  remoteJid: string;
  name?: string | null;
  pushName?: string | null;
};

interface Props {
  value: PickedContact[];
  onChange: (next: PickedContact[]) => void;
}

export function ContactPicker({ value, onChange }: Props) {
  const { data: chats } = useSWR<Chat[]>('/api/chats', fetcher);
  const [query, setQuery] = useState('');
  const [phoneInput, setPhoneInput] = useState('');

  const filtered = useMemo(() => {
    const list = Array.isArray(chats) ? chats : [];
    const q = query.trim().toLowerCase();
    if (!q) return list.slice(0, 20);
    return list.filter(c => {
      const name = (c.name || c.pushName || '').toLowerCase();
      return name.includes(q) || c.remoteJid.includes(q);
    }).slice(0, 20);
  }, [chats, query]);

  const isPicked = (jid: string) => value.some(v => v.remoteJid === jid);

  const togglePick = (c: Chat) => {
    if (isPicked(c.remoteJid)) {
      onChange(value.filter(v => v.remoteJid !== c.remoteJid));
    } else {
      onChange([...value, { remoteJid: c.remoteJid, name: c.name || c.pushName || '' }]);
    }
  };

  const addManual = () => {
    const clean = phoneInput.replace(/[^\d]/g, '');
    if (!clean || clean.length < 8) return;
    if (value.some(v => v.phone === clean || v.remoteJid?.startsWith(clean))) {
      setPhoneInput('');
      return;
    }
    onChange([...value, { phone: clean, name: `+${clean}` }]);
    setPhoneInput('');
  };

  const remove = (idx: number) => {
    onChange(value.filter((_, i) => i !== idx));
  };

  return (
    <div className="space-y-3" data-testid="contact-picker">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((c, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1 bg-primary/10 text-primary text-xs rounded-full px-2.5 py-1"
              data-testid={`picked-contact-${i}`}
            >
              {c.name || c.phone || c.remoteJid}
              <button
                type="button"
                onClick={() => remove(i)}
                className="hover:bg-primary/20 rounded-full"
                aria-label="Quitar"
              >
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Buscar contacto por nombre o teléfono…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="pl-8"
            data-testid="contact-search-input"
          />
        </div>
        {filtered.length > 0 && (
          <div className="mt-2 border rounded-md max-h-56 overflow-y-auto divide-y">
            {filtered.map(c => (
              <button
                type="button"
                key={c.id}
                onClick={() => togglePick(c)}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-muted/60 flex justify-between items-center ${isPicked(c.remoteJid) ? 'bg-primary/10' : ''}`}
                data-testid={`contact-option-${c.id}`}
              >
                <span className="truncate">
                  <span className="font-medium">{c.name || c.pushName || 'Sin nombre'}</span>
                  <span className="ml-2 text-xs text-muted-foreground">{c.remoteJid.split('@')[0]}</span>
                </span>
                {isPicked(c.remoteJid) && <span className="text-xs text-primary shrink-0 ml-2">✓ Agregado</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <Input
          placeholder="O escribí un número con código país (ej: 5491155667788)"
          value={phoneInput}
          onChange={e => setPhoneInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addManual(); } }}
          data-testid="manual-phone-input"
        />
        <Button type="button" variant="outline" onClick={addManual} data-testid="add-manual-phone-btn">
          <Plus className="w-4 h-4 mr-1" /> Agregar
        </Button>
      </div>
    </div>
  );
}
