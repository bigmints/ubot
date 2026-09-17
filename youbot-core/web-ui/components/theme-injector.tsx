"use client";

/**
 * ThemeInjector
 *
 * Fetches the active custom app theme from /api/app/theme at startup
 * and applies it:
 *   - Loads cssUrl as a <link> stylesheet (full CSS theme with :root + .dark)
 *   - Falls back to inline cssVars / colors if no CSS file
 *   - Updates document title and favicon
 *
 * Noop for vanilla YOUBOT when no theme is configured.
 */

import { useEffect } from "react";
import type { AppTheme } from "@/../src/lib/custom-app.js";

export function ThemeInjector() {
  useEffect(() => {
    async function injectTheme() {
      try {
        const res = await fetch("/api/app/theme");
        if (!res.ok) return;
        const { theme } = (await res.json()) as {
          theme:
            | (AppTheme & { cssUrl?: string; cssVars?: Record<string, string> })
            | null;
        };
        if (!theme) return;

        // If a full CSS theme file is available, inject it as a <link> stylesheet.
        // This is the preferred approach — the CSS file contains proper :root and .dark
        // selectors so light/dark mode works correctly.
        if (theme.cssUrl) {
          const existingLink = document.querySelector<HTMLLinkElement>(
            "link[data-theme-css]",
          );
          if (existingLink) {
            existingLink.href = theme.cssUrl;
          } else {
            const link = document.createElement("link");
            link.rel = "stylesheet";
            link.href = theme.cssUrl;
            link.setAttribute("data-theme-css", "true");
            document.head.appendChild(link);
          }
        } else {
          // Fallback: apply individual CSS vars (legacy approach)
          const root = document.documentElement;

          if (theme.cssVars) {
            for (const [key, value] of Object.entries(theme.cssVars)) {
              root.style.setProperty(key, value);
            }
          }
        }

        // Update document title
        if (theme.appName) {
          document.title = theme.appName;
        }

        // Update favicon if provided
        if (theme.faviconUrl) {
          const favicon =
            document.querySelector<HTMLLinkElement>('link[rel="icon"]');
          if (favicon) {
            favicon.href = theme.faviconUrl;
          } else {
            const link = document.createElement("link");
            link.rel = "icon";
            link.href = theme.faviconUrl;
            document.head.appendChild(link);
          }
        }

        console.log(
          `[Theme] Applied theme: ${theme.appName}${theme.cssUrl ? " (CSS)" : ""}`,
        );
      } catch {
        // Silently ignore — vanilla YOUBOT without theme config is fine
      }
    }

    injectTheme();
  }, []);

  return null;
}
