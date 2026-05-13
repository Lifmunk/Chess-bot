/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'chess-black': '#050505',
        'chess-dark': '#111111',
        'chess-gray': '#1a1a1a',
        'chess-green': '#00ff41',
        'chess-red': '#ff3e3e',
      }
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
  ],
}
