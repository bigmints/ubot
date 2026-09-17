import { beforeEach, describe, expect, it, vi } from 'vitest';

const { bot, TelegramBotMock } = vi.hoisted(() => {
  const bot = {
    getMe: vi.fn().mockResolvedValue({
      id: 42,
      is_bot: true,
      first_name: 'Test Bot',
      username: 'test_bot',
    }),
    on: vi.fn(),
    stopPolling: vi.fn().mockResolvedValue(undefined),
    sendMessage: vi.fn().mockResolvedValue({ message_id: 1 }),
    sendPhoto: vi.fn().mockResolvedValue({ message_id: 2 }),
    sendVideo: vi.fn(),
    sendAudio: vi.fn(),
    sendVoice: vi.fn(),
    sendDocument: vi.fn(),
    sendChatAction: vi.fn(),
  };

  return {
    bot,
    TelegramBotMock: vi.fn(function TelegramBotMock() {
      return bot;
    }),
  };
});

vi.mock('node-telegram-bot-api', () => ({
  default: TelegramBotMock,
  TelegramBot: TelegramBotMock,
}));

import { TelegramConnection } from './connection.js';

describe('TelegramConnection with node-telegram-bot-api 1.x', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses modern reply_parameters for text replies', async () => {
    const connection = new TelegramConnection({ botToken: 'test-token' });
    await connection.connect();

    await connection.sendMessage(123, 'Hello', 77);

    expect(bot.sendMessage).toHaveBeenCalledWith(123, 'Hello', {
      reply_parameters: { message_id: 77 },
    });
    expect(bot.sendMessage.mock.calls[0]?.[2]).not.toHaveProperty('reply_to_message_id');
  });

  it('preserves reply metadata when sending media', async () => {
    const connection = new TelegramConnection({ botToken: 'test-token' });
    await connection.connect();

    await connection.sendMessage(123, 'Fallback caption', 77, {
      mediaType: 'image',
      mediaBase64: Buffer.from('image').toString('base64'),
      caption: 'Photo caption',
      fileName: 'photo.jpg',
      mimetype: 'image/jpeg',
    });

    expect(bot.sendPhoto).toHaveBeenCalledWith(
      123,
      Buffer.from('image'),
      {
        reply_parameters: { message_id: 77 },
        caption: 'Photo caption',
      },
      { filename: 'photo.jpg', contentType: 'image/jpeg' },
    );
  });
});
