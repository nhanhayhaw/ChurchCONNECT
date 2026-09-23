/**
 * Shared chart chrome: title, legend, table-view twin and empty state.
 *
 * Every chart in RT AG Connect is wrapped in this. The table toggle is not
 * decoration - it is the accessible equivalent of the chart, so no value is
 * ever reachable only by hovering a coloured mark.
 */
import { useState, type ReactNode } from 'react';
import { Table2, BarChart3 } from 'lucide-react';
import clsx from 'clsx';
import { EmptyState } from '@/components/ui/States';

export interface LegendItem {
  label: string;
  colour: string;
}

export function ChartLegend({ items, className }: { items: LegendItem[]; className?: string }) {
  // A single series needs no legend box - the chart title already names it.
  if (items.length < 2) return null;

  return (
    <ul className={clsx('flex flex-wrap items-center gap-x-4 gap-y-1.5', className)}>
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-sm"
            style={{ backgroundColor: item.colour }}
            aria-hidden
          />
          {/* Label wears text ink, never the series colour. */}
          <span className="text-xs text-slate-600 dark:text-slate-400">{item.label}</span>
        </li>
      ))}
    </ul>
  );
}

export interface TableViewColumn<T> {
  header: string;
  get: (row: T) => ReactNode;
  numeric?: boolean;
}

export function ChartFrame<T>({
  title,
  description,
  legend,
  action,
  children,
  tableRows,
  tableColumns,
  isEmpty,
  emptyMessage = 'There is no data for this period yet.',
  className,
}: {
  title: string;
  description?: string;
  legend?: LegendItem[];
  action?: ReactNode;
  children: ReactNode;
  tableRows?: T[];
  tableColumns?: TableViewColumn<T>[];
  isEmpty?: boolean;
  emptyMessage?: string;
  className?: string;
}) {
  const [showTable, setShowTable] = useState(false);
  const hasTable = Boolean(tableRows && tableColumns);

  return (
    <section className={clsx('cc-card flex flex-col', className)}>
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pb-3 pt-4">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
          {description && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{description}</p>}
        </div>
        <div className="no-print flex items-center gap-2">
          {action}
          {hasTable && (
            <button
              type="button"
              onClick={() => setShowTable((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 dark:border-navy-700 dark:text-slate-400 dark:hover:bg-navy-800"
              aria-pressed={showTable}
            >
              {showTable ? <BarChart3 className="h-3.5 w-3.5" aria-hidden /> : <Table2 className="h-3.5 w-3.5" aria-hidden />}
              {showTable ? 'Chart' : 'Table'}
            </button>
          )}
        </div>
      </div>

      {legend && legend.length > 1 && !showTable && (
        <ChartLegend items={legend} className="px-5 pb-3" />
      )}

      <div className="min-w-0 flex-1 px-2 pb-4">
        {isEmpty ? (
          <EmptyState title="Nothing to chart yet" description={emptyMessage} className="py-10" />
        ) : showTable && hasTable ? (
          <div className="max-h-80 overflow-auto px-3">
            <table className="cc-table">
              <thead>
                <tr>
                  {tableColumns!.map((column) => (
                    <th key={column.header} className={column.numeric ? 'text-right' : undefined}>
                      {column.header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tableRows!.map((row, index) => (
                  <tr key={index}>
                    {tableColumns!.map((column) => (
                      <td
                        key={column.header}
                        className={column.numeric ? 'tabular text-right' : undefined}
                      >
                        {column.get(row)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          children
        )}
      </div>
    </section>
  );
}

/** Tooltip surface shared by every chart. */
export function ChartTooltipShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-panel dark:border-navy-700 dark:bg-navy-900">
      <p className="mb-1.5 text-xs font-semibold text-slate-900 dark:text-slate-100">{title}</p>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

export function TooltipRow({ colour, label, value }: { colour?: string; label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 text-xs">
      <span className="flex items-center gap-1.5 text-slate-600 dark:text-slate-400">
        {colour && <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: colour }} aria-hidden />}
        {label}
      </span>
      <span className="tabular font-medium text-slate-900 dark:text-slate-100">{value}</span>
    </div>
  );
}
