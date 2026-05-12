import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./src/**/*.{ts,tsx,mdx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Match the landing-page palette so the dashboard feels continuous.
        bg:   { DEFAULT: '#0b0d12', card: '#131722', card2: '#1a1f2d' },
        line: '#232a3a',
        ink:  { DEFAULT: '#e6e9ef', dim: '#9aa3b3' },
        accent: '#6d8eff',
        ok:   '#3ecf8e',
        warn: '#f5b800',
        err:  '#ef4444',
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
  plugins: [],
}

export default config
