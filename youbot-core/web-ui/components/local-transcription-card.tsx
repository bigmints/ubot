"use client";

import { useCallback, useEffect, useState, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Cpu,
  CheckCircle2,
  XCircle,
  HardDrive,
  AudioLines,
  RefreshCw,
  Download,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { toast } from "sonner";

interface TranscriptionStatus {
  available: boolean;
  model: {
    name: string;
    path: string;
    size: number;
    sizeFormatted: string | null;
  };
  ffmpeg: boolean;
  backend: string;
}

interface DownloadProgress {
  downloading: boolean;
  modelName?: string;
  done?: boolean;
  error?: string | null;
  downloadedBytes?: number;
  downloadedFormatted?: string;
  elapsedSeconds?: number;
}

export function LocalTranscriptionCard() {
  const [status, setStatus] = useState<TranscriptionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<TranscriptionStatus>("/api/transcription/status");
      setStatus(data);
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [loadStatus]);

  const startDownload = async () => {
    try {
      setDownloading(true);
      await api("/api/transcription/download", { method: "POST", body: {} });
      toast.info("Model download started (~3 GB). This may take a few minutes...");

      // Poll for progress
      pollRef.current = setInterval(async () => {
        try {
          const prog = await api<DownloadProgress>("/api/transcription/download/progress");
          setProgress(prog);

          if (prog.done || !prog.downloading) {
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;
            setDownloading(false);

            if (prog.error) {
              toast.error(`Download failed: ${prog.error}`);
            } else {
              toast.success("Model downloaded! Local transcription is now active.");
              loadStatus();
            }
            setProgress(null);
          }
        } catch {
          // Ignore polling errors
        }
      }, 2000);
    } catch (err: any) {
      toast.error(`Failed to start download: ${err.message}`);
      setDownloading(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="py-6">
          <div className="flex items-center justify-center text-muted-foreground gap-2">
            <RefreshCw className="size-4 animate-spin" />
            <span className="text-sm">Checking local model...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={status?.available ? "border-primary/30 bg-primary/[0.02]" : ""}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <div className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${
              status?.available
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground"
            }`}>
              <Cpu className="size-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                Local Whisper Model
                {status?.available ? (
                  <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-500 border-emerald-500/25 text-xs">
                    <CheckCircle2 className="size-3 mr-1" /> Active
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="text-xs">
                    Not Installed
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground font-normal mt-0.5">
                On-device speech-to-text • No cloud API needed
              </p>
            </div>
          </CardTitle>
          <Button variant="ghost" size="icon" className="size-8" onClick={loadStatus}>
            <RefreshCw className="size-3.5" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {status?.available ? (
          <>
            <div className="grid gap-2.5 text-sm">
              <div className="flex items-center justify-between py-1.5 px-3 rounded-md bg-muted/50">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <AudioLines className="size-3.5" />
                  <span>Model</span>
                </div>
                <span className="font-mono text-xs">
                  {status.model.name}{" "}
                  {status.model.sizeFormatted && (
                    <span className="text-muted-foreground">({status.model.sizeFormatted})</span>
                  )}
                </span>
              </div>

              <div className="flex items-center justify-between py-1.5 px-3 rounded-md bg-muted/50">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Cpu className="size-3.5" />
                  <span>Backend</span>
                </div>
                <span className="font-mono text-xs">{status.backend}</span>
              </div>

              <div className="flex items-center justify-between py-1.5 px-3 rounded-md bg-muted/50">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <HardDrive className="size-3.5" />
                  <span>FFmpeg</span>
                </div>
                {status.ffmpeg ? (
                  <Badge variant="outline" className="text-xs text-emerald-700 dark:text-emerald-500 border-emerald-500/30">
                    <CheckCircle2 className="size-3 mr-1" /> Available
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-xs text-amber-700 dark:text-amber-500 border-amber-500/30">
                    <XCircle className="size-3 mr-1" /> Missing
                  </Badge>
                )}
              </div>
            </div>

            <p className="text-xs text-muted-foreground mt-3">
              Voice messages from WhatsApp and Telegram are automatically transcribed using this model.
            </p>
          </>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Download the Whisper large-v3 model (~3 GB) to enable on-device voice transcription. 
              Voice messages will be transcribed locally with no cloud API required.
            </p>

            {downloading && progress ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm">
                  <Loader2 className="size-4 animate-spin text-primary" />
                  <span>
                    Downloading {progress.modelName}...{" "}
                    <span className="text-muted-foreground">
                      {progress.downloadedFormatted} downloaded ({progress.elapsedSeconds}s)
                    </span>
                  </span>
                </div>
                <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full transition-all duration-500"
                    style={{
                      width: `${Math.min(100, ((progress.downloadedBytes || 0) / (3094 * 1024 * 1024)) * 100)}%`,
                    }}
                  />
                </div>
              </div>
            ) : (
              <Button onClick={startDownload} disabled={downloading} size="sm">
                <Download className="size-4 mr-2" />
                Download Model (~3 GB)
              </Button>
            )}

            <p className="text-xs text-muted-foreground">
              Alternatively, you can use cloud transcription providers below (OpenAI Whisper, Deepgram, etc.)
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
