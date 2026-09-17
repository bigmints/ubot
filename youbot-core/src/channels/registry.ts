/**
 * Messaging Registry
 * Manages registered messaging providers and routes operations to them.
 */

import type { MessagingProvider, ChannelType } from './types.js';

export class MessagingRegistry {
  private providers = new Map<ChannelType, MessagingProvider>();
  private defaultChannel: ChannelType | null = null;

  /** Register a messaging provider */
  register(provider: MessagingProvider): void {
    this.providers.set(provider.channel, provider);
    // First registered provider becomes default
    if (!this.defaultChannel) {
      this.defaultChannel = provider.channel;
    }
  }

  /** Unregister a provider */
  unregister(channel: ChannelType): void {
    this.providers.delete(channel);
    if (this.defaultChannel === channel) {
      // Pick next available or null
      const next = this.providers.keys().next();
      this.defaultChannel = next.done ? null : next.value;
    }
  }

  /** Get a specific provider by channel */
  getProvider(channel: ChannelType): MessagingProvider {
    const provider = this.providers.get(channel);
    if (!provider) {
      throw new Error(`No messaging provider registered for channel: ${channel}`);
    }
    return provider;
  }

  /** Get the default provider (first registered, or the only connected one) */
  getDefaultProvider(): MessagingProvider {
    // Prefer a connected provider
    for (const provider of this.providers.values()) {
      if (provider.status === 'connected') {
        return provider;
      }
    }
    // Fall back to default channel
    if (this.defaultChannel) {
      return this.getProvider(this.defaultChannel);
    }
    throw new Error('No messaging providers registered');
  }

  /** Get all registered providers */
  getAllProviders(): MessagingProvider[] {
    return Array.from(this.providers.values());
  }

  /** Get all connected providers */
  getConnectedProviders(): MessagingProvider[] {
    return this.getAllProviders().filter(p => p.status === 'connected');
  }

  /** Check if any provider is registered */
  hasProviders(): boolean {
    return this.providers.size > 0;
  }

  /** Set the default channel */
  setDefaultChannel(channel: ChannelType): void {
    if (!this.providers.has(channel)) {
      throw new Error(`Cannot set default: no provider for channel ${channel}`);
    }
    this.defaultChannel = channel;
  }

  /** Resolve a provider — use specified channel or fall back to default */
  resolveProvider(channel?: string): MessagingProvider {
    if (channel) {
      return this.getProvider(channel as ChannelType);
    }
    return this.getDefaultProvider();
  }
}

export function createMessagingRegistry(): MessagingRegistry {
  return new MessagingRegistry();
}
