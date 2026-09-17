import type { WhatsAppMessage, WhatsAppContact, WhatsAppGroupMetadata } from './types.js';

export function formatPhoneNumber(phone: string): string {
  return phone.replace(/\D/g, '');
}

export function isGroupJid(jid: string): boolean {
  return jid.endsWith('@g.us');
}

export function isUserJid(jid: string): boolean {
  return jid.endsWith('@s.whatsapp.net');
}

export function jidToPhoneNumber(jid: string): string {
  return jid.split('@')[0];
}

export function phoneNumberToJid(phone: string, isGroup: boolean = false): string {
  const cleanNumber = formatPhoneNumber(phone);
  return isGroup ? `${cleanNumber}@g.us` : `${cleanNumber}@s.whatsapp.net`;
}

export function extractMessageBody(message: any): string {
  if (message.message?.conversation) {
    return message.message.conversation;
  }
  if (message.message?.extendedTextMessage?.text) {
    return message.message.extendedTextMessage.text;
  }
  if (message.message?.imageMessage?.caption) {
    return message.message.imageMessage.caption;
  }
  if (message.message?.videoMessage?.caption) {
    return message.message.videoMessage.caption;
  }
  return '';
}

export function hasMedia(message: WhatsAppMessage): boolean {
  return message.hasMedia;
}

export function isImageMessage(message: any): boolean {
  return !!message.message?.imageMessage;
}

export function isVideoMessage(message: any): boolean {
  return !!message.message?.videoMessage;
}

export function isAudioMessage(message: any): boolean {
  return !!message.message?.audioMessage;
}

export function isDocumentMessage(message: any): boolean {
  return !!message.message?.documentMessage;
}

export function getMediaType(message: any): 'image' | 'video' | 'audio' | 'document' | null {
  if (isImageMessage(message)) return 'image';
  if (isVideoMessage(message)) return 'video';
  if (isAudioMessage(message)) return 'audio';
  if (isDocumentMessage(message)) return 'document';
  return null;
}

export function formatTimestamp(timestamp: number | Date): string {
  const date = typeof timestamp === 'number' ? new Date(timestamp * 1000) : timestamp;
  return date.toISOString();
}

export function parseWhatsAppMessage(rawMessage: any): WhatsAppMessage | null {
  if (!rawMessage?.key?.id) {
    return null;
  }

  return {
    id: rawMessage.key.id,
    from: rawMessage.key.remoteJid || '',
    rawJid: rawMessage.key.remoteJid || '',
    to: rawMessage.key.fromMe ? rawMessage.key.remoteJid || '' : '',
    body: extractMessageBody(rawMessage),
    timestamp: new Date(rawMessage.messageTimestamp * 1000),
    isFromMe: rawMessage.key.fromMe || false,
    hasMedia: !!(rawMessage.message?.imageMessage || 
                 rawMessage.message?.videoMessage || 
                 rawMessage.message?.audioMessage || 
                 rawMessage.message?.documentMessage),
    quotedMessageId: rawMessage.message?.extendedTextMessage?.contextInfo?.stanzaId
  };
}

export function validateJid(jid: string): boolean {
  return isGroupJid(jid) || isUserJid(jid);
}

export function compareJids(jid1: string, jid2: string): boolean {
  return jid1.split('@')[0] === jid2.split('@')[0];
}

export function getDisplayName(contact: WhatsAppContact): string {
  return contact.name || contact.pushName || contact.id.split('@')[0];
}

export function getGroupDisplayName(group: WhatsAppGroupMetadata): string {
  return group.subject || group.id.split('@')[0];
}

export function isParticipantAdmin(participant: { isAdmin: boolean; isSuperAdmin: boolean }): boolean {
  return participant.isAdmin || participant.isSuperAdmin;
}

export function filterMessagesByDate(
  messages: WhatsAppMessage[], 
  startDate?: Date, 
  endDate?: Date
): WhatsAppMessage[] {
  return messages.filter(msg => {
    if (startDate && msg.timestamp < startDate) return false;
    if (endDate && msg.timestamp > endDate) return false;
    return true;
  });
}

export function sortMessagesByTimestamp(
  messages: WhatsAppMessage[], 
  ascending: boolean = true
): WhatsAppMessage[] {
  return [...messages].sort((a, b) => {
    const diff = a.timestamp.getTime() - b.timestamp.getTime();
    return ascending ? diff : -diff;
  });
}