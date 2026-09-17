"use client";

import Script from "next/script";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { initializeTelemetry, installInteractionTelemetry, trackAppPageView } from "@/lib/telemetry";

const measurementId = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID || "";

export function TelemetryProvider() {
  const pathname = usePathname();
  const enabled = /^G-[A-Z0-9]+$/.test(measurementId);

  useEffect(() => {
    if (!enabled || !initializeTelemetry(measurementId)) return;
    return installInteractionTelemetry();
  }, [enabled]);

  useEffect(() => {
    if (!enabled || !initializeTelemetry(measurementId)) return;
    trackAppPageView(pathname || "/");
  }, [enabled, pathname]);

  if (!enabled) return null;
  return (
    <Script
      id="youbot-ga4"
      src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`}
      strategy="afterInteractive"
    />
  );
}
