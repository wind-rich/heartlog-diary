/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // 「信笺」体系：纸、墨、朱砂。旧色名保留，整站内联类随之换色。
        cream: {
          50: '#FBF8F1',
          100: '#F3EEE4',
          200: '#E6DED0',
          300: '#D6CBB9',
        },
        rose: {
          soft: '#E08C74',
          deep: '#C23B26',
        },
        ink: {
          900: '#1E1B18',
          700: '#3E3832',
          500: '#766D63',
          300: '#A89E91',
        },
        seal: { DEFAULT: '#C23B26', ink: '#9E2E1C', wash: '#F4DFD6' },
        sage: { DEFAULT: '#5E6E4E', wash: '#E3E7D8' },
        butter: { DEFAULT: '#E3B94C', wash: '#F5EACB' },
      },
      fontFamily: {
        serif: ['"Songti SC"', '"STSong"', '"Noto Serif SC"', '"Source Han Serif SC"', '"Noto Serif CJK SC"', 'SimSun', 'serif'],
        mono: ['"SF Mono"', '"JetBrains Mono"', 'Menlo', 'Consolas', 'monospace'],
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
        card: '0 1px 0 rgba(30, 27, 24, 0.04), 0 8px 24px -14px rgba(30, 27, 24, 0.18)',
        pop: '0 24px 60px -20px rgba(30, 27, 24, 0.35)',
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
