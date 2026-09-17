'use client';

import { BrandMark } from '@/components/brand';
import { useState, type FormEvent } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { Lock, User, Eye, EyeOff, Loader2, AlertCircle } from 'lucide-react';

export function LoginScreen() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    const result = await login(username, password);
    if (!result.success) {
      setError(result.error || 'Login failed');
    }
    setLoading(false);
  }

  return (
    <div className="signature-login"><aside className="login-brand-panel"><div className="login-wordmark"><BrandMark/>youbot<span>.</span></div><div><p className="signature-eyebrow">Your concierge workspace</p><h2>Be there.<br/>Even when<br/><em>you’re not.</em></h2><p>A thoughtful welcome for the people reaching out. A clear workspace for you.</p></div><span className="login-colophon">Made for human connections.</span></aside>
      <div className="login-form-panel relative w-full max-w-md">
        {/* Logo / Branding */}
        <div className="mb-8">
          <div className="mb-6 inline-flex items-center justify-center text-primary lg:hidden">
            <BrandMark className="size-12"/>
          </div>
          <h1 className="login-heading">
            Sign in to Youbot
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Your concierge workspace.
          </p>
        </div>

        {/* Login Card */}
        <div className="login-fields">
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Error Banner */}
            {error && (
              <div role="alert" className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* Username */}
            <div className="space-y-1.5">
              <label htmlFor="login-username" className="text-sm font-medium text-foreground">
                Username
              </label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  id="login-username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Enter username"
                  autoComplete="username"
                  autoFocus
                  required
                  className="w-full h-10 pl-10 pr-3 rounded-lg border border-input bg-background text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all"
                />
              </div>
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <label htmlFor="login-password" className="text-sm font-medium text-foreground">
                Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter password"
                  autoComplete="current-password"
                  required
                  className="w-full h-10 pl-10 pr-10 rounded-lg border border-input bg-background text-foreground text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={loading || !username || !password}
              className="w-full h-10 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Signing in…
                </>
              ) : (
                'Sign in'
              )}
            </button>
          </form>
          <p className="mt-5 text-xs leading-relaxed text-muted-foreground">Use the username and password chosen when Youbot was installed. For a cloud installation, these are the login details entered during deployment.</p>
        </div>
      </div>
    </div>
  );
}
