"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { Loader2, AlertCircle, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function GoogleCallbackPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const code = searchParams.get('code');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!code) {
      setError("No authorization code found in URL.");
      return;
    }

    const exchangeToken = async () => {
      try {
        const redirectUri = window.location.origin + '/integrations/google/callback';
        await api('/api/integrations/google/calendar/token', {
          method: 'POST',
          body: JSON.stringify({ code, redirect_uri: redirectUri })
        });
        setSuccess(true);
        setTimeout(() => {
          router.push('/integrations');
        }, 2000);
      } catch (err: any) {
        setError(err.message || "Failed to authenticate with Google.");
      }
    };

    exchangeToken();
  }, [code, router]);

  return (
    <div className="flex-1 flex flex-col items-center justify-center bg-muted/30">
      <div className="max-w-md w-full bg-card border rounded-2xl shadow-sm p-8 text-center space-y-6">
        {error ? (
          <>
            <div className="mx-auto w-16 h-16 bg-destructive/10 text-destructive rounded-full flex items-center justify-center">
              <AlertCircle className="w-8 h-8" />
            </div>
            <div className="space-y-2">
              <h2 className="text-2xl font-bold tracking-tight">Authentication Failed</h2>
              <p className="text-muted-foreground">{error}</p>
            </div>
            <Button onClick={() => router.push('/integrations')} variant="outline" className="w-full">
              Return to Integrations
            </Button>
          </>
        ) : success ? (
          <>
            <div className="mx-auto w-16 h-16 bg-green-500/10 text-green-500 rounded-full flex items-center justify-center">
              <CheckCircle2 className="w-8 h-8" />
            </div>
            <div className="space-y-2">
              <h2 className="text-2xl font-bold tracking-tight">Connected!</h2>
              <p className="text-muted-foreground">Successfully linked Google Calendar. Redirecting...</p>
            </div>
          </>
        ) : (
          <>
            <div className="mx-auto w-16 h-16 bg-blue-500/10 text-blue-500 rounded-full flex items-center justify-center">
              <Loader2 className="w-8 h-8 animate-spin" />
            </div>
            <div className="space-y-2">
              <h2 className="text-2xl font-bold tracking-tight">Completing Setup</h2>
              <p className="text-muted-foreground animate-pulse">Exchanging tokens with Google...</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
