/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'brand': {
          50: '#f5f7fa',
          100: '#e4e7eb',
          200: '#cbd2d9',
          300: '#9aa5b1',
          400: '#7b8794',
          500: '#616e7c',
          600: '#52606d',
          700: '#3e4c59',
          800: '#323f4b',
          900: '#1f2933',
        },
        'accent': {
          DEFAULT: '#6366f1', // Indigo
          hover: '#4f46e5',
        },
        'danger': '#ef4444',
        'success': '#10b981',
      }
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
  ],
}
