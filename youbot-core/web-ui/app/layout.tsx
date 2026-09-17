import type { Metadata } from "next";
import "./globals.css";

import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { CoreLayoutWrapper } from "@/components/layout-wrapper";
import { ThemeInjector } from "@/components/theme-injector";
import { ThemeProvider } from "@/components/theme-provider";
import { ExtensionsLoader } from "@/lib/extensions";
import { TelemetryProvider } from "@/components/telemetry-provider";

// Static SSR defaults — ThemeInjector overrides at runtime from config.json theme
export const metadata: Metadata = {
  title: "Youbot",
  description: "Build your personal concierge. Welcome visitors and manage conversations.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
<body className="antialiased">
<TelemetryProvider />
<ThemeProvider>
          <ExtensionsLoader />
          <TooltipProvider>
            <CoreLayoutWrapper>{children}</CoreLayoutWrapper>
          </TooltipProvider>
          <ThemeInjector />
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
