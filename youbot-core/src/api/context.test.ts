import { describe, expect, it } from 'vitest';
import { Readable } from 'node:stream';
import type http from 'node:http';
import { readBodyBuffer } from './context.js';

function request(chunks: string[], headers: http.IncomingHttpHeaders = {}): http.IncomingMessage {
  const value = Readable.from(chunks) as unknown as http.IncomingMessage;
  value.headers = headers;
  return value;
}

describe('bounded raw request bodies', () => {
  it('returns bodies within the limit', async () => {
    await expect(readBodyBuffer(request(['ab', 'cd']), 4)).resolves.toEqual(Buffer.from('abcd'));
  });

  it('rejects declared and streamed bodies above the limit', async () => {
    await expect(readBodyBuffer(request([], { 'content-length': '5' }), 4)).rejects.toMatchObject({ statusCode: 413 });
    await expect(readBodyBuffer(request(['abc', 'de']), 4)).rejects.toMatchObject({ statusCode: 413 });
  });
});
