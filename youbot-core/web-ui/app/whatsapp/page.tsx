"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/ui/empty-state";
import {
  MessageCircle,
  Wifi,
  WifiOff,
  QrCode,
  RefreshCw,
  Power,
  PowerOff,
  Smartphone,
  Phone,
  User,
  BotMessageSquare,
} from "lucide-react";
import { api } from "@/lib/api";
import QRCode from "qrcode";
import { toast } from "sonner";
import { StandardPage } from "@/components/workspace-frame";

interface WhatsAppUser {
  id: string;
  name: string | undefined;
  phone: string;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Request failed";
}

export default function WhatsAppPage() {
  const [status, setStatus] = useState("disconnected");
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [qrRequested, setQrRequested] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [user, setUser] = useState<WhatsAppUser | null>(null);
  const [autoReply, setAutoReply] = useState(false);
  const [togglingAutoReply, setTogglingAutoReply] = useState(false);
  const [messages, setMessages] = useState<
    Array<{ from: string; body: string; timestamp: string; isFromMe: boolean }>
  >([]);

  // Generate QR image locally whenever qrCode data changes
  useEffect(() => {
    if (!qrCode) {
      setQrImage(null);
      return;
    }
    QRCode.toDataURL(qrCode, { width: 256, margin: 2 })
      .then((url: string) => setQrImage(url))
      .catch(() => setQrImage(null));
  }, [qrCode]);

  const fetchStatus = useCallback(async (includeQr = qrRequested) => {
    try {
      const data = await api<{
        status: string;
        qr: string | null;
        error: string | null;
        user: WhatsAppUser | null;
        autoReply: boolean;
      }>("/api/whatsapp/status");
      setStatus(data.status);
      if (data.status === "connected") {
        setQrRequested(false);
        setQrCode(null);
      } else if (includeQr) {
        setQrCode(data.qr);
      }
      setError(data.error);
      setUser(data.user);
      setAutoReply(data.autoReply);
    } catch {}
  }, [qrRequested]);

  const fetchMessages = useCallback(async () => {
    try {
      const data = await api<{
        messages: Array<{
          from: string;
          body: string;
          timestamp: string;
          isFromMe: boolean;
        }>;
      }>("/api/whatsapp/messages");
      setMessages(data.messages || []);
    } catch {}
  }, []);

  useEffect(() => {
    fetchStatus();
    fetchMessages();
    const interval = setInterval(() => {
      fetchStatus();
      fetchMessages();
    }, 3000);
    return () => clearInterval(interval);
  }, [fetchStatus, fetchMessages]);

  const handleConnect = async () => {
    setConnecting(true);
    setError(null);
    setQrRequested(true);
    setQrCode(null);
    try {
      await api("/api/whatsapp/connect", { method: "POST" });
      await fetchStatus(true);
    } catch (err: unknown) {
      setQrRequested(false);
      const message = getErrorMessage(err);
      setError(message);
      toast.error(message);
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      await api("/api/whatsapp/disconnect", { method: "POST" });
      toast.success("WhatsApp disconnected");
      setQrRequested(false);
      setQrCode(null);
      setUser(null);
      await fetchStatus();
    } catch (err: unknown) {
      const message = getErrorMessage(err);
      setError(message);
      toast.error(message);
    }
  };

  const handleToggleAutoReply = async (enabled: boolean) => {
    setTogglingAutoReply(true);
    try {
      await api("/api/whatsapp/auto-reply", {
        method: "PUT",
        body: { enabled },
      });
      setAutoReply(enabled);
      toast.success(`Auto-reply ${enabled ? "enabled" : "disabled"}`);
    } catch {
      toast.error("Failed to toggle auto-reply");
    } finally {
      setTogglingAutoReply(false);
    }
  };

  const isConnected = status === "connected";
  const isConnecting = status === "connecting" || connecting;

  const statusColor = isConnected
    ? "bg-emerald-500"
    : isConnecting
      ? "bg-amber-500"
      : "bg-muted-foreground";

  return (
    <StandardPage title="WhatsApp" description="Connect your WhatsApp account to receive and send messages.">

      {/* Connection Status */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              {isConnected ? (
                <Wifi className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              ) : (
                <WifiOff className="h-5 w-5 text-muted-foreground" />
              )}
              Connection Status
            </span>
            <Badge variant="outline" className="gap-1.5">
              <span className={`h-2 w-2 rounded-full ${statusColor}`} />
              {status}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {isConnected && (
            <div className="flex items-center gap-4 p-4 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
              <Smartphone className="h-10 w-10 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-emerald-700 dark:text-emerald-300">
                  WhatsApp Connected
                </p>
                {user ? (
                  <div className="mt-1.5 space-y-1">
                    <div className="flex items-center gap-2 text-sm">
                      <Phone className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="font-mono">{user.phone}</span>
                    </div>
                    {user.name && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <User className="h-3.5 w-3.5" />
                        <span>{user.name}</span>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Linked via QR pairing
                  </p>
                )}
              </div>
            </div>
          )}

          {error && (
            <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm">
              {error}
            </div>
          )}

          {/* QR Code — shown only after an explicit request */}
          {!isConnected && qrRequested && qrImage && (
            <div className="flex flex-col items-center gap-3 p-4 rounded-lg bg-muted/30 border border-border">
              <div className="flex items-center gap-2 text-sm font-medium">
                <QrCode className="h-4 w-4" />
                Scan this QR code with WhatsApp
              </div>
              <div className="bg-white p-4 rounded-lg">
                <img
                  src={qrImage}
                  alt="WhatsApp QR"
                  className="w-52 h-52"
                />
              </div>
              <p className="text-xs text-muted-foreground text-center">
                Open WhatsApp on your phone → Settings → Linked Devices → Link a Device
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={handleConnect}
                disabled={isConnecting}
                className="gap-2"
              >
                <RefreshCw className={`h-4 w-4 ${isConnecting ? "animate-spin" : ""}`} />
                Refresh QR
              </Button>
            </div>
          )}

          {!isConnected && (!qrRequested || !qrImage) && (
            <EmptyState
              icon={<MessageCircle className="size-8" />}
              title="Not connected"
              description="Generate a fresh QR code when you are ready to scan."
              action={
                <Button
                  onClick={handleConnect}
                  disabled={isConnecting}
                  className="gap-2"
                >
                  {isConnecting ? (
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  ) : (
                    <Power className="h-4 w-4" />
                  )}
                  {isConnecting ? "Generating..." : qrRequested ? "Refresh QR" : "Generate QR"}
                </Button>
              }
            />
          )}

          {isConnected && (
            <Button
              variant="destructive"
              onClick={handleDisconnect}
              className="gap-2"
            >
              <PowerOff className="h-4 w-4" />
              Disconnect
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Auto-Reply */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <BotMessageSquare className="h-5 w-5" />
            Auto-Reply
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="wa-auto-reply">WhatsApp Auto-Reply</Label>
              <p className="text-xs text-muted-foreground">
                Automatically respond to incoming WhatsApp messages using skills
              </p>
            </div>
            <Switch
              id="wa-auto-reply"
              checked={autoReply}
              disabled={togglingAutoReply}
              onCheckedChange={handleToggleAutoReply}
            />
          </div>
        </CardContent>
      </Card>

      {/* Recent Messages */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            Recent Messages
            <Button variant="ghost" size="sm" onClick={fetchMessages}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {messages.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No messages yet. Send a message to your WhatsApp number.
            </p>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {messages.slice(-10).map((msg, i) => (
                <div
                  key={i}
                  className={`flex flex-col gap-0.5 p-3 rounded-lg text-sm ${
                    msg.isFromMe
                      ? "bg-blue-500/10 border border-blue-500/20 ml-8"
                      : "bg-muted/50 border border-border mr-8"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-xs">
                      {msg.isFromMe ? "Bot" : msg.from}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {new Date(msg.timestamp).toLocaleTimeString()}
                    </span>
                  </div>
                  <p className="text-foreground">{msg.body}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </StandardPage>
  );
}
