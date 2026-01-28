/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{vue,js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'chatty': {
          50: '#fef2f3',
          100: '#fde6e7',
          200: '#fbd0d5',
          300: '#f7aab2',
          400: '#f27a8a',
          500: '#e94560',
          600: '#d5294d',
          700: '#b31d3f',
          800: '#961b3b',
          900: '#801b38',
        }
      }
    },
  },
  plugins: [],
}
