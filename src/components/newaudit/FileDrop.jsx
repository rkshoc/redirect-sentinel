import { useRef, useState } from 'react';
import { FileSpreadsheet } from 'lucide-react';
import { cn } from '../../lib/cn.js';

// Animated drop zone (Aceternity File Upload style) → calls onFile(file).
export function FileDrop({ onFile }) {
  const input = useRef(null);
  const [over, setOver] = useState(false);

  const pick = (files) => { if (files && files[0]) onFile(files[0]); };

  return (
    <div
      onClick={() => input.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragEnter={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={(e) => { e.preventDefault(); setOver(false); }}
      onDrop={(e) => { e.preventDefault(); setOver(false); pick(e.dataTransfer.files); }}
      className={cn(
        'cursor-pointer rounded-2xl border border-dashed bg-bg/40 p-8 text-center transition',
        over ? 'border-aem bg-panel2' : 'border-line2 hover:border-aem hover:bg-panel2/60',
      )}
    >
      <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-xl bg-panel2 text-aem">
        <FileSpreadsheet size={22} />
      </div>
      <div className="text-sm font-semibold">Drop your Excel/CSV here, or click to browse</div>
      <div className="mt-1.5 font-mono text-[11px] text-faint">
        Expected columns: Rule Name · Source URL · Expected Target · (extra cols carried, ignored)
      </div>
      <input ref={input} type="file" accept=".xlsx,.xls,.csv" hidden onChange={(e) => pick(e.target.files)} />
    </div>
  );
}
