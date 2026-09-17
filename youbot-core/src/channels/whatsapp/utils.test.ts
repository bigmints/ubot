import { describe, it, expect } from 'vitest';
import {
  formatPhoneNumber,
  isGroupJid,
  isUserJid,
  jidToPhoneNumber,
  phoneNumberToJid,
  extractMessageBody,
  validateJid,
  compareJids,
  getDisplayName,
  filterMessagesByDate,
  sortMessagesByTimestamp
} from './utils.js';
import type { WhatsAppMessage, WhatsAppContact } from './types.js';

describe('WhatsApp Utils', () => {
  describe('formatPhoneNumber', () => {
    it('should remove non-numeric characters', () => {
      expect(formatPhoneNumber('+1 (234) 567-8900')).toBe('12345678900');
    });

    it('should return empty string for no digits', () => {
      expect(formatPhoneNumber('abc')).toBe('');
    });
  });

  describe('isGroupJid', () => {
    it('should return true for group JIDs', () => {
      expect(isGroupJid('123456789@g.us')).toBe(true);
    });

    it('should return false for user JIDs', () => {
      expect(isGroupJid('123456789@s.whatsapp.net')).toBe(false);
    });
  });

  describe('isUserJid', () => {
    it('should return true for user JIDs', () => {
      expect(isUserJid('123456789@s.whatsapp.net')).toBe(true);
    });

    it('should return false for group JIDs', () => {
      expect(isUserJid('123456789@g.us')).toBe(false);
    });
  });

  describe('jidToPhoneNumber', () => {
    it('should extract phone number from JID', () => {
      expect(jidToPhoneNumber('123456789@s.whatsapp.net')).toBe('123456789');
    });

    it('should extract group ID from group JID', () => {
      expect(jidToPhoneNumber('123456789@g.us')).toBe('123456789');
    });
  });

  describe('phoneNumberToJid', () => {
    it('should create user JID by default', () => {
      expect(phoneNumberToJid('123456789')).toBe('123456789@s.whatsapp.net');
    });

    it('should create group JID when specified', () => {
      expect(phoneNumberToJid('123456789', true)).toBe('123456789@g.us');
    });
  });

  describe('extractMessageBody', () => {
    it('should extract conversation text', () => {
      const message = { message: { conversation: 'Hello' } };
      expect(extractMessageBody(message)).toBe('Hello');
    });

    it('should extract extended text', () => {
      const message = { message: { extendedTextMessage: { text: 'Hello World' } } };
      expect(extractMessageBody(message)).toBe('Hello World');
    });

    it('should return empty string for no text', () => {
      const message = { message: {} };
      expect(extractMessageBody(message)).toBe('');
    });
  });

  describe('validateJid', () => {
    it('should validate user JIDs', () => {
      expect(validateJid('123456789@s.whatsapp.net')).toBe(true);
    });

    it('should validate group JIDs', () => {
      expect(validateJid('123456789@g.us')).toBe(true);
    });

    it('should reject invalid JIDs', () => {
      expect(validateJid('invalid')).toBe(false);
    });
  });

  describe('compareJids', () => {
    it('should return true for matching JIDs', () => {
      expect(compareJids('123456789@s.whatsapp.net', '123456789@g.us')).toBe(true);
    });

    it('should return false for different JIDs', () => {
      expect(compareJids('123456789@s.whatsapp.net', '987654321@s.whatsapp.net')).toBe(false);
    });
  });

  describe('getDisplayName', () => {
    it('should return name if available', () => {
      const contact: WhatsAppContact = {
        id: '123@s.whatsapp.net',
        name: 'John Doe',
        pushName: 'Johnny',
        isGroup: false,
        isBlocked: false
      };
      expect(getDisplayName(contact)).toBe('John Doe');
    });

    it('should return pushName if name not available', () => {
      const contact: WhatsAppContact = {
        id: '123@s.whatsapp.net',
        pushName: 'Johnny',
        isGroup: false,
        isBlocked: false
      };
      expect(getDisplayName(contact)).toBe('Johnny');
    });

    it('should return phone number if no name', () => {
      const contact: WhatsAppContact = {
        id: '123456789@s.whatsapp.net',
        isGroup: false,
        isBlocked: false
      };
      expect(getDisplayName(contact)).toBe('123456789');
    });
  });

  describe('filterMessagesByDate', () => {
    const messages: WhatsAppMessage[] = [
      { id: '1', from: 'a', rawJid: 'a', to: 'b', body: '1', timestamp: new Date('2024-01-01'), isFromMe: false, hasMedia: false },
      { id: '2', from: 'a', rawJid: 'a', to: 'b', body: '2', timestamp: new Date('2024-01-15'), isFromMe: false, hasMedia: false },
      { id: '3', from: 'a', rawJid: 'a', to: 'b', body: '3', timestamp: new Date('2024-01-31'), isFromMe: false, hasMedia: false }
    ];

    it('should filter by start date', () => {
      const result = filterMessagesByDate(messages, new Date('2024-01-10'));
      expect(result).toHaveLength(2);
    });

    it('should filter by end date', () => {
      const result = filterMessagesByDate(messages, undefined, new Date('2024-01-20'));
      expect(result).toHaveLength(2);
    });

    it('should filter by date range', () => {
      const result = filterMessagesByDate(messages, new Date('2024-01-10'), new Date('2024-01-20'));
      expect(result).toHaveLength(1);
    });
  });

  describe('sortMessagesByTimestamp', () => {
    const messages: WhatsAppMessage[] = [
      { id: '1', from: 'a', rawJid: 'a', to: 'b', body: '1', timestamp: new Date('2024-01-15'), isFromMe: false, hasMedia: false },
      { id: '2', from: 'a', rawJid: 'a', to: 'b', body: '2', timestamp: new Date('2024-01-01'), isFromMe: false, hasMedia: false },
      { id: '3', from: 'a', rawJid: 'a', to: 'b', body: '3', timestamp: new Date('2024-01-31'), isFromMe: false, hasMedia: false }
    ];

    it('should sort ascending by default', () => {
      const result = sortMessagesByTimestamp(messages);
      expect(result[0].id).toBe('2');
      expect(result[2].id).toBe('3');
    });

    it('should sort descending when specified', () => {
      const result = sortMessagesByTimestamp(messages, false);
      expect(result[0].id).toBe('3');
      expect(result[2].id).toBe('2');
    });
  });
});