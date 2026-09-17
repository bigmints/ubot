/**
 * YOUBOT Default Theme
 *
 * The base system theme used when no custom app provides its own.
 * Colors match the shadcn dark mode defaults used in globals.css.
 * Override by setting a `theme` block in config.json or by deploying
 * a custom app with a theme() export.
 */

import type { AppTheme } from '../../../src/lib/custom-app.js';

const defaultTheme: AppTheme = {
  appName: 'YOUBOT',
  logoUrl: undefined,
  faviconUrl: undefined,

  colors: {
    // Base — shadcn dark defaults (oklch expressed as hsl for compat)
    primary:    'hsl(210 40% 98%)',
    background: 'hsl(222 47% 11%)',
    foreground: 'hsl(210 40% 98%)',
    sidebar:    'hsl(222 47% 8%)',
    accent:     'hsl(217 33% 17%)',
    border:     'hsl(217 33% 17%)',
  },

  fonts: {
    heading: 'Geist',
    body:    'Geist',
  },
};

export default defaultTheme;
