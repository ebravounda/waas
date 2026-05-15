'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { Bell } from 'lucide-react';
import { getTeamChannel } from '@/lib/pusher-client';

const fetcher = (url: string) => fetch(url).then(r => r.json());

export function HandoverBell({ teamId }: { teamId?: number | null }) {
  const { data, mutate } = useSWR<{ count: number }>(
    '/api/handover/pending-count',
    fetcher,
    { refreshInterval: 30000, revalidateOnFocus: true }
  );

  // "Acknowledged" count — hides badge optimistically when user clicks.
  // A new Pusher event resets this so new alerts are always visible.
  const [acknowledged, setAcknowledged] = useState(0);

  useEffect(() => {
    if (!teamId) return;
    const channel = getTeamChannel(teamId);
    if (!channel) return;

    const onHandover = () => {
      setAcknowledged(0); // new alert — show badge again
      mutate();
    };
    const onStatusUpdate = () => mutate();
    const onUnattended = () => {
      setAcknowledged(0);
      mutate();
    };
    channel.bind('handover-needed', onHandover);
    channel.bind('chat-status-update', onStatusUpdate);
    channel.bind('handover-unattended', onUnattended);
    return () => {
      channel.unbind('handover-needed', onHandover);
      channel.unbind('chat-status-update', onStatusUpdate);
      channel.unbind('handover-unattended', onUnattended);
    };
  }, [teamId, mutate]);

  const serverCount = data?.count ?? 0;
  const visibleCount = Math.max(0, serverCount - acknowledged);
  const hasPending = visibleCount > 0;

  const handleClick = () => {
    // Optimistically dismiss the badge — user is going to dashboard to handle it
    setAcknowledged(serverCount);
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
