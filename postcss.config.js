import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';

// Netflix sets its own <html> font-size, which would distort rem-based Tailwind
// inside our shadow DOM. Convert every rem to px (1rem = 16px) at build time.
const remToPx = () => ({
  postcssPlugin: 'rem-to-px',
  Declaration(decl) {
    if (decl.value.includes('rem')) {
      decl.value = decl.value.replace(/(-?\d*\.?\d+)rem/g, (_, n) => `${parseFloat(n) * 16}px`);
    }
  },
});
remToPx.postcss = true;

export default { plugins: [tailwindcss(), autoprefixer(), remToPx()] };
