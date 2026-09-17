import { afterEach, describe, expect, it, vi } from 'vitest';

const parserState = vi.hoisted(() => ({
  constructorDelayMs: 0,
  destroyCalls: 0,
  getTextCalls: 0,
  resolveText: false,
}));

vi.mock('pdf-parse', () => ({
  PDFParse: class {
    constructor() {
      if (parserState.constructorDelayMs) vi.setSystemTime(Date.now() + parserState.constructorDelayMs);
    }
    getText(): Promise<never> | Promise<{ total: number; pages: Array<{ num: number; text: string }> }> {
      parserState.getTextCalls += 1;
      if (parserState.resolveText) return Promise.resolve({ total: 1, pages: [{ num: 1, text: 'ready' }] });
      return new Promise(() => undefined);
    }

    destroy(): Promise<void> {
      parserState.destroyCalls += 1;
      return new Promise(() => undefined);
    }
  },
}));

import { COLLECTION_PDF_LIMITS, parseCollectionPdf } from '../pdf-intake.js';

describe('collection PDF processing deadline', () => {
  afterEach(() => {
    vi.useRealTimers();
    parserState.constructorDelayMs = 0;
    parserState.destroyCalls = 0;
    parserState.getTextCalls = 0;
    parserState.resolveText = false;
  });

  it('returns a recoverable timeout error without waiting for stalled parser cleanup', async () => {
    vi.useFakeTimers();
    const result = parseCollectionPdf(Buffer.from('%PDF-1.4\n%%EOF', 'latin1'));
    const rejection = expect(result).rejects.toMatchObject({
      code: 'PDF_TIMEOUT',
      status: 408,
      message: expect.stringContaining('split it into parts'),
      details: { maxProcessingMs: COLLECTION_PDF_LIMITS.maxProcessingMs },
    });

    await vi.advanceTimersByTimeAsync(COLLECTION_PDF_LIMITS.maxProcessingMs);

    await rejection;
    expect(parserState.getTextCalls).toBe(1);
    expect(parserState.destroyCalls).toBe(1);
  });

  it('counts parser setup time inside the application deadline', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-14T10:00:00.000Z'));
    parserState.constructorDelayMs = COLLECTION_PDF_LIMITS.maxProcessingMs + 1;
    parserState.resolveText = true;
    const result = parseCollectionPdf(Buffer.from('%PDF-1.4\n%%EOF', 'latin1'));
    await expect(result).rejects.toMatchObject({ code: 'PDF_TIMEOUT', status: 408 });
    expect(parserState.getTextCalls).toBe(1);
    expect(parserState.destroyCalls).toBe(1);
  });

  it('does not let stalled cleanup block a successful parse beyond the deadline', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-14T10:00:00.000Z'));
    parserState.resolveText = true;
    const result = parseCollectionPdf(Buffer.from('%PDF-1.4\n%%EOF', 'latin1'));
    const rejection = expect(result).rejects.toMatchObject({ code: 'PDF_TIMEOUT', status: 408 });
    await vi.advanceTimersByTimeAsync(COLLECTION_PDF_LIMITS.maxProcessingMs);
    await rejection;
    expect(parserState.getTextCalls).toBe(1);
    expect(parserState.destroyCalls).toBe(1);
  });
});
