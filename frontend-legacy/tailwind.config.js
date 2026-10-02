/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        orbitron: ['Orbitron', 'monospace'],
        space: ['Space Grotesk', 'Inter', 'system-ui', 'sans-serif'],
      },
      colors: {
        /* Legacy tokens — mapped to cyberpunk palette */
        primary:   '#00f5ff',
        secondary: '#9b00ff',
        success:   '#00ff9f',
        warning:   '#ff8800',
        error:     '#ff003c',
        /* Semantic surface tokens */
        appBg: 'rgb(var(--color-app-bg) / <alpha-value>)',
        card:  'rgb(var(--color-card)   / <alpha-value>)',
        ink:   'rgb(var(--color-ink)    / <alpha-value>)',
        muted: 'rgb(var(--color-muted)  / <alpha-value>)',
        line:  'rgb(var(--color-line)   / <alpha-value>)',
        /* Neon direct references */
        cyan:   '#00f5ff',
        neon:   { purple: '#9b00ff', pink: '#ff007a', green: '#00ff9f', orange: '#ff8800', red: '#ff003c', blue: '#0060ff' },
      },
      boxShadow: {
        soft:    '0 18px 45px rgba(0,245,255,0.06)',
        glow:    '0 0 30px rgba(0,245,255,0.35)',
        'glow-pu': '0 0 30px rgba(155,0,255,0.35)',
        'glow-pk': '0 0 30px rgba(255,0,122,0.35)',
        'neon-sm': '0 0 8px rgba(0,245,255,0.5)',
      },
      animation: {
        'cyber-spin':    'cyber-spin 10s linear infinite',
        'neon-pulse':    'neon-pulse 2s ease-in-out infinite',
        'float-y':       'float-y 4s ease-in-out infinite',
        'holo-sweep':    'holo-sweep 6s ease-in-out infinite',
        'scan-h':        'scan-h 5s ease-in-out infinite',
        'border-dance':  'border-dance 4s ease infinite',
      },
    },
  },
  plugins: [],
};
