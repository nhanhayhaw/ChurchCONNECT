/**
 * Reports.
 *
 * One catalogue on the left, one rendered report on the right. Every report
 * comes back from the API with its own column definitions, so this page never
 * hard-codes a report's shape - adding a report on the server makes it appear
 * here with no client change.
 */
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  FileBarChart, FileSpreadsheet, FileText, Printer, Users, ClipboardCheck, BellRing, Cake,
} from 'lucide-react';
import clsx from 'clsx';
import { api, buildQuery, downloadFile, ApiError } from '@/api/client';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import {
  PageHeader, Card, CardHeader, Button, Input, Select, EmptyState, ErrorState,
  TableSkeleton,
} from '@/components/ui';
import { formatDate, todayIso, addDaysIso } from '@/utils/format';

interface ReportMeta {
  key: string;
  title: string;
  category: 'membership' | 'attendance' | 'absentee' | 'birthday';
  description: string;
}

const CATEGORY_META = {
  membership: { label: 'Membership', icon: Users },
  attendance: { label: 'Attendance', icon: ClipboardCheck },
  absentee: { label: 'Absentees & follow-up', icon: BellRing },
  birthday: { label: 'Birthdays', icon: Cake },
} as const;

export default function ReportsPage() {
  const [params, setParams] = useSearchParams();
  const { can } = useAuth();
  const toast = useToast();

  const selected = params.get('report') ?? '';
  const [from, setFrom] = useState(params.get('from') ?? addDaysIso(todayIso(), -90));
  const [to, setTo] = useState(params.get('to') ?? todayIso());

  const catalogue = useQuery({
    queryKey: ['report-catalogue'],
    queryFn: () => api.get<{ reports: ReportMeta[] }>('/api/reports'),
    staleTime: 300_000,
  });

  // Select the first report automatically so the page is never blank.
  useEffect(() => {
    if (!selected && catalogue.data?.reports.length) {
      const next = new URLSearchParams(params);
      next.set('report', catalogue.data.reports[0]!.key);
      setParams(next, { replace: true });
    }
  }, [selected, catalogue.data, params, setParams]);

  const queryString = buildQuery({ from, to });

  const report = useQuery({
    queryKey: ['report', selected, queryString],
    queryFn: () => api.get(`/api/reports/${selected}${queryString}`),
    enabled: Boolean(selected),
  });

  const download = async (format: 'excel' | 'pdf') => {
    try {
      const extension = format === 'excel' ? 'xlsx' : 'pdf';
      await downloadFile(`/api/reports/${selected}/${format}${queryString}`, `${selected}-${todayIso()}.${extension}`);
      toast.success('Export started', `The ${extension.toUpperCase()} file is downloading.`);
    } catch (err) {
      toast.error('Export failed', err instanceof ApiError ? err.message : undefined);
    }
  };

  const grouped = (catalogue.data?.reports ?? []).reduce<Record<string, ReportMeta[]>>((acc, r) => {
    (acc[r.category] ??= []).push(r);
    return acc;
  }, {});

  return (
    <>
      <PageHeader
        title="Reports"
        description="Every report can be viewed on screen, printed, or exported to Excel and PDF."
        actions={
          selected && report.data ? (
            <>
              <Button variant="outline" onClick={() => window.print()} leftIcon={<Printer className="h-4 w-4" />}>
                Print
              </Button>
              {can('reports:export') && (
                <>
                  <Button variant="outline" onClick={() => download('excel')} leftIcon={<FileSpreadsheet className="h-4 w-4" />}>
                    Excel
                  </Button>
                  <Button variant="outline" onClick={() => download('pdf')} leftIcon={<FileText className="h-4 w-4" />}>
                    PDF
                  </Button>
                </>
              )}
            </>
          ) : undefined
        }
      />

      <div className="grid gap-5 lg:grid-cols-[18rem_1fr]">
        {/* --- Catalogue --------------------------------------------------- */}
        <nav className="no-print space-y-4" aria-label="Report catalogue">
          {Object.entries(CATEGORY_META).map(([key, meta]) => {
            const reports = grouped[key] ?? [];
            if (reports.length === 0) return null;
            const Icon = meta.icon;

            return (
              <Card key={key}>
                <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3 dark:border-navy-800">
                  <Icon className="h-4 w-4 text-slate-400" aria-hidden />
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    {meta.label}
                  </h2>
                </div>
                <ul className="p-2">
                  {reports.map((r) => (
                    <li key={r.key}>
                      <button
                        type="button"
                        onClick={() => {
                          const next = new URLSearchParams(params);
                          next.set('report', r.key);
                          setParams(next, { replace: true });
                        }}
                        aria-current={selected === r.key ? 'true' : undefined}
                        className={clsx(
                          'w-full rounded-lg px-3 py-2 text-left transition',
                          selected === r.key
                            ? 'bg-navy-50 text-navy-900 dark:bg-navy-800 dark:text-white'
                            : 'text-slate-600 hover:bg-slate-50 dark:text-slate-400 dark:hover:bg-navy-800/60',
                        )}
                      >
                        <span className="block text-sm font-medium">{r.title}</span>
                        <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-500">{r.description}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </Card>
            );
          })}
        </nav>

        {/* --- Rendered report --------------------------------------------- */}
        <div>
          <Card className="no-print mb-4">
            <div className="grid gap-3 p-4 sm:grid-cols-2">
              <Input label="From" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              <Input label="To" type="date" max={todayIso()} value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            <p className="border-t border-slate-200 px-4 py-2.5 text-xs text-slate-500 dark:border-navy-800 dark:text-slate-400">
              The date range applies to reports that cover a period. Snapshot reports (current membership, absentee
              alerts, upcoming birthdays) always reflect today.
            </p>
          </Card>

          <Card>
            {!selected ? (
              <EmptyState
                icon={<FileBarChart className="h-6 w-6" aria-hidden />}
                title="Choose a report"
                description="Pick one from the catalogue to see it here."
              />
            ) : report.isLoading ? (
              <TableSkeleton rows={10} columns={5} />
            ) : report.isError ? (
              <ErrorState message={(report.error as Error)?.message} onRetry={() => report.refetch()} />
            ) : (
              <>
                <CardHeader
                  title={report.data.title}
                  description={`${report.data.description} - generated ${formatDate(report.data.generatedAt)}`}
                  action={
                    <span className="tabular text-sm text-slate-500 dark:text-slate-400">
                      {report.data.rows.length} row(s)
                    </span>
                  }
                />

                {report.data.rows.length === 0 ? (
                  <EmptyState
                    title="No records matched this report"
                    description="Try a wider date range, or check that attendance has been recorded for the period."
                  />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="cc-table">
                      <thead>
                        <tr>
                          {report.data.columns.map((column: any) => (
                            <th key={column.key}>{column.header}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {report.data.rows.map((row: any, index: number) => (
                          <tr key={index}>
                            {report.data.columns.map((column: any) => {
                              const value = row[column.key];
                              const numeric = typeof value === 'number';
                              return (
                                <td key={column.key} className={numeric ? 'tabular' : undefined}>
                                  {value === null || value === undefined || value === '' ? (
                                    <span className="text-slate-400">-</span>
                                  ) : (
                                    String(value)
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
