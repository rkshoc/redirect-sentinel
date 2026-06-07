import { useCallback, useState } from 'react';
import { ThemeProvider } from './context/ThemeContext.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import { PageBackground } from './components/ui/PageBackground.jsx';
import { Header } from './components/Header.jsx';
import { Tabs } from './components/Tabs.jsx';
import { NewAuditView } from './views/NewAuditView.jsx';
import { ReportView } from './views/ReportView.jsx';
import { HistoryView } from './views/HistoryView.jsx';
import { getReport } from './lib/api.js';

const SUBTITLE =
  'Validate that live redirects match your spec. Upload your rules sheet, audit every source URL, and verify each lands on its expected target — with the full hop chain and edge/origin detail per hop.';

function Shell() {
  const [tab, setTab] = useState(0);
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState('');

  const openReport = useCallback((r) => { setReport(r); setLoading(''); setTab(1); }, []);

  const openAudit = useCallback(async (file) => {
    setReport(null);
    setLoading(`Loading ${file}…`);
    setTab(1);
    try {
      const res = await getReport(file);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setReport(data);
      setLoading('');
    } catch (e) {
      setLoading(`Couldn't load report: ${e.message}`);
    }
  }, []);

  return (
    <>
      <PageBackground still={tab !== 0} />
      <div className="mx-auto max-w-6xl px-5 pb-20 pt-6">
        <Header />
        <p className="mt-3 max-w-2xl text-[13.5px] leading-relaxed text-muted">{SUBTITLE}</p>
        <Tabs active={tab} onChange={setTab} />
        <div className="mt-6">
          <div className={tab === 0 ? '' : 'hidden'}><NewAuditView onReport={openReport} /></div>
          <div className={tab === 1 ? '' : 'hidden'}><ReportView report={report} loading={loading} /></div>
          <div className={tab === 2 ? '' : 'hidden'}><HistoryView active={tab === 2} onOpenAudit={openAudit} /></div>
        </div>
      </div>
    </>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <Shell />
      </AuthProvider>
    </ThemeProvider>
  );
}
