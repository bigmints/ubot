import { createHash } from 'node:crypto';

export const COLLECTION_PDF_LIMITS = Object.freeze({
  maxBytes: 10 * 1024 * 1024,
  maxPages: 250,
  maxCharacters: 1_000_000,
  maxSegments: 2_000,
  maxProcessingMs: 30_000,
});

export type PdfSegment = {
  inputId: string;
  text: string;
  locator: { page: number };
};

export type PdfCoverage = {
  status: 'complete' | 'partial';
  totalPages: number;
  extractedPages: number;
  unresolvedPages: number[];
  extractedCount: number;
  unresolvedCount: number;
  characterCount: number;
};

export type ParsedCollectionPdf = {
  sha256: string;
  segments: PdfSegment[];
  coverage: PdfCoverage;
};

export class PdfIntakeError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'PdfIntakeError';
  }
}

function normalizePageText(value: string): string {
  return value.replace(/\u0000/g, '').replace(/[ \t]+\n/g, '\n').trim();
}

function parserFailure(error: unknown): PdfIntakeError {
  const message = error instanceof Error ? error.message : String(error);
  if (/password|encrypted|encryption|cipher/i.test(message)) {
    return new PdfIntakeError('PDF_ENCRYPTED', 'Encrypted or password-protected PDFs are not supported.', 400);
  }
  return new PdfIntakeError('PDF_MALFORMED', 'The PDF could not be read.', 400);
}

function processingTimeout(): PdfIntakeError {
  return new PdfIntakeError(
    'PDF_TIMEOUT',
    'The PDF took longer than 30 seconds to process. Try a smaller PDF or split it into parts.',
    408,
    { maxProcessingMs: COLLECTION_PDF_LIMITS.maxProcessingMs },
  );
}

async function parseBeforeDeadline<T>(operation: () => Promise<T>, startedAt: number): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  const remainingMs = Math.max(0, COLLECTION_PDF_LIMITS.maxProcessingMs - (Date.now() - startedAt));
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => reject(processingTimeout()), remainingMs);
  });
  try {
    const result = await Promise.race([Promise.resolve().then(operation), deadline]);
    if (Date.now() - startedAt > COLLECTION_PDF_LIMITS.maxProcessingMs) throw processingTimeout();
    return result;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export async function parseCollectionPdf(buffer: Buffer): Promise<ParsedCollectionPdf> {
  if (buffer.length === 0) throw new PdfIntakeError('PDF_EMPTY', 'The PDF is empty.', 400);
  if (buffer.length > COLLECTION_PDF_LIMITS.maxBytes) {
    throw new PdfIntakeError('LIMIT_EXCEEDED', 'The PDF is larger than 10 MiB.', 413, {
      maxBytes: COLLECTION_PDF_LIMITS.maxBytes,
      actualBytes: buffer.length,
    });
  }
  if (!buffer.subarray(0, 1024).includes(Buffer.from('%PDF-'))) {
    throw new PdfIntakeError('PDF_MALFORMED', 'The uploaded data is not a PDF.', 400);
  }
  if (/\/Encrypt\b/.test(buffer.toString('latin1'))) {
    throw new PdfIntakeError('PDF_ENCRYPTED', 'Encrypted or password-protected PDFs are not supported.', 400);
  }

  const processingStartedAt = Date.now();
  return parseBeforeDeadline(async () => {
    let parser: { getText(): Promise<{ total: number; pages: Array<{ num: number; text: string }> }>; destroy(): Promise<void> } | undefined;
    let processingTimedOut = false;
    try {
      const { PDFParse } = await import('pdf-parse');
      parser = new PDFParse({ data: new Uint8Array(buffer) });
      const result = await parseBeforeDeadline(() => parser!.getText(), processingStartedAt);
    if (!Number.isSafeInteger(result.total) || result.total < 1) {
      throw new PdfIntakeError('PDF_EMPTY', 'The PDF has no pages.', 400);
    }
    if (result.total > COLLECTION_PDF_LIMITS.maxPages) {
      throw new PdfIntakeError('LIMIT_EXCEEDED', 'The PDF has more than 250 pages.', 413, {
        maxPages: COLLECTION_PDF_LIMITS.maxPages,
        actualPages: result.total,
      });
    }

    const pages = new Map(result.pages.map((page) => [page.num, normalizePageText(page.text || '')]));
    const segments: PdfSegment[] = [];
    const unresolvedPages: number[] = [];
    let characterCount = 0;
    for (let page = 1; page <= result.total; page += 1) {
      const text = pages.get(page) || '';
      if (!text) {
        unresolvedPages.push(page);
        continue;
      }
      characterCount += text.length;
      if (characterCount > COLLECTION_PDF_LIMITS.maxCharacters) {
        throw new PdfIntakeError('LIMIT_EXCEEDED', 'The extracted PDF text exceeds 1,000,000 characters.', 413, {
          maxCharacters: COLLECTION_PDF_LIMITS.maxCharacters,
          actualCharacters: characterCount,
        });
      }
      segments.push({ inputId: `page-${String(page).padStart(4, '0')}`, text, locator: { page } });
    }
    if (segments.length === 0) {
      throw new PdfIntakeError(
        'PDF_SCANNED_ONLY',
        'The PDF contains no readable text. Run OCR before importing it.',
        422,
        { totalPages: result.total },
      );
    }
    if (segments.length > COLLECTION_PDF_LIMITS.maxSegments) {
      throw new PdfIntakeError('LIMIT_EXCEEDED', 'The PDF produced too many text segments.', 413);
    }
      return {
        sha256: createHash('sha256').update(buffer).digest('hex'),
        segments,
        coverage: {
          status: unresolvedPages.length > 0 ? 'partial' : 'complete',
          totalPages: result.total,
          extractedPages: segments.length,
          unresolvedPages,
          extractedCount: segments.length,
          unresolvedCount: unresolvedPages.length,
          characterCount,
        },
      };
    } catch (error) {
      if (error instanceof PdfIntakeError) {
        processingTimedOut = error.code === 'PDF_TIMEOUT';
        throw error;
      }
      throw parserFailure(error);
    } finally {
      if (parser) {
        const cleanup = Promise.resolve().then(() => parser!.destroy()).catch(() => undefined);
        if (processingTimedOut) void cleanup;
        else await cleanup;
      }
    }
  }, processingStartedAt);
}

export function decodePdfPayload(value: unknown): Buffer {
  if (typeof value !== 'string' || value.length === 0) {
    throw new PdfIntakeError('INVALID_ARGUMENT', 'Add a base64-encoded PDF.', 400);
  }
  const normalized = value.replace(/^data:application\/pdf;base64,/i, '');
  if (normalized.length > Math.ceil(COLLECTION_PDF_LIMITS.maxBytes / 3) * 4 + 4) {
    throw new PdfIntakeError('LIMIT_EXCEEDED', 'The PDF is larger than 10 MiB.', 413);
  }
  if (normalized.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) {
    throw new PdfIntakeError('PDF_MALFORMED', 'The PDF payload is not valid base64.', 400);
  }
  const buffer = Buffer.from(normalized, 'base64');
  if (buffer.toString('base64').replace(/=+$/, '') !== normalized.replace(/=+$/, '')) {
    throw new PdfIntakeError('PDF_MALFORMED', 'The PDF payload is not valid base64.', 400);
  }
  return buffer;
}
