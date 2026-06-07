import { Banner } from '../components/Banner.jsx';
import { SummaryBar } from '../components/report/SummaryBar.jsx';
import { DataGrid } from '../components/report/DataGrid.jsx';

export function ReportView({ report, loading }) {
  if (loading) {
    return <div className="py-16 text-center font-mono text-sm text-faint">{loading}</div>;
  }
  if (!report) {
    return (
      <div className="card py-16 text-center font-mono text-sm text-faint">
        No report loaded. Run an audit or open one from History.
      </div>
    );
  }
  const partial = report.status === 'partial';
  const deepError = report.deepCheck?.error;
  return (
    <div className="animate-fade-up">
      <Banner show={partial && !deepError} tone="info">
        Partial report — {report.deepCheck?.pending || 0} URL(s) re-running via Playwright. This view refreshes automatically.
      </Banner>
      <Banner show={!!deepError} tone="warn">
        Deep-check unavailable — {deepError} The blocked rows stayed inconclusive (not counted as failures).
      </Banner>
      <SummaryBar summary={report.summary} filename={report.filename} createdUtc={report.createdUtc} />
      <DataGrid report={report} />
    </div>
  );
}
