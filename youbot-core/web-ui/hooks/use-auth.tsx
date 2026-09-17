'use client';

import { useState, useEffect, useCallback, createContext, useContext } from 'react';

interface AuthState {
  authenticated: boolean;
  authRequired: boolean;
  authMode: 'local' | 'sso';
  authUrl?: string;
  loading: boolean;
}

interface AuthContextType extends AuthState {
  login: (username: string, password: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    authenticated: false,
    authRequired: true,
    authMode: 'local',
    loading: true,
  });

  const checkAuth = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/status');
      const data = await res.json();
      setState({
        authenticated: data.authenticated,
        authRequired: data.authRequired,
        authMode: data.authMode === 'sso' ? 'sso' : 'local',
        authUrl: typeof data.authUrl === 'string' ? data.authUrl : undefined,
        loading: false,
      });
    } catch {
      setState(s => ({ ...s, loading: false }));
    }
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (data.success) {
        setState(s => ({ ...s, authenticated: true }));
        return { success: true };
      }
      return { success: false, error: data.error || 'Login failed' };
    } catch {
      return { success: false, error: 'Network error' };
    }
  }, []);

  const logout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    setState(s => ({ ...s, authenticated: false }));
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  return (
    <AuthContext.Provider value={{ ...state, login, logout, checkAuth }}>
      {children}
    </AuthContext.Provider>
  );
}
