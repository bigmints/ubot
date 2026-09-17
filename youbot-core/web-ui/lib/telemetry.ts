export type TelemetryValue = string | number | boolean;
export type TelemetryParams = Record<string, TelemetryValue | undefined>;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
    __youbotTelemetry?: { measurementId: string; lastPage?: string };
  }
}

const SAFE_SEGMENTS = new Set([
  "chat", "concierge", "connections", "contacts", "conversations", "help",
  "integrations", "llms", "logs", "mcp-servers", "personas", "profile",
  "safety", "scheduler", "settings", "setup", "skills", "telegram", "tools",
  "vault", "webchat", "whatsapp", "collections", "new",
]);
const SAFE_VALUE = /^[a-z0-9_./:-]{1,100}$/;
const SAFE_PARAM_KEYS = new Set([
  "surface", "route", "interaction", "control", "action", "destination",
  "outcome", "media_kind", "status_class", "duration_band",
]);

function safeValue(value: TelemetryValue | undefined): TelemetryValue | undefined {
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase().replace(/\s+/g, "_");
  return SAFE_VALUE.test(normalized) ? normalized : undefined;
}

export function sanitizeAppRoute(pathname: string): string {
  const segments = pathname.split("/").filter(Boolean);
  if (!segments.length) return "/";
  return `/${segments.map((segment) => {
    const normalized = segment.toLowerCase();
    if (SAFE_SEGMENTS.has(normalized)) return normalized;
    return ":id";
  }).join("/")}`;
}

function sanitizedLocation(route: string): string {
  return `https://app.youbot.local${route}`;
}

export function initializeTelemetry(measurementId: string): boolean {
  if (typeof window === "undefined" || !/^G-[A-Z0-9]+$/.test(measurementId)) return false;
  if (window.__youbotTelemetry?.measurementId === measurementId) return true;

  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function gtag(...args: unknown[]) {
    window.dataLayer?.push(args);
  };
  window.gtag("consent", "default", {
    analytics_storage: "denied",
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
    wait_for_update: 0,
  });
  window.gtag("set", "ads_data_redaction", true);
  window.gtag("set", "url_passthrough", false);
  window.gtag("js", new Date());
  window.gtag("config", measurementId, {
    send_page_view: false,
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
    cookie_update: false,
    page_location: sanitizedLocation("/"),
    page_referrer: "",
  });
  window.__youbotTelemetry = { measurementId };
  return true;
}

export function trackTelemetryEvent(name: string, params: TelemetryParams): void {
  if (typeof window === "undefined" || !window.__youbotTelemetry || !window.gtag) return;
  if (!/^[a-z][a-z0-9_]{0,39}$/.test(name)) return;
  const clean: Record<string, TelemetryValue> = {};
  for (const [key, value] of Object.entries(params)) {
    if (!SAFE_PARAM_KEYS.has(key)) continue;
    const sanitized = safeValue(value);
    if (sanitized !== undefined) clean[key] = sanitized;
  }
  const route = typeof clean.route === "string" ? clean.route : "/";
  window.gtag("event", name, {
    ...clean,
    page_location: sanitizedLocation(route),
    page_referrer: "",
  });
}

export function trackAppPageView(pathname: string): void {
  const route = sanitizeAppRoute(pathname);
  if (!window.__youbotTelemetry || window.__youbotTelemetry.lastPage === route) return;
  window.__youbotTelemetry.lastPage = route;
  trackTelemetryEvent("page_view", { surface: "app", route });
}

function closestControl(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element
    ? target.closest<HTMLElement>("a,button,summary,[role='button'],input,select,textarea")
    : null;
}

function controlKind(control: HTMLElement): string {
  if (control instanceof HTMLAnchorElement) return "link";
  if (control instanceof HTMLButtonElement) return "button";
  if (control instanceof HTMLSelectElement) return "select";
  if (control instanceof HTMLTextAreaElement) return "textarea";
  if (control instanceof HTMLInputElement) return control.type || "input";
  return control.getAttribute("role") === "button" ? "button" : control.tagName.toLowerCase();
}

function explicitAction(control: HTMLElement): string | undefined {
  return safeValue(control.dataset.telemetry) as string | undefined;
}

function destination(control: HTMLElement): string | undefined {
  if (!(control instanceof HTMLAnchorElement)) return undefined;
  const href = control.getAttribute("href") || "";
  if (href.startsWith("#")) return "anchor";
  try {
    const url = new URL(href, window.location.origin);
    return url.origin === window.location.origin ? sanitizeAppRoute(url.pathname) : "external";
  } catch {
    return undefined;
  }
}

export function installInteractionTelemetry(): () => void {
  const click = (event: MouseEvent) => {
    const control = closestControl(event.target);
    if (!control) return;
    trackTelemetryEvent("ui_interaction", {
      surface: "app",
      route: sanitizeAppRoute(window.location.pathname),
      interaction: "click",
      control: controlKind(control),
      action: explicitAction(control),
      destination: destination(control),
    });
  };
  const submit = (event: SubmitEvent) => {
    if (!(event.target instanceof HTMLFormElement)) return;
    trackTelemetryEvent("ui_interaction", {
      surface: "app",
      route: sanitizeAppRoute(window.location.pathname),
      interaction: "submit",
      control: "form",
      action: safeValue(event.target.dataset.telemetry) as string | undefined,
    });
  };
  const change = (event: Event) => {
    const control = closestControl(event.target);
    if (!control) return;
    const kind = controlKind(control);
    if (!["select", "checkbox", "radio", "range"].includes(kind)) return;
    trackTelemetryEvent("ui_interaction", {
      surface: "app",
      route: sanitizeAppRoute(window.location.pathname),
      interaction: "change",
      control: kind,
      action: explicitAction(control),
    });
  };
  document.addEventListener("click", click, { capture: true });
  document.addEventListener("submit", submit, { capture: true });
  document.addEventListener("change", change, { capture: true });
  return () => {
    document.removeEventListener("click", click, { capture: true });
    document.removeEventListener("submit", submit, { capture: true });
    document.removeEventListener("change", change, { capture: true });
  };
}
