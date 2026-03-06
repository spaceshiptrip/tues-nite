/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Bebas Neue"', 'sans-serif'],
        ui: ['"Barlow Condensed"', 'sans-serif'],
        body: ['"Barlow"', 'sans-serif'],
        mono: ['"Share Tech Mono"', 'monospace'],
      },
      colors: {
        alley: {
          900: '#0a0a0d',
          800: '#0f0f12',
          700: '#1a1a20',
          600: '#22222c',
          500: '#2e2e3a',
        },
        pin: {
          400: '#fbbf24',
          500: '#f59e0b',
          600: '#d97706',
        },
        strike: '#ef4444',
        spare: '#3b82f6',
      },
      animation: {
        'fade-in': 'fadeIn 0.4s ease-out',
        'slide-up': 'slideUp 0.3s ease-out',
      },
      keyframes: {
        fadeIn: { from: { opacity: 0 }, to: { opacity: 1 } },
        slideUp: { from: { opacity: 0, transform: 'translateY(12px)' }, to: { opacity: 1, transform: 'translateY(0)' } },
      },
    },
  },
  plugins: [],
}
