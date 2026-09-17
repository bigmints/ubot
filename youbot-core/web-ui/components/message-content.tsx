"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import { useState, useCallback } from "react";
import { Copy, Check, ExternalLink, Download, Play, Pause, TrendingUp, TrendingDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";

interface MessageContentProps {
  content: string;
  role: "user" | "assistant";
}

/**
 * Audio Card Component for rendering inline voice notes.
 */
function AudioCard({ text }: { text: string }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [audio, setAudio] = useState<HTMLAudioElement | null>(null);

  const toggleVoice = async () => {
    if (audio) {
      if (isPlaying) {
        audio.pause();
        setIsPlaying(false);
      } else {
        audio.play();
        setIsPlaying(true);
      }
      return;
    }

    try {
      setIsPlaying(true);
      const response = await fetch("/api/tts/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });

      if (!response.ok) throw new Error("Failed to generate audio");
      
      const audioBlob = await response.blob();
      const audioUrl = URL.createObjectURL(audioBlob);
      const newAudio = new Audio(audioUrl);
      
      newAudio.onended = () => {
        setIsPlaying(false);
        URL.revokeObjectURL(audioUrl);
        setAudio(null);
      };
      newAudio.onerror = () => {
        setIsPlaying(false);
        URL.revokeObjectURL(audioUrl);
        setAudio(null);
      };
      
      setAudio(newAudio);
      await newAudio.play();
    } catch (err) {
      console.error(err);
      setIsPlaying(false);
    }
  };

  return (
    <Card className="my-3 inline-block min-w-[280px] max-w-[80%] border-primary/20 bg-primary/5">
      <CardContent className="p-3 flex items-start gap-3">
        <Button 
          variant="default" 
          size="icon" 
          className="shrink-0 rounded-full size-10" 
          onClick={toggleVoice}
        >
          {isPlaying ? <Pause className="size-4" /> : <Play className="size-4 ml-0.5" />}
        </Button>
        <div className="flex-1">
          <div className="text-xs font-semibold text-primary mb-1">
            Voice Note
          </div>
          <div className="text-sm italic leading-snug">"{text}"</div>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Rich markdown renderer for chat messages.
 * Renders: images, code blocks with copy, tables, links,
 * youtube iframes, metrics cards, audio cards, headings, lists, blockquotes
 */
export function MessageContent({ content, role }: MessageContentProps) {
  if (!content) return null;

  // For user messages, keep simple text rendering
  if (role === "user") {
    return (
      <div className="text-sm leading-relaxed whitespace-pre-wrap">
        {content}
      </div>
    );
  }

  // Auto-linkify naked youtube URLs to ensure the embed always triggers, even if the agent forgets Markdown
  const safeContent = content.replace(
    /(?<![="\]'\(])(https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=|youtu\.be\/)[^\s\n<]+)/g,
    (match) => `[YouTube Video](${match})`
  );

  return (
    <div className="text-sm leading-relaxed prose-chat">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw]}
        components={{
          // ── Code blocks / pre ──
          code({ node, inline, className, children, ...props }: any) {
            const match = /language-(\w+)/.exec(className || "");

            // ── Generative UI: Natively intercept audiocard JSON blocks ──
            if (!inline && match && match[1].toLowerCase() === "audiocard") {
              try {
                const data = JSON.parse(String(children));
                return <AudioCard text={data.text} />;
              } catch (e) {
                return (
                  <div className="text-red-500 text-xs my-2 border p-2 bg-red-500/10 rounded">
                    [Failed to render audiocard: Invalid JSON data]
                  </div>
                );
              }
            }

            // ── Generative UI: Natively intercept metricscard JSON blocks ──
            if (!inline && match && match[1].toLowerCase() === "metricscard") {
              try {
                const data = JSON.parse(String(children));
                const isUp = String(data.trend).startsWith("+");
                const isDown = String(data.trend).startsWith("-");
                return (
                  <Card className="my-3 inline-block min-w-[200px]">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm font-medium text-muted-foreground">{data.title}</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-2xl font-bold">{data.value}</div>
                      {data.trend && (
                        <p className={`text-xs mt-1 flex items-center gap-1 ${isUp ? "text-green-500" : isDown ? "text-red-500" : "text-muted-foreground"}`}>
                          {isUp && <TrendingUp className="size-3" />}
                          {isDown && <TrendingDown className="size-3" />}
                          {data.trend}
                        </p>
                      )}
                    </CardContent>
                  </Card>
                );
              } catch (e) {
                return (
                  <div className="text-red-500 text-xs my-2 border p-2 bg-red-500/10 rounded">
                    [Failed to render metricscard: Invalid JSON data]
                  </div>
                );
              }
            }

            if (!inline && match) {
              return (
                <CodeBlock language={match[1]}>
                  {String(children).replace(/\n$/, "")}
                </CodeBlock>
              );
            }

            return (
              <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono" {...props}>
                {children}
              </code>
            );
          },

          // ── Images — inline with lightbox effect ──
          img({ src, alt }) {
            return (
              <ImageBlock src={String(src || "")} alt={String(alt || "image")} />
            );
          },

          // ── Links — open in new tab with icon, embed Youtube ──
          a({ href, children, ...props }) {
            const url = String(href || "");
            
            // YouTube embed detection
            if (url.includes("youtube.com/watch?v=") || url.includes("youtu.be/")) {
              let videoId = "";
              if (url.includes("youtube.com/watch?v=")) {
                videoId = new URL(url).searchParams.get("v") || "";
              } else if (url.includes("youtu.be/")) {
                videoId = url.split("youtu.be/")[1]?.split("?")[0] || "";
              }
              
              if (videoId) {
                return (
                  <div className="my-3 overflow-hidden rounded-lg aspect-video border border-border bg-muted">
                    <iframe
                      width="100%"
                      height="100%"
                      src={`https://www.youtube.com/embed/${videoId}`}
                      title="YouTube Video"
                      frameBorder="0"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                    ></iframe>
                  </div>
                );
              }
            }

            const isExternal = url.startsWith("http");
            return (
              <a
                href={url}
                target={isExternal ? "_blank" : undefined}
                rel={isExternal ? "noopener noreferrer" : undefined}
                className="text-primary underline underline-offset-2 decoration-primary/40 hover:decoration-primary inline-flex items-center gap-0.5"
                {...props}
              >
                {children}
                {isExternal && <ExternalLink className="size-3 shrink-0" />}
              </a>
            );
          },
          
          // ── Generative UI Components via custom tags ──
          // @ts-expect-error — custom tag is supported by the markdown renderer at runtime.
          metricscard({ title, value, trend, ...props }: any) {
            const isUp = String(trend).startsWith("+");
            const isDown = String(trend).startsWith("-");
            return (
              <Card className="my-3 inline-block min-w-[200px]" {...props}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{value}</div>
                  {trend && (
                    <p className={`text-xs mt-1 flex items-center gap-1 ${isUp ? "text-green-500" : isDown ? "text-red-500" : "text-muted-foreground"}`}>
                      {isUp && <TrendingUp className="size-3" />}
                      {isDown && <TrendingDown className="size-3" />}
                      {trend}
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          },

          // ── Tables — styled with borders ──
          table({ children, ...props }) {
            return (
              <div className="overflow-x-auto my-2 rounded-lg border border-border">
                <table className="w-full text-xs" {...props}>
                  {children}
                </table>
              </div>
            );
          },
          thead({ children, ...props }) {
            return (
              <thead className="bg-muted/50" {...props}>
                {children}
              </thead>
            );
          },
          th({ children, ...props }) {
            return (
              <th className="px-3 py-1.5 text-left font-medium border-b border-border" {...props}>
                {children}
              </th>
            );
          },
          td({ children, ...props }) {
            return (
              <td className="px-3 py-1.5 border-b border-border/50" {...props}>
                {children}
              </td>
            );
          },

          // ── Headings — scaled for chat context ──
          h1({ children, ...props }) {
            return <h3 className="text-base font-semibold mt-3 mb-1" {...props}>{children}</h3>;
          },
          h2({ children, ...props }) {
            return <h4 className="text-sm font-semibold mt-3 mb-1" {...props}>{children}</h4>;
          },
          h3({ children, ...props }) {
            return <h5 className="text-sm font-medium mt-2 mb-1" {...props}>{children}</h5>;
          },

          // ── Lists ──
          ul({ children, ...props }) {
            return <ul className="list-disc pl-4 my-1 space-y-0.5" {...props}>{children}</ul>;
          },
          ol({ children, ...props }) {
            return <ol className="list-decimal pl-4 my-1 space-y-0.5" {...props}>{children}</ol>;
          },
          li({ children, ...props }) {
            return <li className="text-sm" {...props}>{children}</li>;
          },

          // ── Blockquotes ──
          blockquote({ children, ...props }) {
            return (
              <blockquote
                className="border-l-2 border-primary/40 pl-3 my-2 text-muted-foreground italic"
                {...props}
              >
                {children}
              </blockquote>
            );
          },

          // ── Horizontal rules ──
          hr({ ...props }) {
            return <hr className="my-3 border-border/50" {...props} />;
          },

          // ── Paragraphs ──
          p({ children, ...props }) {
            return <p className="my-1" {...props}>{children}</p>;
          },

          // ── Strong / emphasis ──
          strong({ children, ...props }) {
            return <strong className="font-semibold" {...props}>{children}</strong>;
          },
        }}
      >
        {safeContent}
      </ReactMarkdown>
    </div>
  );
}

// ── Code Block with Copy Button ──────────────────────────
function CodeBlock({ children, language }: { children: string; language: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(children);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [children]);

  return (
    <div className="relative group my-2 rounded-lg overflow-hidden border border-border bg-[hsl(var(--muted))]">
      {/* Header with language label + copy */}
      <div className="flex items-center justify-between px-3 py-1 bg-muted/80 border-b border-border/50 text-[10px] text-muted-foreground">
        <span className="font-mono uppercase tracking-wider">{language || "text"}</span>
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={handleCopy}
        >
          {copied ? (
            <Check className="size-3 text-green-500" />
          ) : (
            <Copy className="size-3" />
          )}
        </Button>
      </div>
      {/* Code content */}
      <pre className="overflow-x-auto p-3 text-xs leading-relaxed">
        <code className={`language-${language} font-mono`}>{children}</code>
      </pre>
    </div>
  );
}

// ── Image Block with lightbox ────────────────────────────
function ImageBlock({ src, alt }: { src: string; alt: string }) {
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState(false);

  if (error) {
    return (
      <div className="flex items-center gap-2 my-2 px-3 py-2 rounded-lg border border-border bg-muted/30 text-xs text-muted-foreground">
        <ExternalLink className="size-3" />
        <a href={src} target="_blank" rel="noopener noreferrer" className="underline">
          {alt || "Image"}
        </a>
      </div>
    );
  }

  return (
    <>
      <div className="my-2 inline-block max-w-full">
        <img
          src={src}
          alt={alt}
          className="max-w-full max-h-[400px] rounded-lg border border-border cursor-pointer hover:opacity-90 transition-opacity object-contain"
          onClick={() => setExpanded(true)}
          onError={() => setError(true)}
        />
        {alt && alt !== "image" && (
          <p className="text-[10px] text-muted-foreground mt-0.5 text-center">{alt}</p>
        )}
      </div>

      {/* Lightbox overlay */}
      {expanded && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm cursor-pointer"
          onClick={() => setExpanded(false)}
        >
          <img
            src={src}
            alt={alt}
            className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg"
          />
          <div className="absolute top-4 right-4 flex gap-2">
            <a
              href={src}
              download
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
            >
              <Download className="size-4" />
            </a>
          </div>
        </div>
      )}
    </>
  );
}

// ── Audio Player ─────────────────────────────────────────
export function AudioPlayer({ src }: { src: string }) {
  const [playing, setPlaying] = useState(false);
  const [audioEl, setAudioEl] = useState<HTMLAudioElement | null>(null);

  const toggle = useCallback(() => {
    if (!audioEl) {
      const audio = new Audio(src);
      audio.onended = () => setPlaying(false);
      audio.onerror = () => setPlaying(false);
      setAudioEl(audio);
      audio.play();
      setPlaying(true);
    } else if (playing) {
      audioEl.pause();
      setPlaying(false);
    } else {
      audioEl.play();
      setPlaying(true);
    }
  }, [audioEl, playing, src]);

  return (
    <div className="flex items-center gap-2 my-1 px-3 py-2 rounded-lg border border-border bg-muted/30">
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7"
        onClick={toggle}
      >
        {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
      </Button>
      <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
        <div className={`h-full bg-primary rounded-full ${playing ? "animate-pulse w-1/2" : "w-0"} transition-all`} />
      </div>
    </div>
  );
}
