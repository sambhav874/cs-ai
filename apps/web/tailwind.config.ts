import type { Config } from 'tailwindcss'
import animate from 'tailwindcss-animate'

/*
 * cs-ai theme. Every value lives in src/styles/tokens.css; this file only
 * names them for Tailwind.
 *
 * Use the families below and nothing else. `gray-*`, `blue-*` and the other
 * stock hues are off-system (scripts/check-design-system.mjs fails the build on
 * them), because a raw hue is a colour that has escaped its meaning.
 *
 *   surface-*  neutral grounds and borders       fg-*  neutral text
 *   primary-*  action and focus                  success-*  binding
 *   info-*     in flight      attention-*  your turn      risk-*  exposure
 *   assist-*   a model wrote this
 */

const rgb = (name: string) => `rgb(var(--${name}) / <alpha-value>)`

const scale = (family: string, steps: Array<string | number>) =>
  Object.fromEntries(steps.map((s) => [s, rgb(`c-${family}-${s}`)]))

const SOLID = ['solid', 'solid-hover']

const config: Config = {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        border: rgb('border'),
        input: rgb('input'),
        ring: rgb('ring'),
        background: rgb('background'),
        foreground: rgb('foreground'),
        primary: {
          DEFAULT: rgb('primary'),
          foreground: rgb('primary-foreground'),
          ...scale('primary', [50, 100, 200, 500, 700, 800, ...SOLID]),
        },
        secondary: { DEFAULT: rgb('secondary'), foreground: rgb('secondary-foreground') },
        muted: { DEFAULT: rgb('muted'), foreground: rgb('muted-foreground') },
        accent: { DEFAULT: rgb('accent'), foreground: rgb('accent-foreground') },
        destructive: { DEFAULT: rgb('destructive'), foreground: rgb('destructive-foreground') },
        card: { DEFAULT: rgb('card'), foreground: rgb('card-foreground') },
        popover: { DEFAULT: rgb('popover'), foreground: rgb('popover-foreground') },
        scrim: rgb('scrim'),
        inverse: { DEFAULT: rgb('inverse'), fg: rgb('inverse-foreground') },

        surface: scale('surface', [0, 50, 100, 200, 300]),
        fg: scale('fg', [350, 400, 500, 700, 950]),

        success: { DEFAULT: rgb('success'), ...scale('success', [50, 100, 200, 500, 700, 800, ...SOLID]) },
        info: { DEFAULT: rgb('info'), ...scale('info', [50, 100, 200, 600, 700, ...SOLID]) },
        attention: { DEFAULT: rgb('attention'), ...scale('attention', [50, 100, 200, 600, 700, ...SOLID]) },
        risk: { DEFAULT: rgb('destructive'), ...scale('risk', [50, 100, 200, 600, 700, 900, ...SOLID]) },
        assist: {
          DEFAULT: rgb('assist'),
          foreground: rgb('assist-foreground'),
          ...scale('assist', [50, 200, 600, 700, 900, ...SOLID]),
        },
      },

      fontFamily: {
        // Inter for the interface, Source Serif for contract text, JetBrains
        // Mono for anything a machine produced. Self-hosted: a self-host
        // install must not call out to a font CDN.
        sans: ["'Inter Variable'", 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        serif: ["'Source Serif 4 Variable'", 'Georgia', 'Times New Roman', 'serif'],
        mono: ["'JetBrains Mono Variable'", 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },

      fontSize: {
        // Named steps. The second member carries leading and tracking so a
        // size can never be used at the wrong rhythm.
        display: ['44px', { lineHeight: '1.1', letterSpacing: '-0.035em', fontWeight: '600' }],
        title: ['22px', { lineHeight: '1.25', letterSpacing: '-0.022em', fontWeight: '600' }],
        section: ['15px', { lineHeight: '1.4', letterSpacing: '-0.011em', fontWeight: '600' }],
        body: ['14px', { lineHeight: '1.55', letterSpacing: '-0.006em' }],
        dense: ['13px', { lineHeight: '1.45', letterSpacing: '-0.003em' }],
        eyebrow: ['11px', { lineHeight: '1.4', letterSpacing: '0.06em', fontWeight: '600' }],
        paper: ['16px', { lineHeight: '1.65' }],
        micro: ['11px', { lineHeight: '1.6' }],
      },

      borderRadius: {
        sm: 'calc(var(--radius) - 2px)', // 6px — chip, small control
        md: 'var(--radius)',             // 8px — button, field
        lg: 'calc(var(--radius) + 4px)', // 12px — card, panel
        xl: 'calc(var(--radius) + 8px)', // 16px — dialog
        paper: '4px',
        chip: '6px',
        card: '12px',
      },

      boxShadow: {
        e0: 'none',
        e1: 'var(--shadow-e1)',
        e2: 'var(--shadow-e2)',
        e3: 'var(--shadow-e3)',
        page: 'var(--shadow-page)',
      },

      transitionTimingFunction: {
        out: 'var(--ease-out)',
        'in-out': 'var(--ease-in-out)',
      },
      transitionDuration: {
        micro: 'var(--dur-micro)',
        comp: 'var(--dur-comp)',
        scene: 'var(--dur-scene)',
      },

      keyframes: {
        // The agent's "working" indicator: three dots breathing in sequence.
        // Small travel, symmetric curve — calm next to text being read.
        'agent-wave': {
          '0%, 60%, 100%': { transform: 'translateY(0)', opacity: '0.35' },
          '30%': { transform: 'translateY(-3px)', opacity: '1' },
        },
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'agent-wave': 'agent-wave 1.25s ease-in-out infinite',
        'fade-up': 'fade-up var(--dur-comp) var(--ease-out) both',
      },

      spacing: {
        // Fixed shell dimensions, so no page re-decides them.
        nav: '248px',
        'nav-collapsed': '60px',
        assist: '420px',
        'assist-collapsed': '32px',
        rail: '320px',
        facets: '216px',
        page: '820px',
      },

      height: {
        header: '56px',
        crumbs: '36px',
        row: '36px',
      },
    },
  },
  plugins: [animate],
}

export default config
