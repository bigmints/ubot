"use client";

import { useState, useEffect } from "react";
import { StandardPage } from "@/components/workspace-frame";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Calendar, Save, Link2, Unlink, HelpCircle, ExternalLink } from "lucide-react";
import { api } from "@/lib/api";
import { toast } from "sonner";

export default function IntegrationsPage() {
  const [googleConfig, setGoogleConfig] = useState({ client_id: '', client_secret: '', configured: false, authenticated: false });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchConfig();
  }, []);

  const fetchConfig = async () => {
    try {
      setLoading(true);
      const data = await api('/api/integrations/google/calendar');
      setGoogleConfig(prev => ({ ...prev, ...(data as any) }));
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    try {
      await api('/api/integrations/google/calendar', {
        method: 'POST',
        body: {
          client_id: googleConfig.client_id,
          client_secret: googleConfig.client_secret,
        }
      });
      toast.success("Google Calendar credentials saved");
      fetchConfig();
    } catch (err: any) {
      toast.error(err.message || "Failed to save credentials");
    }
  };

  const handleConnect = async () => {
    try {
      const redirectUri = window.location.origin + '/integrations/google/callback';
      const data = await api(`/api/integrations/google/calendar/auth-url?redirect_uri=${encodeURIComponent(redirectUri)}`);
      if ((data as any).url) {
        window.location.href = (data as any).url;
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to get auth URL");
    }
  };

  const handleDisconnect = async () => {
    try {
      await api('/api/integrations/google/calendar', { method: 'DELETE' });
      toast.success("Google Calendar disconnected");
      fetchConfig();
    } catch (err: any) {
      toast.error(err.message || "Failed to disconnect");
    }
  };

  return (
    <StandardPage title="Apps & services" description="Connect external services and manage their access to your workspace.">

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card className="flex flex-col border-border/50 shadow-sm overflow-hidden">
            <CardHeader className="bg-card">
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2.5 bg-blue-500/10 rounded-xl text-blue-600 dark:text-blue-400 ring-1 ring-blue-500/20">
                  <Calendar className="w-6 h-6" />
                </div>
                <CardTitle className="text-xl">Google Calendar</CardTitle>
              </div>
              <CardDescription>
                Allow the AI to read, create, and manage your Google Calendar events autonomously.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5 pt-6 flex-1">
              <div className="space-y-2">
                <label className="text-sm font-semibold text-foreground">Client ID</label>
                <Input 
                  value={googleConfig.client_id} 
                  onChange={e => setGoogleConfig(prev => ({...prev, client_id: e.target.value}))} 
                  placeholder="e.g. 1234567890-abc.apps.googleusercontent.com"
                  className="font-mono text-xs"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-semibold text-foreground">Client Secret</label>
                <Input 
                  type="password"
                  value={googleConfig.client_secret} 
                  onChange={e => setGoogleConfig(prev => ({...prev, client_secret: e.target.value}))} 
                  placeholder="••••••••••••••••••••••••"
                  className="font-mono text-xs"
                />
              </div>
              
              <div className="text-xs text-muted-foreground bg-muted/50 p-3 rounded-lg border border-border/50 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <p><strong>Note:</strong> You must configure your Google Cloud Console OAuth consent screen and create OAuth Client IDs.</p>
                <Dialog>
                  <DialogTrigger asChild>
                    <Button variant="outline" size="sm" className="h-7 text-xs shrink-0">
                      <HelpCircle className="w-3.5 h-3.5 mr-1.5" />
                      How to get these?
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-2xl">
                    <DialogHeader>
                      <DialogTitle>Google Calendar API Setup</DialogTitle>
                      <DialogDescription>
                        Follow these steps to generate your Client ID and Client Secret.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 text-sm mt-2 max-h-[60vh] overflow-y-auto pr-2">
                      <div className="space-y-2">
                        <h4 className="font-semibold text-foreground">1. Create a Google Cloud Project</h4>
                        <p className="text-muted-foreground">Go to the <a href="https://console.cloud.google.com/" target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline inline-flex items-center">Google Cloud Console <ExternalLink className="w-3 h-3 ml-1" /></a> and create a new project.</p>
                      </div>
                      
                      <div className="space-y-2">
                        <h4 className="font-semibold text-foreground">2. Enable the Google Calendar API</h4>
                        <p className="text-muted-foreground">Navigate to <strong>APIs & Services {'>'} Library</strong>. Search for "Google Calendar API" and click <strong>Enable</strong>.</p>
                      </div>

                      <div className="space-y-2">
                        <h4 className="font-semibold text-foreground">3. Configure OAuth Consent Screen</h4>
                        <p className="text-muted-foreground">Go to <strong>APIs & Services {'>'} OAuth consent screen</strong>.</p>
                        <ul className="list-disc pl-5 text-muted-foreground space-y-1">
                          <li>Select <strong>External</strong> (or Internal if you have Google Workspace) and click Create.</li>
                          <li>Fill in the required fields (App name, User support email, Developer contact).</li>
                          <li>Click <strong>Save and Continue</strong>.</li>
                          <li>On the Scopes screen, click <strong>Add or Remove Scopes</strong> and add <code className="bg-muted px-1 rounded">https://www.googleapis.com/auth/calendar</code>.</li>
                          <li>Add your Google account email to the <strong>Test users</strong> section and save.</li>
                        </ul>
                      </div>

                      <div className="space-y-2">
                        <h4 className="font-semibold text-foreground">4. Create OAuth Credentials</h4>
                        <p className="text-muted-foreground">Go to <strong>APIs & Services {'>'} Credentials</strong>.</p>
                        <ul className="list-disc pl-5 text-muted-foreground space-y-1">
                          <li>Click <strong>Create Credentials</strong> and select <strong>OAuth client ID</strong>.</li>
                          <li>Choose <strong>Web application</strong> as the Application type.</li>
                          <li>Under <strong>Authorized redirect URIs</strong>, click Add URI and paste the exact URL below:</li>
                        </ul>
                        <div className="bg-muted p-2 rounded-md font-mono text-xs select-all mt-2">
                          {typeof window !== 'undefined' ? window.location.origin : 'https://[your-domain]'}/integrations/google/callback
                        </div>
                      </div>
                      
                      <div className="space-y-2">
                        <h4 className="font-semibold text-foreground">5. Copy your Credentials</h4>
                        <p className="text-muted-foreground">Once created, copy the <strong>Client ID</strong> and <strong>Client Secret</strong> into the form on this page and save.</p>
                      </div>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>
            </CardContent>
            <CardFooter className="flex items-center justify-between border-t bg-muted/10 p-6">
              <Button variant="outline" size="sm" onClick={handleSave} disabled={loading}>
                <Save className="w-4 h-4 mr-2" />
                Save Config
              </Button>
              
              {googleConfig.authenticated ? (
                <Button variant="destructive" size="sm" onClick={handleDisconnect} disabled={loading}>
                  <Unlink className="w-4 h-4 mr-2" />
                  Disconnect
                </Button>
              ) : (
                <Button size="sm" onClick={handleConnect} disabled={!googleConfig.configured || loading} className="bg-blue-600 hover:bg-blue-700 text-white">
                  <Link2 className="w-4 h-4 mr-2" />
                  Connect Account
                </Button>
              )}
            </CardFooter>
          </Card>
        </div>
    </StandardPage>
  );
}
