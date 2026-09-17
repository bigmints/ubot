/**
 * YOUBOT Frontend Extension Points
 *
 * This file is the customization point for forks. Upstream provides no-op defaults.
 * Forks override this single file to register sidebar items, breadcrumbs, etc.
 *
 * NOTE: App branding (title, logo, colors) is driven by config.json's `theme`
 * section and applied at runtime by ThemeInjector.
 */

import React from 'react';

// ── Extensions Loader ─────────────────────────────────────
// Rendered in layout.tsx. Upstream: no-op. Forks: trigger side-effect registrations.

export function ExtensionsLoader() {
  return null;
}

// ── Home Page Override ────────────────────────────────────
// If a fork provides a custom home page component, return it here.
// Returning null means "use the default YOUBOT dashboard".

export function useHomePageOverride(): React.ComponentType | null {
  return null;
}
