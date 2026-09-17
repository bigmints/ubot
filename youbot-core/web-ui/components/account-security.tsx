"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  User,
  Lock,
  Eye,
  EyeOff,
  Save,
  RefreshCw,
  LogOut,
  Shield,
  KeyRound,
} from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";

interface UserProfile {
  username: string;
  authMode: "local" | "sso";
}

export function AccountSecurity() {
  const { authRequired, logout } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError,setLoadError]=useState("");

  // Password change state
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api<UserProfile>("/api/auth/profile")
      .then(setProfile)
      .catch(() => setLoadError("Account details could not be loaded. Reload this page to try again."))
      .finally(() => setLoading(false));
  }, []);

  async function handlePasswordChange(e: FormEvent) {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast.error("New passwords do not match");
      return;
    }
    if (newPassword.length < 12) {
      toast.error("Password must be at least 12 characters");
      return;
    }

    setSaving(true);
    try {
      const result = await api<{ success: boolean; error?: string }>(
        "/api/auth/password",
        {
          method: "PUT",
          body: { currentPassword, newPassword },
        }
      );
      if (result.success) {
        toast.success("Password updated successfully");
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
      } else {
        toast.error(result.error || "Failed to update password");
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to update password");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-muted rounded w-48" />
          <div className="h-4 bg-muted rounded w-72 max-w-full" />
          <div className="h-48 bg-muted rounded" />
        </div>
      </div>
    );
  }

  if(loadError)return <p role="alert" className="rounded-lg border p-4 text-sm">{loadError}</p>;
  const isLocal = profile?.authMode === "local";

  return (
    <div className="space-y-6">
      {/* User Info Card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Shield className="size-4" />
            Account information
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            {/* Avatar */}
            <div className="flex items-center justify-center size-16 rounded-full bg-primary/10 border-2 border-primary/20 shrink-0">
              <span className="text-2xl font-bold text-primary uppercase">
                {profile?.username?.charAt(0) || "U"}
              </span>
            </div>
            <div className="min-w-0 space-y-1">
              <p className="break-all text-lg font-semibold">{profile?.username || "—"}</p>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary" className="text-xs">
                  {isLocal ? "Password sign-in" : "Organization sign-in"}
                </Badge>
                {authRequired && (
                  <Badge variant="outline" className="text-xs text-emerald-700 dark:text-emerald-400 border-emerald-500/30">
                    Authenticated
                  </Badge>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Password Change Card — only for local auth */}
      {isLocal && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <KeyRound className="size-4" />
              Change password
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handlePasswordChange} className="space-y-4">
              {/* Current password */}
              <div className="space-y-1.5">
                <Label htmlFor="profile-current-password">Current password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="profile-current-password" autoComplete="current-password"
                    type={showCurrent ? "text" : "password"}
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="Enter current password"
                    className="pl-10 pr-10"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowCurrent(!showCurrent)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    aria-label={showCurrent ? "Hide current password" : "Show current password"}
                  >
                    {showCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* New password */}
              <div className="space-y-1.5">
                <Label htmlFor="profile-new-password">New password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="profile-new-password" autoComplete="new-password"
                    type={showNew ? "text" : "password"}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Enter new password (min 12 characters)"
                    className="pl-10 pr-10"
                    required
                    minLength={12}
                  />
                  <button
                    type="button"
                    onClick={() => setShowNew(!showNew)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    aria-label={showNew ? "Hide new password" : "Show new password"}
                  >
                    {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Confirm Password */}
              <div className="space-y-1.5">
                <Label htmlFor="profile-confirm-password">Confirm new password</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="profile-confirm-password" autoComplete="new-password"
                    type={showNew ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm new password"
                    className="pl-10 pr-10"
                    required
                    minLength={12}
                  />
                </div>
                {confirmPassword && newPassword !== confirmPassword && (
                  <p className="text-xs text-destructive">Passwords do not match</p>
                )}
              </div>

              <Button
                type="submit"
                disabled={saving || !currentPassword || !newPassword || newPassword !== confirmPassword}
              >
                {saving ? (
                  <>
                    <RefreshCw className="size-4 mr-2 animate-spin" />
                    Updating…
                  </>
                ) : (
                  <>
                    <Save className="size-4 mr-2" />
                    Update password
                  </>
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Sign out */}
      {authRequired && (
        <Card className="border-destructive/20">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-sm">Sign out</p>
                <p className="text-xs text-muted-foreground">
                  End your current session
                </p>
              </div>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => logout()}
              >
                <LogOut className="size-4 mr-2" />
                Sign out
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
