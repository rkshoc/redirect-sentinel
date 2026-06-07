import { useRef, useState } from 'react';
import { FileSpreadsheet } from 'lucide-react';
import { cn } from '../../lib/cn.js';

// Animated drop zone (Aceternity File Upload style). Accepts MULTIPLE files →
// calls onFiles(File[]).
export function FileDrop({ onFiles }) {
  const input = useRef(null);
  const [over, setOver] = useState(false);

  const pick = (fileList) => {
    const files = Array.from(fileList || []);
    if (files.length) onFiles(files);
  };

  return (
    <div
      onClick={() => input.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragEnter={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={(e) => { e.preventDefault(); setOver(false); }}
      onDrop={(e) => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files); }}
      className={cn(
        'group cursor-pointer rounded-2xl border border-dashed bg-bg/40 p-8 text-center transition-all duration-300',
        over ? 'scale-[1.01] border-aem bg-panel2 shadow-xl shadow-aem/20' : 'border-line2 hover:border-aem hover:bg-panel2/60',
      )}
    >
      <div className={cn('mx-auto mb-3 grid h-12 w-12 place-items-center rounded-xl bg-panel2 text-aem transition-transform group-hover:scale-110', over && 'float')}>
        <FileSpreadsheet size={22} />
      </div>
      <div className="text-sm font-semibold">Drop your Excel/CSV files here, or click to browse</div>
      <div className="mt-1.5 font-mono text-[11px] text-faint">
        One or more sheets · columns: Rule Name · Source URL · Expected Target · (extras carried, ignored)
      </div>
      <input
        ref={input}
        type="file"
        accept=".xlsx,.xls,.csv"
        multiple
        hidden
        onChange={(e) => { pick(e.target.files); e.target.value = ''; }}
      />
    </div>
  );
}
