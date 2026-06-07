import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        cream: '#FAF8F4',
        'warm-white': '#FFFDF9',
        ink: '#1C1A18',
        'ink-light': '#4A4845',
        gold: '#C9A96E',
        'gold-light': '#E8D5B0',
        'gold-text': '#8A6A30',
        sage: '#7A9E87',
        'sage-light': '#C8DDD0',
        border: '#E8E2D5',
      },
      fontFamily: {
        // Cormorant for headings, DM Sans for body - matching existing site
        sans: ['"DM Sans"', 'sans-serif'],
        serif: ['var(--font-cormorant)', 'Georgia', 'serif'],
      },
      maxWidth: {
        'site': '1200px',
      },
    },
  },
  plugins: [],
};

export default config;
