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
        coral: { DEFAULT: '#ff8a5b', soft: '#ff8a5b2b' },
      },
      fontFamily: {
        sans: ['system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        display: ['Fredoka', '"SF Pro Rounded"', '"Arial Rounded MT Bold"', '"Varela Round"', 'Nunito', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        glass: '0 10px 40px -8px rgb(2 6 16 / .55), inset 0 1px 0 0 rgb(255 255 255 / .22)',
        candy: '0 6px 18px -4px rgb(255 95 183 / .55), inset 0 1px 0 0 rgb(255 255 255 / .45)',
        pop: '0 4px 0 0 rgb(0 0 0 / .28)',
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
      addComponents({
        // Frosted-glass surfaces
        '.glass': {
          background: 'linear-gradient(135deg, rgb(255 255 255 / .13), rgb(255 255 255 / .05))',
          border: '1px solid rgb(255 255 255 / .18)',
          'backdrop-filter': 'blur(22px) saturate(1.5)',
          '-webkit-backdrop-filter': 'blur(22px) saturate(1.5)',
          'box-shadow': '0 10px 40px -8px rgb(2 6 16 / .55), inset 0 1px 0 0 rgb(255 255 255 / .22)',
        },
        '.glass-deep': {
          background: 'linear-gradient(160deg, rgb(23 37 68 / .8), rgb(10 18 34 / .86))',
          border: '1px solid rgb(255 255 255 / .16)',
          'backdrop-filter': 'blur(26px) saturate(1.6)',
          '-webkit-backdrop-filter': 'blur(26px) saturate(1.6)',
          'box-shadow': '0 18px 50px -10px rgb(2 6 16 / .7), inset 0 1px 0 0 rgb(255 255 255 / .2)',
        },
        '.glass-chip': {
          background: 'rgb(255 255 255 / .09)',
          border: '1px solid rgb(255 255 255 / .14)',
          'backdrop-filter': 'blur(12px)',
          '-webkit-backdrop-filter': 'blur(12px)',
        },
        // Popup / settings backdrop
        '.aurora': {
          'background-color': '#0a1222',
          'background-image':
            'radial-gradient(60% 50% at 8% 0%, rgb(255 95 183 / .38), transparent 70%), radial-gradient(55% 45% at 100% 12%, rgb(92 200 255 / .30), transparent 70%), radial-gradient(60% 50% at 70% 100%, rgb(255 138 91 / .30), transparent 70%)',
        },
        '.focus-candy': {
          outline: 'none',
          '&:focus-visible': { 'box-shadow': '0 0 0 2px #0a1222, 0 0 0 4px #ffe45e' },
        },
        '.text-candy': {
          background: 'linear-gradient(90deg,#ff5fb7,#ffe45e,#4df0c0,#5cc8ff,#ff5fb7)',
          'background-size': '200% 100%',
          '-webkit-background-clip': 'text',
          'background-clip': 'text',
          color: 'transparent',
        },
      });
    }),
  ],
};
