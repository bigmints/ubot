"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Cpu,
  CheckCircle2,
  XCircle,
  Volume2,
  RefreshCw,
  Play,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { toast } from "sonner";

interface TtsStatus {
  available: boolean;
  voices: string[];
  error?: string;
}

export function LocalTtsCard() {
  const [status, setStatus] = useState<TtsStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api<TtsStatus>("/api/tts/status");
      setStatus(data);
    } catch {
      setStatus(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const testTts = async () => {
    setTesting(true);
    try {
      const response = await fetch("/api/tts/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "Hello! Text to speech is working." }),
      });

      if (!response.ok) {
        throw new Error(await response.text());
      }

      const audioBlob = await response.blob();
      const audioUrl = URL.createObjectURL(audioBlob);
      const audio = new Audio(audioUrl);
      audio.onended = () => URL.revokeObjectURL(audioUrl);
      audio.onerror = () => URL.revokeObjectURL(audioUrl);
      await audio.play();
      toast.success("TTS is working!");
    } catch (err: any) {
      toast.error(`TTS test failed: ${err.message}`);
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="py-6">
          <div className="flex items-center justify-center text-muted-foreground gap-2">
            <RefreshCw className="size-4 animate-spin" />
            <span className="text-sm">Checking TTS engine...</span>
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
              <Volume2 className="size-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                Local Piper TTS
                {status?.available ? (
                  <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-500 border-emerald-500/25 text-xs">
                    <CheckCircle2 className="size-3 mr-1" /> Active
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="text-xs">
                    Not Available
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground font-normal mt-0.5">
                On-device text-to-speech • No cloud API needed
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
                  <Cpu className="size-3.5" />
                  <span>Engine</span>
                </div>
                <span className="font-mono text-xs">Piper TTS</span>
              </div>

              <div className="flex items-center justify-between py-1.5 px-3 rounded-md bg-muted/50">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Volume2 className="size-3.5" />
                  <span>Voices</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs">
                    {status.voices.length} installed
                  </span>
                </div>
              </div>

              {status.voices.length > 0 && (
                <div className="flex flex-wrap gap-1.5 px-3">
                  {status.voices.map((voice) => (
                    <Badge key={voice} variant="outline" className="text-xs font-mono">
                      {voice}
                    </Badge>
                  ))}
                </div>
              )}

              <div className="flex items-center justify-between py-1.5 px-3 rounded-md bg-muted/50">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Cpu className="size-3.5" />
                  <span>Backend</span>
                </div>
                <span className="font-mono text-xs">
                  {typeof navigator !== "undefined" ? "Local" : "Local"}
                </span>
              </div>
            </div>

            <div className="mt-3 flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={testTts} disabled={testing}>
                {testing ? (
                  <Loader2 className="size-3.5 mr-2 animate-spin" />
                ) : (
                  <Play className="size-3.5 mr-2" />
                )}
                Test Voice
              </Button>
            </div>

            <p className="text-xs text-muted-foreground mt-3">
              Voice responses in chat are generated locally using this engine when voice input is used.
            </p>
          </>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Piper TTS is not installed or no voice models are available.
              To enable local text-to-speech:
            </p>
            <ol className="text-sm text-muted-foreground list-decimal list-inside space-y-1">
              <li>Install Piper: <code className="bg-muted px-1.5 py-0.5 rounded text-xs">pip3 install piper-tts</code></li>
              <li>Download a voice model to <code className="bg-muted px-1.5 py-0.5 rounded text-xs">~/.youbot/data/models/tts/</code></li>
            </ol>
            <p className="text-xs text-muted-foreground">
              Voice models can be found at{" "}
              <a
                href="https://github.com/rhasspy/piper/blob/master/VOICES.md"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
              >
                Piper Voices
              </a>
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
