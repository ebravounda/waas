'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { Bell } from 'lucide-react';
import { getTeamChannel } from '@/lib/pusher-client';

const fetcher = (url: string) => fetch(url).then(r => r.json());
const DISMISS_KEY = 'handover-bell-dismissed-at';

export function HandoverBell({ teamId }: { teamId?: number | null }) {
  const { data, mutate } = useSWR<{ count: number }>(
    '/api/handover/pending-count',
    fetcher,
    { refreshInterval: 30000, revalidateOnFocus: true }
  );

  // Last server count snapshot when user dismissed the bell.
  // Persisted to localStorage so it survives navigation/refresh.
  const [dismissedAtCount, setDismissedAtCount] = useState<number>(-1);

  // Load persisted dismissal on mount
  useEffect(() => {
    try {
      const v = localStorage.getItem(DISMISS_KEY);
      if (v != null) setDismissedAtCount(parseInt(v, 10));
    } catch {}
  }, []);

  const dismiss = useCallback((count: number) => {
    setDismissedAtCount(count);
    try { localStorage.setItem(DISMISS_KEY, String(count)); } catch {}
  }, []);

  const reset = useCallback(() => {
    setDismissedAtCount(-1);
    try { localStorage.removeItem(DISMISS_KEY); } catch {}
  }, []);

  useEffect(() => {
    if (!teamId) return;
    const channel = getTeamChannel(teamId);
    if (!channel) return;

    const onNewAlert = () => {
      reset(); // new handover — always show
      mutate();
    };
    const onStatusUpdate = () => mutate();

    channel.bind('handover-needed', onNewAlert);
    channel.bind('chat-status-update', onStatusUpdate);
    channel.bind('handover-unattended', onNewAlert);
    return () => {
      channel.unbind('handover-needed', onNewAlert);
      channel.unbind('chat-status-update', onStatusUpdate);
      channel.unbind('handover-unattended', onNewAlert);
    };
  }, [teamId, mutate, reset]);

  const serverCount = data?.count ?? 0;
  // Bell stays clean as long as the unattended count hasn't GROWN past
  // the snapshot the user already saw/dismissed.
  const hasPending = serverCount > 0 && serverCount > dismissedAtCount;
  const visibleCount = hasPending ? serverCount : 0;

  const handleClick = () => {
    dismiss(serverCount);
  };

  return (
    <Link
      href="/dashboard"
      onClick={handleClick}
      className="relative inline-flex items-center justify-center w-9 h-9 rounded-full hover:bg-muted transition-colors"
      title={hasPending ? `${visibleCount} usuario(s) esperando agente` : 'Sin alertas'}
      data-testid="handover-bell"
    >
      <Bell className={`h-5 w-5 ${hasPending ? 'text-red-500' : 'text-muted-foreground'}`} />
      {hasPending && (
        <>
          <span className="absolute top-1 right-1 inline-flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500"></span>
          </span>
          {visibleCount > 1 && (
            <span
              className="absolute -bottom-1 -right-1 bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1"
              data-testid="handover-bell-count"
            >
              {visibleCount > 99 ? '99+' : visibleCount}
            </span>
          )}
        </>
      )}
    </Link>
  );
}

export default HandoverBell;
