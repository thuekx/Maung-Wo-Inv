/** @type {import('tailwindcss').Config} */
// Warna brand/aksen dibaca dari CSS variable (diatur Admin lewat Pengaturan → Tampilan & Brand).
const scale = (name) => Object.fromEntries([50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950].map((n) => [n, `rgb(var(--${name}-${n}) / <alpha-value>)`]));

module.exports = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: { brand: scale('brand'), accent: scale('accent') },
      fontFamily: {
        sans: ['"Inter Variable"', 'Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        display: ['"Playfair Display Variable"', '"Playfair Display"', 'Georgia', 'serif'],
      },
      boxShadow: { card: '0 1px 2px rgb(11 31 59 / 0.06), 0 1px 3px rgb(11 31 59 / 0.04)' },
    },
  },
  plugins: [],
};
