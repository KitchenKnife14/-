/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        slate: {
          50: '#f5f6f1', 100: '#eef1ea', 200: '#e4e9e0', 300: '#d2dbcf',
          400: '#9aa497', 500: '#7b857b', 600: '#626e62', 700: '#465348',
          800: '#374438', 900: '#2f3b32', 950: '#202a23',
        },
        canvas: '#f5f6f1',
        surface: '#ffffff',
        ink: '#2f3b32',
        muted: '#7b857b',
        line: '#e4e9e0',
        primary: {
          50: '#f1f5ef', 100: '#e4ece1', 200: '#cbd9c6', 300: '#a9bea2',
          400: '#879f7e', 500: '#6d8664', 600: '#5d7656', 700: '#4d6448',
          800: '#3e513b', 900: '#344431',
        },
        accent: {
          50: '#eff5f0', 100: '#dce9de', 500: '#77977b', 600: '#5e7e63', 700: '#49674e',
        },
        warn: { 50: '#fbf7eb', 100: '#f4ebcf', 500: '#c69a48', 600: '#a77c32' },
        danger: { 50: '#fbefec', 100: '#f4dcd6', 500: '#c87969', 600: '#ae5d4e', 700: '#91483d' },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        soft: '0 8px 28px rgba(47, 59, 48, 0.06)',
      },
    },
  },
  plugins: [],
}
