/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        cream: {
          50: '#FFFCF8',
          100: '#FFF6EE',
          200: '#FBEADC',
          300: '#F3D9C4',
        },
        rose: {
          soft: '#F2A7A0',
          deep: '#D9705F',
        },
        ink: {
          900: '#3B332E',
          700: '#5C5148',
          500: '#8A7D72',
          300: '#B9ADA2',
        },
      },
      fontFamily: {
        sans: [
          '"PingFang SC"',
          '"Hiragino Sans GB"',
          '"Microsoft YaHei"',
          'system-ui',
          '-apple-system',
          'sans-serif',
        ],
      },
      boxShadow: {
        card: '0 2px 12px rgba(150, 120, 100, 0.08)',
        pop: '0 12px 40px rgba(90, 70, 55, 0.18)',
      },
      borderRadius: {
        xl2: '1.25rem',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-up': {
          '0%': { transform: 'translateY(100%)' },
          '100%': { transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.25s ease-out',
        'slide-up': 'slide-up 0.22s ease-out',
      },
    },
  },
  plugins: [],
}
