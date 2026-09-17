import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { WhatsAppAdapter } from './types.js';

// Use vi.hoisted to create shared state that works with vi.mock hoisting
const { mockSocket, getMockSocketConnected, setMockSocketConnected } = vi.hoisted(() => {
  let connected = false;
  const socket = {
    sendMessage: vi.fn(),
    groupMetadata: vi.fn(),
    loadMessages: vi.fn(),
    downloadMediaMessage: vi.fn(),
    store: { contacts: {} as Record<string, any>, chats: {} as Record<string, any> },
    ev: { on: vi.fn(), off: vi.fn() }
  };
  return {
    mockSocket: socket,
    getMockSocketConnected: () => connected,
    setMockSocketConnected: (val: boolean) => { connected = val; }
  };
});

vi.mock('./connection.js', () => {
  return {
    WhatsAppConnection: vi.fn().mockImplementation(() => ({
      connect: vi.fn().mockResolvedValue(mockSocket),
      disconnect: vi.fn().mockResolvedValue(undefined),
      getSocket: vi.fn().mockImplementation(() => getMockSocketConnected() ? mockSocket : null),
      sendMessage: vi.fn().mockImplementation((...args: unknown[]) => mockSocket.sendMessage(...args)),
      on: vi.fn(),
      off: vi.fn()
    })),
    createWhatsAppConnection: vi.fn().mockReturnValue({
      connect: vi.fn().mockResolvedValue(mockSocket),
      disconnect: vi.fn().mockResolvedValue(undefined),
      getSocket: vi.fn().mockImplementation(() => getMockSocketConnected() ? mockSocket : null),
      sendMessage: vi.fn().mockImplementation((...args: unknown[]) => mockSocket.sendMessage(...args)),
      on: vi.fn(),
      off: vi.fn()
    })
  };
});

// Import after mock setup
import { WhatsAppAdapterImpl, createWhatsAppAdapter } from './adapter.js';

describe('WhatsAppAdapter', () => {
  let adapter: WhatsAppAdapter;

  beforeEach(() => {
    setMockSocketConnected(false);
    vi.clearAllMocks();
    // Reset store
    mockSocket.store = { contacts: {}, chats: {} };
    adapter = createWhatsAppAdapter({
      config: {
        sessionName: 'test-session',
        printQRInTerminal: false
      }
    });
  });

  afterEach(async () => {
    if (adapter) {
      await adapter.disconnect().catch(() => {});
    }
  });

  describe('createWhatsAppAdapter', () => {
    it('should create an adapter instance', () => {
      expect(adapter).toBeDefined();
      expect(adapter.status).toBe('disconnected');
    });

    it('should have null socket initially', () => {
      expect(adapter.socket).toBeNull();
    });
  });

  describe('status', () => {
    it('should return disconnected status initially', () => {
      expect(adapter.status).toBe('disconnected');
    });
  });

  describe('event handling', () => {
    it('should register event listeners', () => {
      const listener = vi.fn();
      adapter.on('connection.update', listener);
      expect(() => adapter.on('connection.update', listener)).not.toThrow();
    });

    it('should unregister event listeners', () => {
      const listener = vi.fn();
      adapter.on('connection.update', listener);
      adapter.off('connection.update', listener);
      expect(() => adapter.off('connection.update', listener)).not.toThrow();
    });
  });

  describe('sendMessage', () => {
    it('should throw error when not connected', async () => {
      await expect(adapter.sendMessage('1234567890', 'Hello'))
        .rejects.toThrow('Not connected to WhatsApp');
    });

    it('should send message when connected', async () => {
      setMockSocketConnected(true);
      mockSocket.sendMessage.mockResolvedValue({
        key: { id: 'msg-123', fromMe: true },
      });

      const message = await adapter.sendMessage('1234567890', 'Hello');
      expect(message.id).toBe('msg-123');
      expect(message.body).toBe('Hello');
      expect(message.isFromMe).toBe(true);
    });
  });

  describe('getContacts', () => {
    it('should throw error when not connected', async () => {
      await expect(adapter.getContacts())
        .rejects.toThrow('Not connected to WhatsApp');
    });

    it('should return contacts when connected', async () => {
      setMockSocketConnected(true);
      mockSocket.store = {
        contacts: {
          '1234@s.whatsapp.net': { name: 'Test User', notify: 'Test' }
        },
        chats: {}
      };

      const contacts = await adapter.getContacts();
      expect(contacts).toHaveLength(1);
      expect(contacts[0].name).toBe('Test User');
    });
  });

  describe('getGroups', () => {
    it('should throw error when not connected', async () => {
      await expect(adapter.getGroups())
        .rejects.toThrow('Not connected to WhatsApp');
    });
  });

  describe('getGroupMetadata', () => {
    it('should throw error when not connected', async () => {
      await expect(adapter.getGroupMetadata('1234567890@g.us'))
        .rejects.toThrow('Not connected to WhatsApp');
    });

    it('should return group metadata when connected', async () => {
      setMockSocketConnected(true);
      mockSocket.groupMetadata.mockResolvedValue({
        id: '1234567890@g.us',
        subject: 'Test Group',
        owner: '111@s.whatsapp.net',
        participants: [
          { id: '111@s.whatsapp.net', admin: 'superadmin' },
          { id: '222@s.whatsapp.net', admin: null }
        ],
        creation: 1700000000
      });

      const metadata = await adapter.getGroupMetadata('1234567890@g.us');
      expect(metadata.subject).toBe('Test Group');
      expect(metadata.participants).toHaveLength(2);
    });
  });

  describe('downloadMedia', () => {
    it('should throw error when not connected', async () => {
      await expect(adapter.downloadMedia('message-id'))
        .rejects.toThrow('Not connected to WhatsApp');
    });
  });
});

describe('WhatsAppAdapterImpl', () => {
  beforeEach(() => {
    setMockSocketConnected(false);
    vi.clearAllMocks();
  });

  it('should be instantiable', () => {
    const adapter = new WhatsAppAdapterImpl({
      config: { sessionName: 'test' }
    });
    expect(adapter).toBeInstanceOf(WhatsAppAdapterImpl);
  });
});