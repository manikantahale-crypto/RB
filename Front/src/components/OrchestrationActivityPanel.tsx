import React, { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  ChevronDown,
  ChevronUp,
  Circle,
  Loader2,
  Workflow,
} from 'lucide-react';
import { apiFetch } from '../services/api';

interface OrchTimelineItem {
  kind: 'event' | 'run' | 'tool';
  at: string;
  summary: string;
  eventType?: string;
  graphKey?: string;
  agentName?: string;
  toolName?: string;
  status?: string;
  relayStatus?: string;
  routedTo?: { graphKey: string; agentLabel?: string | null };
}

interface OrchActivity {
  enabled: boolean;
  delegateMatch: boolean;
  orchApiOk: boolean;
  worker: {
    status: string;
    unpublishedPending: number;
    publishedLast15Min: number;
    runsLast15Min: number;
    lastPublishedAt?: string | null;
  };
  proofHint: string;
  timeline: OrchTimelineItem[];
  bindings: Array<{ eventType: string; graphKey: string; agentLabel?: string | null }>;
}

const STATUS_COLOR: Record<string, string> = {
  active: 'text-emerald-400',
  degraded: 'text-amber-400',
  worker_offline: 'text-red-400',
  idle: 'text-slate-400',
  unknown: 'text-slate-500',
};

const STATUS_LABEL: Record<string, string> = {
  active: 'Orchestrator active',
  degraded: 'Orchestrator catching up',
  worker_offline: 'Worker not running',
  idle: 'Idle — upload to trigger',
  unknown: 'Unknown',
};

export const OrchestrationActivityPanel: React.FC = () => {
  const [data, setData] = useState<OrchActivity | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(true);

  const fetchActivity = useCallback(async () => {
    try {
      const res = await apiFetch('/orchestration/activity');
      if (!res.ok) return;
      setData(await res.json());
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchActivity();
    const interval = setInterval(() => void fetchActivity(), 8000);
    return () => clearInterval(interval);
  }, [fetchActivity]);

  if (loading && !data) {
    return (
      <div className="mx-6 mt-3 flex items-center gap-2 text-xs text-slate-500">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        Checking orchestration…
      </div>
    );
  }

  if (!data?.enabled) return null;

  const workerStatus = data.worker?.status ?? 'unknown';
  const dotClass =
    workerStatus === 'active'
      ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]'
      : workerStatus === 'worker_offline'
        ? 'bg-red-400 animate-pulse'
        : 'bg-slate-500';

  return (
    <div className="mx-6 mt-3 rounded-xl border border-indigo-500/25 bg-indigo-950/30 overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-indigo-500/5 transition-colors"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <Workflow className="w-4 h-4 text-indigo-400 shrink-0" />
          <span className="text-xs font-semibold text-indigo-200 tracking-wide uppercase">
            Orchestration
          </span>
          <span className={`inline-flex items-center gap-1.5 text-[11px] ${STATUS_COLOR[workerStatus]}`}>
            <Circle className={`w-2 h-2 fill-current ${dotClass}`} />
            {STATUS_LABEL[workerStatus]}
          </span>
          {data.delegateMatch && (
            <span className="hidden sm:inline text-[10px] text-slate-500 border border-slate-700 rounded px-1.5 py-0.5">
              match via orch
            </span>
          )}
        </div>
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-slate-500 shrink-0" />
        ) : (
          <ChevronDown className="w-4 h-4 text-slate-500 shrink-0" />
        )}
      </button>

      {expanded && (
        <div className="px-4 pb-3 space-y-3 border-t border-indigo-500/15">
          <p className="text-[11px] text-slate-400 pt-2 leading-relaxed">{data.proofHint}</p>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[10px]">
            <Stat label="Orch API" value={data.orchApiOk ? 'up' : 'down'} ok={data.orchApiOk} />
            <Stat
              label="Relayed (15m)"
              value={String(data.worker.publishedLast15Min)}
              ok={data.worker.publishedLast15Min > 0}
            />
            <Stat
              label="Graph runs (15m)"
              value={String(data.worker.runsLast15Min)}
              ok={data.worker.runsLast15Min > 0}
            />
            <Stat
              label="Pending relay"
              value={String(data.worker.unpublishedPending)}
              ok={data.worker.unpublishedPending === 0}
            />
          </div>

          {data.timeline.length > 0 ? (
            <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
              {data.timeline.slice(0, 12).map((item, i) => (
                <div
                  key={`${item.kind}-${item.at}-${i}`}
                  className={`flex items-start gap-2 text-[11px] font-mono rounded px-2 py-1.5 ${
                    item.kind === 'tool'
                      ? 'text-amber-200/90 bg-amber-950/30 border border-amber-500/15'
                      : item.kind === 'run'
                        ? 'text-indigo-200 bg-indigo-950/40 border border-indigo-500/15'
                        : 'text-slate-300 bg-slate-900/40'
                  }`}
                >
                  <Activity className="w-3 h-3 mt-0.5 shrink-0 text-indigo-400" />
                  <div className="min-w-0">
                    <div className="truncate">{item.summary}</div>
                    {item.routedTo?.graphKey && (
                      <div className="text-[10px] text-indigo-300/80 mt-0.5">
                        next: {item.routedTo.graphKey}
                        {item.routedTo.agentLabel ? ` · ${item.routedTo.agentLabel}` : ''}
                      </div>
                    )}
                    {item.kind === 'tool' && item.graphKey && (
                      <div className="text-[10px] text-amber-300/70 mt-0.5">
                        {item.agentName} · {item.graphKey}
                        {item.toolName ? ` · tool=${item.toolName}` : ''}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-slate-500 italic">
              No platform events yet — upload a JD or resume, then watch this panel update.
            </p>
          )}

          <p className="text-[10px] text-slate-600">
            Terminal 2 (orch): [Orch] RELAY → EVENT → ROUTE → RUN → TOOL → NODE → DONE
          </p>
        </div>
      )}
    </div>
  );
};

function Stat({
  label,
  value,
  ok,
}: {
  label: string;
  value: string;
  ok: boolean;
}) {
  return (
    <div className="rounded-lg bg-slate-900/50 px-2 py-1.5 border border-slate-800">
      <div className="text-slate-500">{label}</div>
      <div className={ok ? 'text-emerald-400 font-semibold' : 'text-slate-300 font-semibold'}>
        {value}
      </div>
    </div>
  );
}
