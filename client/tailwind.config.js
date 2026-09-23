/**
 * ChurchConnect design tokens.
 *
 * The palette is deliberately narrow: deep navy carries the brand and all
 * primary actions, gold is reserved for accents and highlights only, and
 * everything else is a neutral. Status colours (success/warning/danger) are
 * used solely to convey state, never for decoration - which is what keeps the
 * interface calm at the density this application needs.
 */
/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: {
          50: '#F2F5F9',
          100: '#E2E9F1',
          200: '#C5D3E4',
          300: '#9BB2CD',
          400: '#6A8AB0',
          500: '#456A96',
          600: '#31527A',
          700: '#254163',
          800: '#1B3050',
          900: '#0F2A4A',
          950: '#0A1C33',
        },
        gold: {
          50: '#FBF7EF',
          100: '#F5EBD6',
          200: '#EAD5AC',
          300: '#DBB877',
          400: '#CC9E4C',
          500: '#B8892B',
          600: '#9C6E22',
          700: '#7C531F',
          800: '#684420',
          900: '#59391E',
        },
      },
      fontFamily: {
        sans: ['Inter', 'Segoe UI', 'system-ui', '-apple-system', 'sans-serif'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      boxShadow: {
        card: '0 1px 2px 0 rgb(15 42 74 / 0.04), 0 1px 3px 0 rgb(15 42 74 / 0.06)',
        'card-hover': '0 4px 6px -1px rgb(15 42 74 / 0.08), 0 2px 4px -2px rgb(15 42 74 / 0.06)',
        panel: '0 10px 30px -12px rgb(15 42 74 / 0.25)',
      },
      borderRadius: {
        xl: '0.75rem',
        '2xl': '1rem',
      },
      keyframes: {
        'fade-in': { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        'slide-up': {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
      },
      animation: {
        'fade-in': 'fade-in 160ms ease-out',
        'slide-up': 'slide-up 200ms ease-out',
      },
    },
  },
  plugins: [],
};
