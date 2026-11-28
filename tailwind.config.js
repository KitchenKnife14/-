/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        slate: {
          50: '#f5f6f1', 100: '#eef1ea', 200: '#e4e9e0', 300: '#d2dbcf',
          400: '#626e62', 500: '#596559', 600: '#626e62', 700: '#465348',
          800: '#374438', 900: '#2f3b32', 950: '#202a23',
        },
        canvas: '#f5f6f1',
        surface: '#ffffff',
        ink: '#2f3b32',
        muted: '#596559',
        line: '#e4e9e0',
        primary: {
          50: '#f1f5ef', 100: '#e4ece1', 200: '#cbd9c6', 300: '#a9bea2',
          400: '#879f7e', 500: '#6d8664', 600: '#5d7656', 700: '#4d6448',
          800: '#3e513b', 900: '#344431',
        },
        accent: {
          50: '#eff5f0', 100: '#dce9de', 500: '#77977b', 600: '#4f6d54', 700: '#49674e',
        },
        warn: { 50: '#fbf7eb', 100: '#f4ebcf', 500: '#c69a48', 600: '#795614' },
        danger: { 50: '#fbefec', 100: '#f4dcd6', 500: '#c87969', 600: '#974b3f', 700: '#91483d' },
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
