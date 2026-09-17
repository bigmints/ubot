'use client';

import React, { createContext, useContext, useEffect, useRef } from 'react';

export type Theme = 'light' | 'dark' | 'system';

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  resolvedTheme: 'light' | 'dark';
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'system',
  setTheme: () => {},
  resolvedTheme: 'dark',
});

const STORAGE_KEY = 'youbot-theme';

function getSystemTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function resolveTheme(t: Theme): 'light' | 'dark' {
  return t === 'system' ? getSystemTheme() : t;
}

function applyTheme(resolved: 'light' | 'dark') {
  const root = document.documentElement;
  root.classList.remove('light', 'dark');
  root.classList.add(resolved);
}

function readStoredTheme(): Theme {
  if (typeof window === 'undefined') return 'dark';
  return (localStorage.getItem(STORAGE_KEY) as Theme) || 'system';
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Use refs so we can avoid React re-renders for the internal logic;
  // subscribers are notified via a custom event.
  const themeRef = useRef<Theme>('system');
  const listenerRef = useRef<(() => void)[]>([]);

  // Force update helper that notifies subscribed consumers
  const [, forceUpdate] = React.useReducer((x: number) => x + 1, 0);

  // Initialise once — read localStorage and apply class
  useEffect(() => {
    const stored = readStoredTheme();
    themeRef.current = stored;
    applyTheme(resolveTheme(stored));
    forceUpdate();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Listen for OS preference changes when mode is 'system'
  useEffect(() => {
    if (themeRef.current !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      applyTheme(getSystemTheme());
      forceUpdate();
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [themeRef.current]);

  const setTheme = (next: Theme) => {
    localStorage.setItem(STORAGE_KEY, next);
    themeRef.current = next;
    applyTheme(resolveTheme(next));
    forceUpdate();
  };

  const value: ThemeContextValue = {
    theme: themeRef.current,
    setTheme,
    resolvedTheme: resolveTheme(themeRef.current),
  };

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
