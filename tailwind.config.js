/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        sv: {
          bg:           '#080b10',
          card:         '#0f1420',
          elevated:     '#161d2e',
          panel:        '#1a2235',
          border:       '#1e2a3a',
          'border-lt':  '#263347',
          cyan:         '#00d4f5',
          'cyan-dim':   '#00a8c2',
          'cyan-glow':  'rgba(0,212,245,0.12)',
          'cyan-muted': 'rgba(0,212,245,0.06)',
          text:         '#e8f0fe',
          'text-muted': '#8b9ab5',
          'text-dim':   '#4a5a72',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        'glow-cyan': '0 0 24px rgba(0,212,245,0.18)',
        'glow-sm':   '0 0 8px rgba(0,212,245,0.12)',
        'card':      '0 4px 24px rgba(0,0,0,0.4)',
        'panel':     '0 2px 12px rgba(0,0,0,0.5)',
      },
      animation: {
        'fade-in':   'fadeIn 0.2s ease-out',
        'slide-up':  'slideUp 0.25s ease-out',
        'pulse-glow':'pulseGlow 2s ease-in-out infinite',
      },
      keyframes: {
        fadeIn:    { from: { opacity: '0' },                  to: { opacity: '1' } },
        slideUp:   { from: { transform: 'translateY(8px)', opacity: '0' }, to: { transform: 'translateY(0)', opacity: '1' } },
        pulseGlow: { '0%,100%': { boxShadow: '0 0 8px rgba(0,212,245,0.15)' }, '50%': { boxShadow: '0 0 20px rgba(0,212,245,0.35)' } },
      },
    },
  },
  plugins: [],
}
