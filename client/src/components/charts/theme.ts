/**
 * Chart colour tokens and shared mark specifications.
 *
 * COLOUR SOURCE
 * The categorical hues and the status palette below are taken verbatim from a
 * pre-validated reference palette rather than invented, because getting
 * colour-vision separation right is a measurement, not a judgement.
 *
 * VALIDATION - run against RT AG Connect's own surfaces, not the defaults
 *
 *   node scripts/validate_palette.js "#2a78d6,#eb6834,#1baf7a" --mode light --surface "#ffffff"
 *   node scripts/validate_palette.js "#3987e5,#d95926,#199e70" --mode dark  --surface "#0A1C33"
 *
 * Results (categorical slots):
 *   light  ALL CHECKS PASS - worst adjacent CVD dE 9.2 (deutan), normal-vision 27.6.
 *          WARN: slot 3 #1baf7a sits at 2.82:1 on white. Slot 3 is not currently
 *          used by any chart, and the relief rule is satisfied regardless (see
 *          below), so it is retained rather than re-stepped.
 *   dark   ALL CHECKS PASS - worst adjacent CVD dE 9.4, normal-vision 26.5,
 *          all three >= 3:1 against #0A1C33.
 *
 *   node scripts/validate_palette.js "#0ca30c,#fab219,#d03b3b" --mode light --surface "#ffffff"
 *
 * Results (status slots):
 *   Separation passes comfortably - CVD dE 11.3 (protan), normal-vision 27.6.
 *   The validator reports FAIL on the lightness band, but that check is scoped
 *   to CATEGORICAL palettes; the status set is a fixed reserved palette that
 *   deliberately sits outside it and is never re-themed.
 *   The finding that does apply: amber #fab219 measures 1.83:1 on white.
 *
 * THE RELIEF RULE, and how it is satisfied here
 * A sub-3:1 contrast WARN is not dismissable - it obligates visible labels or a
 * table view. Every chart in this application is wrapped in ChartFrame, which
 * supplies BOTH a legend (for two or more series) and a table-view twin, so no
 * value is ever reachable only by distinguishing a low-contrast mark. Tooltips
 * are additive on top of that, never the only route to a number.
 *
 * ENCODING RULES APPLIED HERE
 *  - Present / absent / excused are STATES, not identities, so they use the
 *    reserved status palette. They always ship with a legend, so colour never
 *    carries the meaning alone.
 *  - Department, age and growth charts are single-series: one hue for every
 *    bar. Colouring bars darker-where-bigger would double-encode length as hue.
 *  - There is no dual-axis chart anywhere in this application. Where two
 *    measures of different magnitude exist (new members vs. total membership),
 *    they are shown as two separate figures.
 */

export interface ChartPalette {
  surface: string;
  grid: string;
  axis: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  /** Categorical identity slots, assigned in fixed order and never cycled. */
  series: [string, string, string];
  status: {
    present: string;
    excused: string;
    absent: string;
  };
  /** Ring drawn between adjacent/overlapping fills - the surface, 2px. */
  ring: string;
}

const LIGHT: ChartPalette = {
  surface: '#ffffff',
  grid: '#E2E8F0',
  axis: '#CBD5E1',
  textPrimary: '#0F172A',
  textSecondary: '#475569',
  textMuted: '#94A3B8',
  series: ['#2a78d6', '#eb6834', '#1baf7a'],
  status: {
    present: '#0ca30c',
    excused: '#fab219',
    absent: '#d03b3b',
  },
  ring: '#ffffff',
};

const DARK: ChartPalette = {
  surface: '#0A1C33',
  grid: '#1B3050',
  axis: '#254163',
  textPrimary: '#F1F5F9',
  textSecondary: '#CBD5E1',
  textMuted: '#7C93AF',
  series: ['#3987e5', '#d95926', '#199e70'],
  status: {
    present: '#0ca30c',
    excused: '#fab219',
    absent: '#d03b3b',
  },
  ring: '#0A1C33',
};

export function getChartPalette(isDark: boolean): ChartPalette {
  return isDark ? DARK : LIGHT;
}

/**
 * Mark specifications shared by every chart.
 * Thin marks and a recessive grid - the data should be the loudest thing.
 */
export const MARKS = {
  lineWidth: 2,
  /** Rounded data-end on bars: [topLeft, topRight, bottomRight, bottomLeft]. */
  barRadius: [4, 4, 0, 0] as [number, number, number, number],
  barRadiusHorizontal: [0, 4, 4, 0] as [number, number, number, number],
  /** 2px of surface between adjacent bars in a group. */
  barGap: 2,
  barCategoryGap: '22%',
  activeDotRadius: 4,
  /** Hover targets must be comfortably larger than the mark itself. */
  tooltipCursorWidth: 24,
  axisFontSize: 11,
} as const;

export const CHART_HEIGHT = {
  /** Includes room for the x-axis band - the plot must never clip its labels. */
  sm: 200,
  md: 260,
  lg: 320,
} as const;
