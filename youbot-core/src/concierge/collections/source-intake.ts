import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';

export const COLLECTION_SOURCE_LIMITS = Object.freeze({
  maxUrlBytes: 1_000_000,
  maxUrlTextCharacters: 50_000,
  maxImageBytes: 6 * 1024 * 1024,
  maxImageTextCharacters: 1_000_000,
  maxRedirects: 4,
  timeoutMs: 10_000,
  imageTimeoutMs: 90_000,
});

export class CollectionSourceIntakeError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly retryable: boolean,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'CollectionSourceIntakeError';
  }
}

export type UrlSource = {
  kind: 'url';
  requestedUrl: string;
  finalUrl: string;
  url: string;
  mediaType: 'text/html' | 'text/plain' | 'application/json';
  text: string;
  sha256: string;
  byteCount: number;
  characterCount: number;
  truncated: boolean;
  coverage: {
    status: 'complete' | 'partial';
    characterCount: number;
    reasons: string[];
  };
};

export type ImageSource = {
  kind: 'image';
  filename: string;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  bytes: Uint8Array;
  sha256: string;
  byteCount: number;
};

type WebsiteResponse = {
  status: number;
  headers: { get(name: string): string | null };
  body: AsyncIterable<Uint8Array>;
  cancel(): void;
};

export type CollectionSourceDependencies = {
  resolveHost?: (hostname: string) => Promise<readonly string[]>;
  request?: (
    url: URL,
    options: { signal: AbortSignal; addresses: readonly string[] },
  ) => Promise<WebsiteResponse>;
  signal?: AbortSignal;
};

let testDependencies: CollectionSourceDependencies | undefined;

export function setCollectionSourceDependenciesForTests(
  dependencies: CollectionSourceDependencies | undefined,
): void {
  if (process.env.NODE_ENV !== 'test' && !process.env.VITEST) {
    throw new Error('Collection source dependency overrides are test-only.');
  }
  testDependencies = dependencies;
}

function explicitPort(authority: string): boolean {
  const hostPort = authority.slice(authority.lastIndexOf('@') + 1);
  if (hostPort.startsWith('[')) return !hostPort.endsWith(']');
  return hostPort.includes(':');
}

function safeUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new CollectionSourceIntakeError('URL_INVALID', 'Add a valid HTTPS URL.', 400, false);
  }
  const authority = rawUrl.trim().match(/^https:\/\/([^/?#]+)/i)?.[1] || '';
  if (url.protocol !== 'https:' || url.username || url.password || url.port || explicitPort(authority)) {
    throw new CollectionSourceIntakeError(
      'URL_UNSAFE',
      'Only public HTTPS URLs without credentials or custom ports are supported.',
      400,
      false,
    );
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    throw new CollectionSourceIntakeError('URL_UNSAFE', 'Local website addresses are not supported.', 400, false);
  }
  url.hash = '';
  return url;
}

export function normalizeCollectionUrl(rawUrl: string): string {
  return safeUrl(rawUrl).toString();
}

function privateIpv4(address: string): boolean {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b, c] = parts;
  return a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && (b === 0 || b === 168))
    || (a === 192 && b === 88 && c === 99)
    || (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100)))
    || (a === 203 && b === 0 && c === 113)
    || a >= 224;
}

function ipv6Bytes(address: string): Uint8Array | undefined {
  let value = address.toLowerCase().split('%', 1)[0]!;
  const dotted = value.match(/(?:^|:)(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (dotted) {
    const octets = dotted.split('.').map(Number);
    if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return undefined;
    value = `${value.slice(0, value.length - dotted.length)}${((octets[0]! << 8) | octets[1]!).toString(16)}:${((octets[2]! << 8) | octets[3]!).toString(16)}`;
  }
  const halves = value.split('::');
  if (halves.length > 2) return undefined;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return undefined;
  const groups = [...left, ...Array(Math.max(0, missing)).fill('0'), ...right];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return undefined;
  const bytes = new Uint8Array(16);
  groups.forEach((group, index) => {
    const parsed = Number.parseInt(group, 16);
    bytes[index * 2] = parsed >> 8;
    bytes[index * 2 + 1] = parsed & 0xff;
  });
  return bytes;
}

function privateAddress(address: string): boolean {
  const normalized = address.toLowerCase().split('%', 1)[0]!.replace(/^\[|\]$/g, '');
  if (isIP(normalized) === 4) return privateIpv4(normalized);
  if (isIP(normalized) !== 6) return true;
  const bytes = ipv6Bytes(normalized);
  if (!bytes) return true;
  const allZero = bytes.every((byte) => byte === 0);
  const loopback = bytes.slice(0, 15).every((byte) => byte === 0) && bytes[15] === 1;
  const mappedV4 = bytes.slice(0, 10).every((byte) => byte === 0)
    && bytes[10] === 0xff && bytes[11] === 0xff;
  const compatibleV4 = bytes.slice(0, 12).every((byte) => byte === 0);
  if (mappedV4 || compatibleV4) {
    return privateIpv4(`${bytes[12]}.${bytes[13]}.${bytes[14]}.${bytes[15]}`);
  }
  return allZero
    || loopback
    || (bytes[0]! & 0xfe) === 0xfc
    || (bytes[0] === 0xfe && (bytes[1]! & 0xc0) === 0x80)
    || bytes[0] === 0xff
    || (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8);
}

async function withAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw signal.reason || new Error('aborted');
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason || new Error('aborted'));
    signal.addEventListener('abort', abort, { once: true });
    operation.then(
      (value) => { signal.removeEventListener('abort', abort); resolve(value); },
      (error) => { signal.removeEventListener('abort', abort); reject(error); },
    );
  });
}

async function publicAddresses(
  hostname: string,
  resolveHost: (hostname: string) => Promise<readonly string[]>,
  signal: AbortSignal,
): Promise<readonly string[]> {
  const normalized = hostname.replace(/^\[|\]$/g, '');
  let addresses: readonly string[];
  try {
    addresses = isIP(normalized) ? [normalized] : await withAbort(resolveHost(normalized), signal);
  } catch (error) {
    if (signal.aborted) throw error;
    throw new CollectionSourceIntakeError('URL_FETCH_FAILED', 'The website address could not be resolved.', 502, true);
  }
  if (!addresses.length || addresses.some(privateAddress)) {
    throw new CollectionSourceIntakeError(
      'URL_UNSAFE',
      'Website addresses must resolve only to public networks.',
      400,
      false,
    );
  }
  return addresses;
}

function nodeWebsiteRequest(
  url: URL,
  options: { signal: AbortSignal; addresses: readonly string[] },
): Promise<WebsiteResponse> {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(url, {
      method: 'GET',
      signal: options.signal,
      headers: {
        accept: 'text/html,text/plain,application/json',
        'user-agent': 'Youbot-Collection-Source/1.0',
      },
      lookup: createPinnedLookup(options.addresses) as any,
    }, (response) => {
      resolve({
        status: response.statusCode || 0,
        headers: { get: (name) => {
          const value = response.headers[name.toLowerCase()];
          return Array.isArray(value) ? value.join(', ') : value == null ? null : String(value);
        } },
        body: response as AsyncIterable<Uint8Array>,
        cancel: () => response.destroy(),
      });
    });
    req.on('error', reject);
    req.end();
  });
}

export function createPinnedLookup(addresses: readonly string[]) {
  const address = addresses[0]!;
  const family = isIP(address) as 4 | 6;
  return (_hostname: string, lookupOptions: unknown, callback: Function) => {
    if (lookupOptions && typeof lookupOptions === 'object' && (lookupOptions as { all?: boolean }).all) {
      callback(null, addresses.map((item) => ({
        address: item,
        family: isIP(item) as 4 | 6,
      })));
      return;
    }
    callback(null, address, family);
  };
}

async function readBounded(response: WebsiteResponse): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const value of response.body) {
    const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
    total += chunk.byteLength;
    if (total > COLLECTION_SOURCE_LIMITS.maxUrlBytes) {
      response.cancel();
      throw new CollectionSourceIntakeError('URL_TOO_LARGE', 'Website content exceeds 1 MB.', 413, false);
    }
    chunks.push(chunk);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function htmlText(raw: string): string {
  return raw
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|template|svg)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export async function fetchCollectionUrl(
  rawUrl: string,
  dependencies: CollectionSourceDependencies = testDependencies || {},
): Promise<UrlSource> {
  const requested = safeUrl(rawUrl);
  const resolveHost = dependencies.resolveHost || (async (hostname: string) => (
    await lookup(hostname, { all: true, verbatim: true })
  ).map((entry) => entry.address));
  const request = dependencies.request || nodeWebsiteRequest;
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error('deadline exceeded'));
  }, COLLECTION_SOURCE_LIMITS.timeoutMs);
  const externalAbort = () => controller.abort(dependencies.signal?.reason || new Error('aborted'));
  dependencies.signal?.addEventListener('abort', externalAbort, { once: true });
  if (dependencies.signal?.aborted) externalAbort();

  try {
    let current = requested;
    for (let redirect = 0; redirect <= COLLECTION_SOURCE_LIMITS.maxRedirects; redirect += 1) {
      const addresses = await publicAddresses(current.hostname, resolveHost, controller.signal);
      let response: WebsiteResponse;
      try {
        response = await withAbort(request(current, { signal: controller.signal, addresses }), controller.signal);
      } catch (error) {
        if (error instanceof CollectionSourceIntakeError) throw error;
        if (controller.signal.aborted) {
          throw new CollectionSourceIntakeError(
            timedOut ? 'URL_TIMEOUT' : 'URL_FETCH_FAILED',
            timedOut ? 'The website took too long to respond.' : 'The website request was cancelled.',
            timedOut ? 504 : 502,
            true,
          );
        }
        throw new CollectionSourceIntakeError('URL_FETCH_FAILED', 'The website could not be read. Retry shortly.', 502, true);
      }
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        response.cancel();
        if (!location || redirect === COLLECTION_SOURCE_LIMITS.maxRedirects) {
          throw new CollectionSourceIntakeError('URL_REDIRECT_INVALID', 'The website redirected too many times or to an invalid address.', 422, false);
        }
        current = safeUrl(new URL(location, current).toString());
        continue;
      }
      if (response.status < 200 || response.status >= 300) {
        response.cancel();
        throw new CollectionSourceIntakeError(
          'URL_FETCH_FAILED',
          `The website returned HTTP ${response.status}.`,
          502,
          response.status === 429 || response.status >= 500,
        );
      }
      const mediaType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() || '';
      if (!['text/html', 'text/plain', 'application/json'].includes(mediaType)) {
        response.cancel();
        throw new CollectionSourceIntakeError('URL_TYPE_UNSUPPORTED', 'Website content must be HTML, plain text, or JSON.', 415, false);
      }
      const declaredLength = Number(response.headers.get('content-length') || 0);
      if (Number.isFinite(declaredLength) && declaredLength > COLLECTION_SOURCE_LIMITS.maxUrlBytes) {
        response.cancel();
        throw new CollectionSourceIntakeError('URL_TOO_LARGE', 'Website content exceeds 1 MB.', 413, false);
      }
      const bytes = await readBounded(response);
      const raw = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
      const extracted = mediaType === 'text/html' ? htmlText(raw) : raw.trim();
      if (!extracted) {
        throw new CollectionSourceIntakeError('URL_NO_TEXT', 'The website contained no readable text.', 422, false);
      }
      const text = extracted.slice(0, COLLECTION_SOURCE_LIMITS.maxUrlTextCharacters);
      const truncated = extracted.length > text.length;
      const finalUrl = current.toString();
      return {
        kind: 'url',
        requestedUrl: requested.toString(),
        finalUrl,
        url: finalUrl,
        mediaType: mediaType as UrlSource['mediaType'],
        text,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        byteCount: bytes.byteLength,
        characterCount: text.length,
        truncated,
        coverage: {
          status: truncated ? 'partial' : 'complete',
          characterCount: text.length,
          reasons: truncated ? ['Text after the first 50,000 characters was omitted.'] : [],
        },
      };
    }
    throw new CollectionSourceIntakeError('URL_REDIRECT_INVALID', 'The website redirected too many times.', 422, false);
  } catch (error) {
    if (error instanceof CollectionSourceIntakeError) throw error;
    if (controller.signal.aborted) {
      throw new CollectionSourceIntakeError(
        timedOut ? 'URL_TIMEOUT' : 'URL_FETCH_FAILED',
        timedOut ? 'The website took too long to respond.' : 'The website request was cancelled.',
        timedOut ? 504 : 502,
        true,
      );
    }
    throw new CollectionSourceIntakeError('URL_FETCH_FAILED', 'The website could not be read. Retry shortly.', 502, true);
  } finally {
    clearTimeout(timeout);
    dependencies.signal?.removeEventListener('abort', externalAbort);
  }
}

const IMAGE_EXTENSIONS: Record<ImageSource['mimeType'], string[]> = {
  'image/png': ['.png'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/webp': ['.webp'],
};

function validImageMagic(bytes: Uint8Array, mimeType: ImageSource['mimeType']): boolean {
  if (mimeType === 'image/png') {
    return bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
      .every((value, index) => bytes[index] === value);
  }
  if (mimeType === 'image/jpeg') {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  return bytes.length >= 12
    && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF'
    && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
}

export function decodeCollectionImage(input: {
  filename?: unknown;
  mimeType?: unknown;
  base64?: unknown;
}): ImageSource {
  const filename = typeof input.filename === 'string' ? input.filename.trim() : '';
  const mimeType = typeof input.mimeType === 'string' ? input.mimeType.toLowerCase() : '';
  if (!filename || filename.length > 255 || filename.includes('/') || filename.includes('\\')) {
    throw new CollectionSourceIntakeError('IMAGE_INVALID', 'Add a valid image filename.', 400, false);
  }
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(mimeType)) {
    throw new CollectionSourceIntakeError('IMAGE_TYPE_UNSUPPORTED', 'Images must be PNG, JPEG, or WebP.', 415, false);
  }
  const typedMime = mimeType as ImageSource['mimeType'];
  if (!IMAGE_EXTENSIONS[typedMime].some((extension) => filename.toLowerCase().endsWith(extension))) {
    throw new CollectionSourceIntakeError('IMAGE_TYPE_MISMATCH', 'The image filename and media type do not match.', 415, false);
  }
  if (typeof input.base64 !== 'string' || !input.base64 || input.base64.length % 4 !== 0) {
    throw new CollectionSourceIntakeError('IMAGE_INVALID', 'The image must be base64-encoded.', 400, false);
  }
  const padding = input.base64.endsWith('==') ? 2 : input.base64.endsWith('=') ? 1 : 0;
  const decodedLength = (input.base64.length / 4) * 3 - padding;
  if (decodedLength > COLLECTION_SOURCE_LIMITS.maxImageBytes) {
    throw new CollectionSourceIntakeError('IMAGE_TOO_LARGE', 'The image exceeds 6 MB.', 413, false);
  }
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.base64)) {
    throw new CollectionSourceIntakeError('IMAGE_INVALID', 'The image must be base64-encoded.', 400, false);
  }
  const bytes = Buffer.from(input.base64, 'base64');
  if (!bytes.length || bytes.toString('base64') !== input.base64) {
    throw new CollectionSourceIntakeError('IMAGE_INVALID', 'The image must be base64-encoded.', 400, false);
  }
  if (bytes.byteLength > COLLECTION_SOURCE_LIMITS.maxImageBytes) {
    throw new CollectionSourceIntakeError('IMAGE_TOO_LARGE', 'The image exceeds 6 MB.', 413, false);
  }
  if (!validImageMagic(bytes, typedMime)) {
    throw new CollectionSourceIntakeError('IMAGE_TYPE_MISMATCH', 'The image contents do not match its media type.', 415, false);
  }
  return {
    kind: 'image',
    filename,
    mimeType: typedMime,
    bytes,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    byteCount: bytes.byteLength,
  };
}
