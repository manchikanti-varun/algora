'use client';
import { useEffect, useState } from 'react';
import { Button, Card, ErrorState, Input, Notice, PageHeader, PageSkeleton, useToast } from '@/components/ui';
import { useApi } from '@/hooks/useApi';
import { api, errorMessage } from '@/lib/api';
import { isAdmin, useAuth } from '@/lib/auth';

type Scoring = { EASY: number; MEDIUM: number; HARD: number };
export default function Page() {
  const { user } = useAuth();
  const s = useApi<Scoring>('/settings/scoring');
  const [v, setV] = useState<Scoring | null>(null); const [busy, setBusy] = useState(false);
  const toast = useToast();
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (s.data) setV(s.data); }, [s.data]);
  if (s.error) return <ErrorState message={s.error} retry={s.reload} />;
  if (!v) return <PageSkeleton />;
  const save = async () => { setBusy(true); try { await api('/settings/scoring', { method: 'PUT', body: v }); toast.success('Scoring saved. Leaderboards use it immediately.'); s.reload(); } catch (e) { toast.error(errorMessage(e)); } finally { setBusy(false); } };
  return (
    <div className="max-w-2xl">
      <PageHeader title="Scoring" subtitle="Points per verified problem. Each unique problem counts once per ranking scope." />
      {!isAdmin(user) && <Notice tone="info">Only the Super Admin can change scoring.</Notice>}
      <Card>
        <div className="grid gap-4 sm:grid-cols-3">
          {(['EASY', 'MEDIUM', 'HARD'] as const).map((k) => <Input key={k} label={`${k[0]}${k.slice(1).toLowerCase()} points`} type="number" min={0} max={1000} value={v[k]} disabled={!isAdmin(user)} onChange={(e) => setV({ ...v, [k]: Number(e.target.value) })} />)}
        </div>
        <p className="mt-4 text-sm text-slate-500">Total points = Easy × {v.EASY} + Medium × {v.MEDIUM} + Hard × {v.HARD}</p>
        {isAdmin(user) && <div className="mt-4 flex gap-2"><Button loading={busy} onClick={save}>Save</Button><Button variant="ghost" onClick={() => setV({ EASY: 10, MEDIUM: 20, HARD: 30 })}>Reset to defaults</Button></div>}
      </Card>
    </div>
  );
}
