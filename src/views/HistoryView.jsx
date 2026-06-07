import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { listAllReports } from '../lib/api.js';
import { AuditGrid } from '../components/history/AuditGrid.jsx';

export function HistoryView({ active, onOpenAudit }) {
  const { loggedIn } = useAuth();
  const [state, setState] = useState({ status: 'idle', audits: [], error: '' });

  const load = async () => {
    setState((s) => ({ ...s, status: 'loading', error: '' }));
    try {
      const data = await listAllReports({});
      setState({ status: 'done', audits: data.audits || [], error: '' });
    } catch (e) {
      setState({ status: 'error', audits: [], error: e.message });
    }
  };

  // Load when the tab becomes active (and we're logged in).
  useEffect(() => {
    if (active && loggedIn && state.status === 'idle') load();
  }, [active, loggedIn]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="animate-fade-up">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold">Audit history</h2>
          <p className="font-mono text-[11px] text-faint">Any logged-in user has read access · folders in UTC</p>
        </div>
        {loggedIn && (
          <button
            onClick={load}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-panel/60 px-3 py-1.5 font-mono text-[11.5px] text-muted transition hover:border-aem hover:text-ink"
          >
            <RefreshCw size={13} className={state.status === 'loading' ? 'animate-spin' : ''} /> Refresh
          </button>
        )}
      </div>

      {!loggedIn ? (
        <div className="card py-14 text-center font-mono text-sm text-faint">Log in to browse the audit archive.</div>
      ) : state.status === 'loading' || state.status === 'idle' ? (
        <div className="py-14 text-center font-mono text-sm text-faint">Loading audits…</div>
      ) : state.status === 'error' ? (
        <div className="card py-14 text-center font-mono text-sm text-fail">{state.error}</div>
      ) : state.audits.length === 0 ? (
        <div className="card py-14 text-center font-mono text-sm text-faint">No audits archived yet.</div>
      ) : (
        <AuditGrid audits={state.audits} onOpenAudit={onOpenAudit} />
      )}
    </div>
  );
}
