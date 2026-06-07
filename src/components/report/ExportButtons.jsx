import { Download, Maximize2 } from 'lucide-react';
import { exportExcel, exportJSON } from '../../lib/export.js';
import { cn } from '../../lib/cn.js';

const btn = 'inline-flex items-center gap-1.5 rounded-lg border border-line bg-panel/60 px-3 py-1.5 font-mono text-[11.5px] text-muted transition hover:border-aem hover:text-ink';

export function ExportButtons({ report, onExpandAll, shownCount, totalCount }) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <button className={btn} onClick={onExpandAll}><Maximize2 size={13} /> Expand all</button>
      <button className={btn} onClick={() => exportExcel(report)}><Download size={13} /> Excel (per-hop columns)</button>
      <button className={btn} onClick={() => exportJSON(report)}><Download size={13} /> JSON</button>
      <span className={cn('ml-auto font-mono text-[11px] text-faint')}>{shownCount} of {totalCount} shown</span>
    </div>
  );
}
