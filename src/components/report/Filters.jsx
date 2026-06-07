import { Search } from 'lucide-react';
import { cn } from '../../lib/cn.js';

// Filter chips + free-text search (CLAUDE.md §7). Counts come from the report.
export function Filters({ filter, query, counts, onFilter, onQuery }) {
  const chips = [
    ['all', `All (${counts.all})`],
    ['fail', `Failures (${counts.fail})`],
    ['blocked', `Blocked (${counts.blocked})`],
    ['302', '302 present'],
    ['long', 'Chains > 2 hops'],
  ];
  return (
    <div className="mb-2.5 flex flex-wrap items-center gap-2">
      {chips.map(([key, label]) => (
        <button
          key={key}
          onClick={() => onFilter(key)}
          className={cn(
            'rounded-full border px-3 py-1.5 font-mono text-[11.5px] transition',
            filter === key ? 'border-ak bg-panel2 text-ink' : 'border-line bg-panel/60 text-muted hover:border-line2 hover:text-ink',
          )}
        >
          {label}
        </button>
      ))}
      <div className="relative ml-auto">
        <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
        <input
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="search rule / url…"
          className="w-44 rounded-lg border border-line bg-panel/60 py-1.5 pl-8 pr-3 font-mono text-[12px] text-ink outline-none focus:border-aem"
        />
      </div>
    </div>
  );
}
