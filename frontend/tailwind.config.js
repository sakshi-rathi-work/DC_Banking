/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        node1: {
          light: '#e0f2fe',
          DEFAULT: '#0284c7',
          dark: '#0369a1',
        },
        node2: {
          light: '#ede9fe',
          DEFAULT: '#7c3aed',
          dark: '#6d28d9',
        },
        node3: {
          light: '#fef3c7',
          DEFAULT: '#d97706',
          dark: '#b45309',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
