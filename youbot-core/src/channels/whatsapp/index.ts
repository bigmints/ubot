export type {
  WhatsAppConnectionStatus,
  WhatsAppMessage,
  WhatsAppSendMessageOptions,
  WhatsAppContact,
  WhatsAppGroupMetadata,
  WhatsAppConnectionConfig,
  WhatsAppAdapterEvents,
  WhatsAppAdapterOptions,
  WhatsAppAdapter,
  WhatsAppSessionData,
  WhatsAppMessageFilter,
  WhatsAppMessageListResult
} from './types.js';

export { DEFAULT_WHATSAPP_CONFIG } from './types.js';
export { WhatsAppConnection, createWhatsAppConnection } from './connection.js';
export { WhatsAppAdapterImpl, createWhatsAppAdapter } from './adapter.js';
export { WhatsAppRateLimiter, createRateLimiter } from './rate-limiter.js';
export type { RateLimiterConfig } from './rate-limiter.js';

import { createWhatsAppAdapter } from './adapter.js';
import type { WhatsAppAdapter, WhatsAppAdapterOptions } from './types.js';

let defaultAdapter: WhatsAppAdapter | null = null;

export function initializeWhatsApp(options: WhatsAppAdapterOptions): WhatsAppAdapter {
  defaultAdapter = createWhatsAppAdapter(options);
  return defaultAdapter;
}

export function getWhatsAppAdapter(): WhatsAppAdapter | null {
  return defaultAdapter;
}

export function resetWhatsAppAdapter(): void {
  if (defaultAdapter) {
    defaultAdapter.disconnect().catch(() => {});
    defaultAdapter = null;
  }
}