/**
 * Responsive table shell and pagination.
 *
 * On screens narrower than `lg` the table is hidden and a card list renders
 * instead, because a horizontally scrolling twelve-column table on a phone is
 * unusable for the church secretary taking a register on the way to service.
 * Both views are driven by the same column definitions.
 */
import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight, ChevronsUpDown, ChevronUp, ChevronDown } from 'lucide-react';
import clsx from 'clsx';
import { Button } from './Button';

export interface Column<T> {
  key: string;
  header: string;
  /** Cell renderer for the desktop table. */
  render: (row: T) => ReactNode;
  sortable?: boolean;
  className?: string;
  /** Hide on medium screens to keep the table readable. */
  hideBelow?: 'sm' | 'md' | 'lg' | 'xl';
}

export interface SortState {
  by: string;
  dir: 'asc' | 'desc';
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  sort,
  onSortChange,
  onRowClick,
  renderMobileCard,
  emptyState,
  isLoading,
  loadingState,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string | number;
  sort?: SortState;
  onSortChange?: (next: SortState) => void;
  onRowClick?: (row: T) => void;
  renderMobileCard?: (row: T) => ReactNode;
  emptyState?: ReactNode;
  isLoading?: boolean;
  loadingState?: ReactNode;
}) {
  const toggleSort = (key: string) => {
    if (!onSortChange) return;
    const dir: 'asc' | 'desc' = sort?.by === key && sort.dir === 'asc' ? 'desc' : 'asc';
    onSortChange({ by: key, dir });
  };

  if (isLoading) return <>{loadingState}</>;
  if (rows.length === 0) return <>{emptyState}</>;

  const HIDE_CLASSES: Record<string, string> = {
    sm: 'hidden sm:table-cell',
    md: 'hidden md:table-cell',
    lg: 'hidden lg:table-cell',
    xl: 'hidden xl:table-cell',
  };

  return (
    <>
      {/* Desktop / tablet */}
      <div className={clsx('overflow-x-auto', renderMobileCard && 'hidden lg:block')}>
        <table className="cc-table">
          <thead>
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  className={clsx(column.className, column.hideBelow && HIDE_CLASSES[column.hideBelow])}
                  aria-sort={
                    sort?.by === column.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined
                  }
                >
                  {column.sortable && onSortChange ? (
                    <button
                      type="button"
                      onClick={() => toggleSort(column.key)}
                      className="inline-flex items-center gap-1 transition hover:text-navy-700 dark:hover:text-slate-200"
                    >
                      {column.header}
                      {sort?.by !== column.key ? (
                        <ChevronsUpDown className="h-3 w-3 opacity-50" aria-hidden />
                      ) : sort.dir === 'asc' ? (
                        <ChevronUp className="h-3 w-3" aria-hidden />
                      ) : (
                        <ChevronDown className="h-3 w-3" aria-hidden />
                      )}
                    </button>
                  ) : (
                    column.header
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={clsx(onRowClick && 'cursor-pointer')}
              >
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={clsx(column.className, column.hideBelow && HIDE_CLASSES[column.hideBelow])}
                  >
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile card list */}
      {renderMobileCard && (
        <div className="divide-y divide-slate-100 dark:divide-navy-800 lg:hidden">
          {rows.map((row) => (
            <div key={rowKey(row)} className="p-4">
              {renderMobileCard(row)}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

export function Pagination({
  page,
  pageSize,
  total,
  totalPages,
  onPageChange,
  onPageSizeChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
}) {
  if (total === 0) return null;

  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  // Show a compact window of page numbers around the current page.
  const windowSize = 5;
  let start = Math.max(1, page - Math.floor(windowSize / 2));
  const end = Math.min(totalPages, start + windowSize - 1);
  start = Math.max(1, end - windowSize + 1);
  const pages = Array.from({ length: end - start + 1 }, (_, i) => start + i);

  return (
    <div className="no-print flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-4 py-3 dark:border-navy-800">
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Showing <span className="font-medium text-slate-700 dark:text-slate-200">{first}</span>-
        <span className="font-medium text-slate-700 dark:text-slate-200">{last}</span> of{' '}
        <span className="font-medium text-slate-700 dark:text-slate-200">{total.toLocaleString('en-GB')}</span>
      </p>

      <div className="flex items-center gap-2">
        {onPageSizeChange && (
          <select
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            className="cc-input h-8 w-auto py-0 text-xs"
            aria-label="Rows per page"
          >
            {[10, 20, 50, 100].map((size) => (
              <option key={size} value={size}>
                {size} per page
              </option>
            ))}
          </select>
        )}

        <div className="flex items-center gap-1">
          <Button
            size="icon"
            variant="outline"
            onClick={() => onPageChange(page - 1)}
            disabled={page <= 1}
            aria-label="Previous page"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </Button>

          {start > 1 && (
            <>
              <PageButton page={1} current={page} onClick={onPageChange} />
              {start > 2 && <span className="px-1 text-xs text-slate-400">...</span>}
            </>
          )}

          {pages.map((p) => (
            <PageButton key={p} page={p} current={page} onClick={onPageChange} />
          ))}

          {end < totalPages && (
            <>
              {end < totalPages - 1 && <span className="px-1 text-xs text-slate-400">...</span>}
              <PageButton page={totalPages} current={page} onClick={onPageChange} />
            </>
          )}

          <Button
            size="icon"
            variant="outline"
            onClick={() => onPageChange(page + 1)}
            disabled={page >= totalPages}
            aria-label="Next page"
          >
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      </div>
    </div>
  );
}

function PageButton({ page, current, onClick }: { page: number; current: number; onClick: (p: number) => void }) {
  const isCurrent = page === current;
  return (
    <button
      type="button"
      onClick={() => onClick(page)}
      aria-current={isCurrent ? 'page' : undefined}
      className={clsx(
        'h-9 min-w-9 rounded-lg px-2 text-xs font-medium transition',
        isCurrent
          ? 'bg-navy-900 text-white dark:bg-navy-700'
          : 'text-slate-600 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-navy-800',
      )}
    >
      {page}
    </button>
  );
}
