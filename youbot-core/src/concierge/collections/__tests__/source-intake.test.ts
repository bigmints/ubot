import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  COLLECTION_SOURCE_LIMITS,
  CollectionSourceIntakeError,
  createPinnedLookup,
  decodeCollectionImage,
  fetchCollectionUrl,
} from '../source-intake.js';

function websiteResponse(
  status: number,
  body = '',
  headers: Record<string, string> = { 'content-type': 'text/plain' },
) {
  const normalized = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  return {
    status,
    headers: { get: (name: string) => normalized[name.toLowerCase()] || null },
    body: Readable.from([Buffer.from(body)]),
    cancel: vi.fn(),
  };
}

const publicDns = vi.fn(async () => ['93.184.216.34']);

async function expectIntakeError(operation: Promise<unknown>, code: string) {
  await expect(operation).rejects.toMatchObject<Partial<CollectionSourceIntakeError>>({ code });
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('collection website source intake', () => {
  it('returns pinned addresses in both single-address and Node all-address lookup modes', async () => {
    const pinned = createPinnedLookup(['93.184.216.34', '2606:2800:220:1:248:1893:25c8:1946']);
    const single = await new Promise<{ address: string; family: number }>((resolve, reject) => {
      pinned('example.com', {}, (error: Error | null, address: string, family: number) => {
        if (error) reject(error); else resolve({ address, family });
      });
    });
    const all = await new Promise<Array<{ address: string; family: number }>>((resolve, reject) => {
      pinned('example.com', { all: true }, (error: Error | null, addresses: Array<{ address: string; family: number }>) => {
        if (error) reject(error); else resolve(addresses);
      });
    });
    expect(single).toEqual({ address: '93.184.216.34', family: 4 });
    expect(all).toEqual([
      { address: '93.184.216.34', family: 4 },
      { address: '2606:2800:220:1:248:1893:25c8:1946', family: 6 },
    ]);
  });

  it.each([
    'http://example.com/catalogue',
    'https://user:secret@example.com/catalogue',
    'https://example.com:8443/catalogue',
    'https://localhost/catalogue',
    'https://catalogue.local/items',
    'https://127.0.0.1/items',
    'https://10.0.0.1/items',
    'https://100.64.0.1/items',
    'https://169.254.169.254/items',
    'https://192.168.1.1/items',
    'https://224.0.0.1/items',
    'https://[::]/items',
    'https://[::1]/items',
    'https://[fc00::1]/items',
    'https://[fe80::1]/items',
    'https://[ff02::1]/items',
    'https://[2001:db8::1]/items',
    'https://[::ffff:127.0.0.1]/items',
    'https://[::ffff:7f00:1]/items',
  ])('rejects unsafe address %s', async (url) => {
    await expectIntakeError(fetchCollectionUrl(url, {
      resolveHost: publicDns,
      request: vi.fn(async () => websiteResponse(200, 'never')),
    }), 'URL_UNSAFE');
  });

  it('rejects empty and mixed public/private DNS results before requesting', async () => {
    const request = vi.fn(async () => websiteResponse(200, 'never'));
    await expectIntakeError(fetchCollectionUrl('https://empty.example/', {
      resolveHost: async () => [], request,
    }), 'URL_UNSAFE');
    await expectIntakeError(fetchCollectionUrl('https://mixed.example/', {
      resolveHost: async () => ['93.184.216.34', '127.0.0.1'], request,
    }), 'URL_UNSAFE');
    expect(request).not.toHaveBeenCalled();
  });

  it('pins validated DNS addresses and revalidates every redirect hop', async () => {
    const resolveHost = vi.fn(async (hostname: string) => (
      hostname === 'first.example' ? ['93.184.216.34'] : ['142.250.72.14']
    ));
    const request = vi.fn(async (url: URL, options: { addresses: readonly string[] }) => {
      if (url.hostname === 'first.example') {
        expect(options.addresses).toEqual(['93.184.216.34']);
        return websiteResponse(302, '', { location: 'https://second.example/catalogue' });
      }
      expect(options.addresses).toEqual(['142.250.72.14']);
      return websiteResponse(200, '<h1>Pottery classes</h1>', { 'content-type': 'text/html' });
    });
    const source = await fetchCollectionUrl('https://first.example/start#section', { resolveHost, request });
    expect(resolveHost.mock.calls.map(([host]) => host)).toEqual(['first.example', 'second.example']);
    expect(request).toHaveBeenCalledTimes(2);
    expect(source).toMatchObject({
      requestedUrl: 'https://first.example/start',
      finalUrl: 'https://second.example/catalogue',
      text: 'Pottery classes',
      coverage: { status: 'complete' },
    });
  });

  it('blocks a redirect to a private target before the second request', async () => {
    const request = vi.fn(async () => websiteResponse(302, '', { location: 'https://127.0.0.1/private' }));
    await expectIntakeError(fetchCollectionUrl('https://example.com/start', {
      resolveHost: publicDns,
      request,
    }), 'URL_UNSAFE');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('rejects unsupported types and declared or streamed oversized bodies', async () => {
    await expectIntakeError(fetchCollectionUrl('https://example.com/image', {
      resolveHost: publicDns,
      request: async () => websiteResponse(200, 'image', { 'content-type': 'image/png' }),
    }), 'URL_TYPE_UNSUPPORTED');
    await expectIntakeError(fetchCollectionUrl('https://example.com/declared', {
      resolveHost: publicDns,
      request: async () => websiteResponse(200, '', {
        'content-type': 'text/plain',
        'content-length': String(COLLECTION_SOURCE_LIMITS.maxUrlBytes + 1),
      }),
    }), 'URL_TOO_LARGE');
    await expectIntakeError(fetchCollectionUrl('https://example.com/streamed', {
      resolveHost: publicDns,
      request: async () => websiteResponse(200, 'x'.repeat(COLLECTION_SOURCE_LIMITS.maxUrlBytes + 1)),
    }), 'URL_TOO_LARGE');
  });

  it('strips inactive HTML and reports bounded text as partial coverage', async () => {
    const longText = 'A'.repeat(COLLECTION_SOURCE_LIMITS.maxUrlTextCharacters + 10);
    const source = await fetchCollectionUrl('https://example.com/catalogue', {
      resolveHost: publicDns,
      request: async () => websiteResponse(
        200,
        `<script>ignore()</script><style>.x{}</style><template>hidden</template><h1>Menu &amp; prices</h1><p>${longText}</p>`,
        { 'content-type': 'text/html; charset=utf-8' },
      ),
    });
    expect(source.text).toContain('Menu & prices');
    expect(source.text).not.toContain('ignore');
    expect(source.characterCount).toBe(COLLECTION_SOURCE_LIMITS.maxUrlTextCharacters);
    expect(source.coverage).toMatchObject({ status: 'partial', characterCount: 50_000 });
  });

  it('maps request failure and one overall deadline to retryable errors', async () => {
    await expect(fetchCollectionUrl('https://example.com/failure', {
      resolveHost: publicDns,
      request: async () => { throw new Error('socket secret'); },
    })).rejects.toMatchObject({ code: 'URL_FETCH_FAILED', retryable: true });

    vi.useFakeTimers();
    const pending = fetchCollectionUrl('https://example.com/slow', {
      resolveHost: publicDns,
      request: async () => new Promise(() => undefined),
    });
    const timeoutExpectation = expect(pending).rejects.toMatchObject({ code: 'URL_TIMEOUT', retryable: true });
    await vi.advanceTimersByTimeAsync(COLLECTION_SOURCE_LIMITS.timeoutMs + 1);
    await timeoutExpectation;
  });
});

describe('collection image source intake', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00]);
  const webp = Buffer.from('RIFF0000WEBPdata');

  it.each([
    { filename: 'menu.png', mimeType: 'image/png', bytes: png },
    { filename: 'menu.jpeg', mimeType: 'image/jpeg', bytes: jpeg },
    { filename: 'menu.webp', mimeType: 'image/webp', bytes: webp },
  ])('validates and hashes $mimeType bytes', ({ filename, mimeType, bytes }) => {
    const source = decodeCollectionImage({ filename, mimeType, base64: bytes.toString('base64') });
    expect(source).toMatchObject({ filename, mimeType, byteCount: bytes.length });
    expect(source.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(Buffer.from(source.bytes)).toEqual(bytes);
  });

  it('rejects malformed and noncanonical base64', () => {
    const malformed = () => decodeCollectionImage({ filename: 'menu.png', mimeType: 'image/png', base64: 'AAAAA' });
    const noncanonical = () => decodeCollectionImage({ filename: 'menu.png', mimeType: 'image/png', base64: 'not base64' });
    expect(malformed).toThrow(CollectionSourceIntakeError);
    expect(noncanonical).toThrow(CollectionSourceIntakeError);
    try { malformed(); } catch (error) { expect(error).toMatchObject({ code: 'IMAGE_INVALID' }); }
    try { noncanonical(); } catch (error) { expect(error).toMatchObject({ code: 'IMAGE_INVALID' }); }
  });

  it('rejects filename, MIME, magic-byte, unsupported, and size mismatches', () => {
    const errorCode = (input: Parameters<typeof decodeCollectionImage>[0]) => {
      try { decodeCollectionImage(input); } catch (error) { return (error as CollectionSourceIntakeError).code; }
      return undefined;
    };
    expect(errorCode({ filename: 'menu.jpg', mimeType: 'image/png', base64: png.toString('base64') }))
      .toBe('IMAGE_TYPE_MISMATCH');
    expect(errorCode({ filename: 'menu.png', mimeType: 'image/png', base64: jpeg.toString('base64') }))
      .toBe('IMAGE_TYPE_MISMATCH');
    expect(errorCode({ filename: 'menu.gif', mimeType: 'image/gif', base64: 'R0lGODlh' }))
      .toBe('IMAGE_TYPE_UNSUPPORTED');
    const oversized = Buffer.alloc(COLLECTION_SOURCE_LIMITS.maxImageBytes + 1);
    oversized.set(png);
    expect(errorCode({ filename: 'menu.png', mimeType: 'image/png', base64: oversized.toString('base64') }))
      .toBe('IMAGE_TOO_LARGE');
  });
});
