import type { Config } from 'tailwindcss'

/**
 * Design tokens for the panel.
 *
 * The refresh keeps every PRE-EXISTING token NAME (`bg`/`bg-card`/`bg-card2`,
 * `line`, `ink`/`ink-dim`, `accent`, `ok`/`warn`/`err`) so all existing pages
 * adopt the new palette with zero per-page edits — we only changed the VALUES.
 * On top of that we add the surfaces + accents the new Discord-style shell
 * needs (rail/sidebar/raised/hover elevations, an accent ramp, per-section
 * accents, semantic `info`, depth shadows, and entrance animations).
 *
 * Palette: a blue-violet-tinted near-black with an iris/violet brand and a
 * cyan secondary — distinct from Discord's blurple while keeping the layered,
 * elevation-driven feel.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx,mdx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // ─── Surfaces (darkest → lightest elevation) ──────────────────
        bg: {
          DEFAULT: '#141525', // page content background
          app: '#0a0b12', // outermost gutter / rail backdrop
          rail: '#0d0e17', // icon rail
          sidebar: '#11121d', // contextual sidebar
          card: '#1a1b2b', // elevated card
          card2: '#212236', // nested / secondary surface
          raised: '#212236', // tiles, inputs, chips
          hover: 'rgba(255,255,255,0.06)', // hover overlay (works on any surface)
        },
        line: {
          DEFAULT: '#2a2c40',
          bright: '#3a3c56',
        },
        ink: {
          DEFAULT: '#e9e9f2',
          dim: '#a3a4bd',
          faint: '#6f7090',
        },
        // ─── Brand + section accents ──────────────────────────────────
        accent: {
          DEFAULT: '#7c6cf0', // iris / violet
          bright: '#9183f5',
          soft: 'rgba(124,108,240,0.14)',
        },
        aqua: '#22d3ee', // Squishy section
        gold: '#f5b94a', // Otter section
        rose: '#fb7185', // Sudo section
        // ─── Semantic ─────────────────────────────────────────────────
        ok: '#3ecf8e',
        warn: '#f5b800',
        err: '#ef4444',
        info: '#5b9dff',
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 2px rgba(0,0,0,0.28), 0 1px 1px rgba(0,0,0,0.18)',
        pop: '0 10px 30px -8px rgba(0,0,0,0.55), 0 2px 8px rgba(0,0,0,0.35)',
        glow: '0 0 0 1px rgba(124,108,240,0.45), 0 10px 34px -8px rgba(124,108,240,0.4)',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'scale-in': {
          from: { opacity: '0', transform: 'translateY(6px) scale(0.98)' },
          to: { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        'slide-up': {
          from: { opacity: '0', transform: 'translateY(10px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.15s ease-out',
        'scale-in': 'scale-in 0.14s ease-out',
        'slide-up': 'slide-up 0.2s ease-out',
      },
    },
  },
  plugins: [],
}

export default config
