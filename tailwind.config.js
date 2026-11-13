import plugin from 'tailwindcss/plugin';

/**
 * PariParty design tokens. Palette: "grape soda + candy shop".
 * Deep grape surfaces, with bubblegum / lemon / mint / sky as playful accents.
 */
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./popup.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        grape: { 950: '#0a1222', 900: '#0f1a30', 800: '#172544', 700: '#1f3258', 600: '#2b437a' },
        gum: { DEFAULT: '#ff5fb7', soft: '#ff5fb733', deep: '#e03a98' },
        lemon: { DEFAULT: '#ffe45e', soft: '#ffe45e2b' },
        mint: { DEFAULT: '#4df0c0', soft: '#4df0c02b' },
        sky: { DEFAULT: '#5cc8ff', soft: '#5cc8ff2b' },
        tang: { DEFAULT: '#ff9a4d', soft: '#ff9a4d2b' },
        // text on dark surfaces (contrast >= 7:1 on #171d33)
        soft: '#d3d9ee',
        mute: '#a9b3d3',
        coral: { DEFAULT: '#ff8a5b', soft: '#ff8a5b2b' },
      },
      fontFamily: {
        sans: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        display: ['Fredoka', '"SF Pro Rounded"', '"Arial Rounded MT Bold"', '"Varela Round"', 'Nunito', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
      },
      keyframes: {
        wiggle: { '0%,100%': { transform: 'rotate(-4deg)' }, '50%': { transform: 'rotate(4deg)' } },
        bob: { '0%,100%': { transform: 'translateY(0)' }, '50%': { transform: 'translateY(-4px)' } },
        drift: { '0%,100%': { transform: 'translate3d(0,0,0) scale(1)' }, '50%': { transform: 'translate3d(14px,-10px,0) scale(1.08)' } },
        sheen: { '0%': { backgroundPosition: '200% 0' }, '100%': { backgroundPosition: '-200% 0' } },
      },
      animation: {
        wiggle: 'wiggle 1.4s ease-in-out infinite',
        bob: 'bob 2.6s ease-in-out infinite',
        drift: 'drift 9s ease-in-out infinite',
        sheen: 'sheen 6s linear infinite',
      },
    },
  },
  plugins: [
    plugin(({ addComponents }) => {
      // Flat, opaque surfaces. Nothing is translucent or blurred, so text stays readable over any video.
      addComponents({
        '.surface': { background: '#171d33', border: '1px solid #2f3a5e' },
        '.surface-raised': { background: '#222b4a', border: '1px solid #3b4772' },
        '.surface-float': { background: '#121829', border: '1px solid #3b4772', 'box-shadow': '0 10px 30px rgb(0 0 0 / .55)' },
        '.page': { 'background-color': '#0e1322' },
        '.focus-candy': {
          outline: 'none',
          '&:focus-visible': { 'box-shadow': '0 0 0 2px #0e1322, 0 0 0 4px #ffe45e' },
        },
      });
    }),
  ],
};
