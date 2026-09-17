(function () {
  'use strict';

  const SAFE_SITE_ROUTES = new Set([
    '/', '/404', '/docs', '/docs/installation', '/docs/first-concierge',
    '/docs/ai-providers', '/docs/connections', '/docs/relay', '/docs/privacy',
    '/docs/troubleshooting',
  ]);
  const loaderScript = document.currentScript;
  const configOrigin = loaderScript?.src ? new URL(loaderScript.src).origin : location.origin;
  const forcedSurface = loaderScript?.dataset.youbotTelemetry;
  const SAFE_VALUE = /^[a-z0-9_./:-]{1,100}$/;
  const SAFE_KEYS = new Set([
    'surface', 'route', 'interaction', 'control', 'action', 'destination',
    'outcome', 'media_kind', 'status_class', 'duration_band', 'query_state',
  ]);
  const state = { enabled: false, surface: 'site', route: '/', lastPage: '' };

  function sanitizeValue(value) {
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    if (typeof value !== 'string') return undefined;
    const normalized = value.trim().toLowerCase().replace(/\s+/g, '_');
    return SAFE_VALUE.test(normalized) ? normalized : undefined;
  }

  function detectSurface(pathname) {
    return SAFE_SITE_ROUTES.has(pathname.replace(/\/$/, '') || '/') || pathname.startsWith('/docs/')
      ? 'site'
      : 'relay_ui';
  }

  function sanitizeRoute(pathname, surface) {
    const normalized = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
    if (surface === 'site') return SAFE_SITE_ROUTES.has(normalized) ? normalized : '/404';
    const parts = normalized.split('/').filter(Boolean);
    if (!parts.length) return '/:relay';
    if (parts[1] === 'k') return '/:relay/k/:owner';
    return '/:relay';
  }

  function safeLocation(route) {
    return 'https://youbot.live' + route;
  }

  function queue() {
    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
    window.gtag.apply(window, arguments);
  }

  function event(name, params) {
    if (!state.enabled || !/^[a-z][a-z0-9_]{0,39}$/.test(name)) return;
    const clean = {};
    Object.entries(params || {}).forEach(([key, value]) => {
      if (!SAFE_KEYS.has(key)) return;
      const sanitized = sanitizeValue(value);
      if (sanitized !== undefined) clean[key] = sanitized;
    });
    const route = typeof clean.route === 'string' ? clean.route : state.route;
    queue('event', name, {
      ...clean,
      surface: state.surface,
      route,
      page_location: safeLocation(route),
      page_referrer: '',
    });
  }

  function pageView() {
    if (!state.enabled || state.lastPage === state.route) return;
    state.lastPage = state.route;
    event('page_view', { route: state.route });
  }

  function controlFor(target) {
    return target instanceof Element
      ? target.closest('a,button,summary,[role="button"],input,select,textarea')
      : null;
  }

  function controlKind(control) {
    if (control instanceof HTMLAnchorElement) return 'link';
    if (control instanceof HTMLButtonElement) return 'button';
    if (control instanceof HTMLSelectElement) return 'select';
    if (control instanceof HTMLTextAreaElement) return 'textarea';
    if (control instanceof HTMLInputElement) return control.type || 'input';
    return control.getAttribute('role') === 'button' ? 'button' : control.tagName.toLowerCase();
  }

  function destinationFor(control) {
    if (!(control instanceof HTMLAnchorElement)) return undefined;
    const href = control.getAttribute('href') || '';
    if (href.startsWith('#')) return 'anchor';
    try {
      const url = new URL(href, location.origin);
      if (url.origin !== location.origin) return 'external';
      return sanitizeRoute(url.pathname, detectSurface(url.pathname));
    } catch { return undefined; }
  }

  function installInteractions() {
    document.addEventListener('click', interaction => {
      const control = controlFor(interaction.target);
      if (!control) return;
      event('ui_interaction', {
        route: state.route,
        interaction: 'click',
        control: controlKind(control),
        action: control.dataset.telemetry,
        destination: destinationFor(control),
      });
    }, true);
    document.addEventListener('submit', interaction => {
      if (!(interaction.target instanceof HTMLFormElement)) return;
      event('ui_interaction', {
        route: state.route,
        interaction: 'submit',
        control: 'form',
        action: interaction.target.dataset.telemetry,
      });
    }, true);
    document.addEventListener('change', interaction => {
      const control = controlFor(interaction.target);
      if (!control) return;
      const kind = controlKind(control);
      if (!['select', 'checkbox', 'radio', 'range'].includes(kind)) return;
      event('ui_interaction', {
        route: state.route,
        interaction: 'change',
        control: kind,
        action: control.dataset.telemetry,
      });
    }, true);
  }

  async function initialize() {
    try {
      const response = await fetch(`${configOrigin}/telemetry/config`, { credentials: 'omit', cache: 'no-store' });
      if (!response.ok) return;
      const config = await response.json();
      if (!/^G-[A-Z0-9]+$/.test(config.measurementId || '')) return;
      state.surface = forcedSurface === 'relay_ui' ? 'relay_ui' : detectSurface(location.pathname);
      state.route = sanitizeRoute(location.pathname, state.surface);
      queue('consent', 'default', {
        analytics_storage: 'denied', ad_storage: 'denied', ad_user_data: 'denied',
        ad_personalization: 'denied', wait_for_update: 0,
      });
      queue('set', 'ads_data_redaction', true);
      queue('set', 'url_passthrough', false);
      queue('js', new Date());
      queue('config', config.measurementId, {
        send_page_view: false,
        allow_google_signals: false,
        allow_ad_personalization_signals: false,
        cookie_update: false,
        page_location: safeLocation(state.route),
        page_referrer: '',
      });
      state.enabled = true;
      installInteractions();
      pageView();
      const script = document.createElement('script');
      script.async = true;
      script.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(config.measurementId);
      script.referrerPolicy = 'no-referrer';
      document.head.appendChild(script);
    } catch { /* Telemetry must never affect the product. */ }
  }

  window.youbotTelemetry = Object.freeze({ event, pageView });
  initialize();
})();
