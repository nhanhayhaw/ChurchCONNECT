/**
 * Dashboard charts.
 *
 * Each chart follows the same construction: pick the form from the data's job,
 * assign colour by that job (identity vs. state vs. magnitude), thin marks, a
 * recessive hairline grid, a legend whenever there is more than one series, a
 * hover tooltip, and a table-view twin supplied by ChartFrame.
 *
 * Note there is deliberately no dual-axis chart here. "New members per month"
 * and "total membership" have wildly different magnitudes, so they are two
 * separate figures rather than two y-scales sharing one plot.
 */
import { useMemo } from 'react';
import {
  ResponsiveContainer,
  LineChart, Line,
  BarChart, Bar,
  PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, LabelList,
} from 'recharts';
import { useTheme } from '@/hooks/useTheme';
import { getChartPalette, MARKS, CHART_HEIGHT } from './theme';
import { ChartFrame, ChartTooltipShell, TooltipRow, type LegendItem } from './ChartFrame';
import { formatDateShort, formatNumber, titleCase } from '@/utils/format';
import type { DashboardData } from '@/types';

/** Axis styling reused by every cartesian chart. */
function axisProps(colour: string) {
  return {
    tick: { fill: colour, fontSize: MARKS.axisFontSize },
    tickLine: false,
    axisLine: false,
  } as const;
}

// ---------------------------------------------------------------------------
// Attendance trend - present / absent / excused over the last N Sundays
// ---------------------------------------------------------------------------

export function AttendanceTrendChart({ data }: { data: DashboardData['charts']['attendanceTrend'] }) {
  const { isDark } = useTheme();
  const palette = getChartPalette(isDark);

  const series = useMemo(
    () => [
      { key: 'present', label: 'Present', colour: palette.status.present },
      { key: 'absent', label: 'Absent', colour: palette.status.absent },
      { key: 'excused', label: 'Excused', colour: palette.status.excused },
    ],
    [palette],
  );

  const legend: LegendItem[] = series.map((s) => ({ label: s.label, colour: s.colour }));

  return (
    <ChartFrame
      title="Attendance trend"
      description={`Sunday attendance over the last ${data.length} service(s)`}
      legend={legend}
      isEmpty={data.length === 0}
      emptyMessage="Record and finalise a Sunday register to start building the trend."
      tableRows={data}
      tableColumns={[
        { header: 'Service date', get: (r) => formatDateShort(r.date) },
        { header: 'Present', get: (r) => formatNumber(r.present), numeric: true },
        { header: 'Absent', get: (r) => formatNumber(r.absent), numeric: true },
        { header: 'Excused', get: (r) => formatNumber(r.excused), numeric: true },
      ]}
    >
      <ResponsiveContainer width="100%" height={CHART_HEIGHT.md}>
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
          {/* Horizontal hairlines only, solid - never dashed. */}
          <CartesianGrid vertical={false} stroke={palette.grid} strokeWidth={1} />
          <XAxis
            dataKey="date"
            tickFormatter={(v: string) => formatDateShort(v).replace(/ \d{4}$/, '')}
            {...axisProps(palette.textMuted)}
            minTickGap={16}
          />
          <YAxis {...axisProps(palette.textMuted)} width={38} allowDecimals={false} />
          <Tooltip
            cursor={{ stroke: palette.axis, strokeWidth: 1 }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              return (
                <ChartTooltipShell title={formatDateShort(String(label))}>
                  {series.map((s) => {
                    const point = payload.find((p) => p.dataKey === s.key);
                    return (
                      <TooltipRow
                        key={s.key}
                        colour={s.colour}
                        label={s.label}
                        value={formatNumber(Number(point?.value ?? 0))}
                      />
                    );
                  })}
                </ChartTooltipShell>
              );
            }}
          />
          {series.map((s) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={s.colour}
              strokeWidth={MARKS.lineWidth}
              dot={false}
              activeDot={{ r: MARKS.activeDotRadius, strokeWidth: 2, stroke: palette.ring }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

// ---------------------------------------------------------------------------
// Membership growth - new members per month (single series)
// ---------------------------------------------------------------------------

export function MembershipGrowthChart({ data }: { data: DashboardData['charts']['membershipGrowth'] }) {
  const { isDark } = useTheme();
  const palette = getChartPalette(isDark);

  // Direct-label only the busiest month; the axis and tooltip carry the rest.
  const peak = useMemo(
    () => data.reduce((best, row) => (row.newMembers > (best?.newMembers ?? -1) ? row : best), data[0]),
    [data],
  );

  const monthLabel = (value: string) => {
    const date = new Date(value);
    return Number.isNaN(date.getTime())
      ? value
      : date.toLocaleDateString('en-GB', { month: 'short' });
  };

  return (
    <ChartFrame
      title="Membership growth"
      description="New members registered each month"
      isEmpty={data.every((d) => d.newMembers === 0)}
      emptyMessage="No new members have been registered in the last twelve months."
      tableRows={data}
      tableColumns={[
        { header: 'Month', get: (r) => new Date(r.month).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) },
        { header: 'New members', get: (r) => formatNumber(r.newMembers), numeric: true },
        { header: 'Total membership', get: (r) => formatNumber(r.totalMembers), numeric: true },
      ]}
    >
      <ResponsiveContainer width="100%" height={CHART_HEIGHT.md}>
        <BarChart data={data} margin={{ top: 20, right: 16, bottom: 4, left: 0 }} barCategoryGap={MARKS.barCategoryGap}>
          <CartesianGrid vertical={false} stroke={palette.grid} strokeWidth={1} />
          <XAxis dataKey="month" tickFormatter={monthLabel} {...axisProps(palette.textMuted)} />
          <YAxis {...axisProps(palette.textMuted)} width={34} allowDecimals={false} />
          <Tooltip
            cursor={{ fill: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(15,42,74,0.04)' }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const row = payload[0]!.payload as (typeof data)[number];
              return (
                <ChartTooltipShell
                  title={new Date(row.month).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}
                >
                  <TooltipRow colour={palette.series[0]} label="New members" value={formatNumber(row.newMembers)} />
                  <TooltipRow label="Total membership" value={formatNumber(row.totalMembers)} />
                </ChartTooltipShell>
              );
            }}
          />
          {/* One series, one colour for every bar - length already encodes size. */}
          <Bar dataKey="newMembers" name="New members" fill={palette.series[0]} radius={MARKS.barRadius} maxBarSize={38}>
            <LabelList
              dataKey="newMembers"
              position="top"
              className="tabular"
              fill={palette.textSecondary}
              fontSize={11}
              formatter={(value: number, _n: unknown, entry: any) =>
                // Selective direct label: the peak month only.
                peak && entry?.payload?.month === peak.month && value > 0 ? String(value) : ''
              }
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

// ---------------------------------------------------------------------------
// Gender distribution - part to whole at a glance
// ---------------------------------------------------------------------------

export function GenderDonutChart({ data }: { data: DashboardData['charts']['genderDistribution'] }) {
  const { isDark } = useTheme();
  const palette = getChartPalette(isDark);

  const total = data.reduce((sum, d) => sum + d.value, 0);
  const coloured = data.map((d, i) => ({ ...d, colour: palette.series[i] ?? palette.series[0] }));
  const legend: LegendItem[] = coloured.map((d) => ({ label: d.name, colour: d.colour }));

  return (
    <ChartFrame
      title="Gender distribution"
      description="Active membership"
      legend={legend}
      isEmpty={total === 0}
      tableRows={coloured}
      tableColumns={[
        { header: 'Gender', get: (r) => r.name },
        { header: 'Members', get: (r) => formatNumber(r.value), numeric: true },
        { header: 'Share', get: (r) => `${total ? Math.round((r.value / total) * 100) : 0}%`, numeric: true },
      ]}
    >
      <div className="relative">
        <ResponsiveContainer width="100%" height={CHART_HEIGHT.md}>
          <PieChart>
            <Pie
              data={coloured}
              dataKey="value"
              nameKey="name"
              innerRadius="62%"
              outerRadius="88%"
              paddingAngle={2}
              startAngle={90}
              endAngle={-270}
              strokeWidth={2}
              stroke={palette.ring}
            >
              {coloured.map((entry) => (
                <Cell key={entry.name} fill={entry.colour} />
              ))}
            </Pie>
            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const row = payload[0]!.payload as (typeof coloured)[number];
                return (
                  <ChartTooltipShell title={row.name}>
                    <TooltipRow colour={row.colour} label="Members" value={formatNumber(row.value)} />
                    <TooltipRow label="Share" value={`${total ? Math.round((row.value / total) * 100) : 0}%`} />
                  </ChartTooltipShell>
                );
              }}
            />
          </PieChart>
        </ResponsiveContainer>

        {/* Centre figure: proportional digits, not tabular, at this size. */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-semibold text-slate-900 dark:text-white">{formatNumber(total)}</span>
          <span className="text-xs text-slate-500 dark:text-slate-400">active members</span>
        </div>
      </div>

      {/* Direct labels beneath, so the split is readable without hovering. */}
      <div className="mt-1 flex justify-center gap-6 px-4">
        {coloured.map((entry) => (
          <div key={entry.name} className="text-center">
            <p className="tabular text-sm font-semibold text-slate-900 dark:text-slate-100">
              {formatNumber(entry.value)}
              <span className="ml-1 text-xs font-normal text-slate-500 dark:text-slate-400">
                ({total ? Math.round((entry.value / total) * 100) : 0}%)
              </span>
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">{entry.name}</p>
          </div>
        ))}
      </div>
    </ChartFrame>
  );
}

// ---------------------------------------------------------------------------
// Department distribution - horizontal bars, one hue
// ---------------------------------------------------------------------------

export function DepartmentDistributionChart({
  data,
}: {
  data: DashboardData['charts']['departmentDistribution'];
}) {
  const { isDark } = useTheme();
  const palette = getChartPalette(isDark);

  // Long department names read far better on a horizontal axis.
  const rows = useMemo(() => data.slice(0, 12), [data]);
  const height = Math.max(CHART_HEIGHT.md, rows.length * 26 + 40);

  return (
    <ChartFrame
      title="Members by department"
      description={data.length > 12 ? 'Twelve largest departments' : 'Active membership per department'}
      isEmpty={rows.length === 0}
      tableRows={data}
      tableColumns={[
        { header: 'Department', get: (r) => r.name },
        { header: 'Members', get: (r) => formatNumber(r.value), numeric: true },
      ]}
    >
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 28, bottom: 4, left: 8 }} barCategoryGap={MARKS.barCategoryGap}>
          <CartesianGrid horizontal={false} stroke={palette.grid} strokeWidth={1} />
          <XAxis type="number" {...axisProps(palette.textMuted)} allowDecimals={false} />
          <YAxis type="category" dataKey="name" {...axisProps(palette.textMuted)} width={116} />
          <Tooltip
            cursor={{ fill: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(15,42,74,0.04)' }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const row = payload[0]!.payload as (typeof rows)[number];
              return (
                <ChartTooltipShell title={row.name}>
                  <TooltipRow colour={palette.series[0]} label="Members" value={formatNumber(row.value)} />
                </ChartTooltipShell>
              );
            }}
          />
          <Bar dataKey="value" name="Members" fill={palette.series[0]} radius={MARKS.barRadiusHorizontal} maxBarSize={18}>
            <LabelList
              dataKey="value"
              position="right"
              className="tabular"
              fill={palette.textSecondary}
              fontSize={11}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

// ---------------------------------------------------------------------------
// Attendance comparison - present / absent / excused by service type
// ---------------------------------------------------------------------------

export function AttendanceComparisonChart({
  data,
}: {
  data: DashboardData['charts']['attendanceComparison'];
}) {
  const { isDark } = useTheme();
  const palette = getChartPalette(isDark);

  const series = [
    { key: 'present', label: 'Present', colour: palette.status.present },
    { key: 'absent', label: 'Absent', colour: palette.status.absent },
    { key: 'excused', label: 'Excused', colour: palette.status.excused },
  ];

  return (
    <ChartFrame
      title="Attendance comparison"
      description="This month, by service type"
      legend={series.map((s) => ({ label: s.label, colour: s.colour }))}
      isEmpty={data.length === 0}
      emptyMessage="No attendance has been recorded this month."
      tableRows={data}
      tableColumns={[
        { header: 'Service', get: (r) => r.label },
        { header: 'Present', get: (r) => formatNumber(r.present), numeric: true },
        { header: 'Absent', get: (r) => formatNumber(r.absent), numeric: true },
        { header: 'Excused', get: (r) => formatNumber(r.excused), numeric: true },
      ]}
    >
      <ResponsiveContainer width="100%" height={CHART_HEIGHT.md}>
        <BarChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 0 }} barGap={MARKS.barGap} barCategoryGap={MARKS.barCategoryGap}>
          <CartesianGrid vertical={false} stroke={palette.grid} strokeWidth={1} />
          <XAxis
            dataKey="label"
            {...axisProps(palette.textMuted)}
            interval={0}
            tickFormatter={(v: string) => (v.length > 14 ? `${v.slice(0, 13)}...` : v)}
          />
          <YAxis {...axisProps(palette.textMuted)} width={38} allowDecimals={false} />
          <Tooltip
            cursor={{ fill: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(15,42,74,0.04)' }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              return (
                <ChartTooltipShell title={String(label)}>
                  {series.map((s) => {
                    const point = payload.find((p) => p.dataKey === s.key);
                    return (
                      <TooltipRow
                        key={s.key}
                        colour={s.colour}
                        label={s.label}
                        value={formatNumber(Number(point?.value ?? 0))}
                      />
                    );
                  })}
                </ChartTooltipShell>
              );
            }}
          />
          {series.map((s) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.label}
              fill={s.colour}
              radius={MARKS.barRadius}
              maxBarSize={26}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}

// ---------------------------------------------------------------------------
// Age distribution - ordered bands, single hue
// ---------------------------------------------------------------------------

export function AgeDistributionChart({ data }: { data: DashboardData['charts']['ageDistribution'] }) {
  const { isDark } = useTheme();
  const palette = getChartPalette(isDark);

  return (
    <ChartFrame
      title="Members by age group"
      description="Active membership"
      isEmpty={data.length === 0}
      tableRows={data}
      tableColumns={[
        { header: 'Age group', get: (r) => titleCase(r.bucket) },
        { header: 'Members', get: (r) => formatNumber(r.value), numeric: true },
      ]}
    >
      <ResponsiveContainer width="100%" height={CHART_HEIGHT.sm}>
        <BarChart data={data} margin={{ top: 16, right: 16, bottom: 4, left: 0 }} barCategoryGap={MARKS.barCategoryGap}>
          <CartesianGrid vertical={false} stroke={palette.grid} strokeWidth={1} />
          <XAxis dataKey="bucket" {...axisProps(palette.textMuted)} interval={0} />
          <YAxis {...axisProps(palette.textMuted)} width={34} allowDecimals={false} />
          <Tooltip
            cursor={{ fill: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(15,42,74,0.04)' }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              return (
                <ChartTooltipShell title={`Age ${label}`}>
                  <TooltipRow
                    colour={palette.series[0]}
                    label="Members"
                    value={formatNumber(Number(payload[0]!.value ?? 0))}
                  />
                </ChartTooltipShell>
              );
            }}
          />
          <Bar dataKey="value" name="Members" fill={palette.series[0]} radius={MARKS.barRadius} maxBarSize={44} />
        </BarChart>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
