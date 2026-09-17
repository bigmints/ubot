import { describe, expect, it } from 'vitest';
import { COLLECTION_PDF_LIMITS, decodePdfPayload, parseCollectionPdf, PdfIntakeError } from '../pdf-intake.js';
import { textPdf } from './pdf-fixture.js';

describe('collection PDF intake', () => {
  it('extracts page-aware segments and reports partial coverage', async () => {
    const parsed = await parseCollectionPdf(textPdf(['Villa Alpha in Dubai', null, 'Villa Beta in Sharjah']));
    expect(parsed.segments).toEqual([
      expect.objectContaining({ inputId: 'page-0001', locator: { page: 1 }, text: expect.stringContaining('Villa Alpha') }),
      expect.objectContaining({ inputId: 'page-0003', locator: { page: 3 }, text: expect.stringContaining('Villa Beta') }),
    ]);
    expect(parsed.coverage).toMatchObject({
      status: 'partial',
      totalPages: 3,
      extractedPages: 2,
      unresolvedPages: [2],
      extractedCount: 2,
      unresolvedCount: 1,
    });
    expect(parsed.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('processes a dense multi-domain catalogue beyond the legacy 100,000-character attachment cutoff', async () => {
    const pageCount = 36;
    const rowsPerPage = 48;
    const pages = Array.from({ length: pageCount }, (_, pageIndex) =>
      Array.from({ length: rowsPerPage }, (_, rowIndex) => {
        const item = pageIndex * rowsPerPage + rowIndex + 1;
        if (pageIndex % 3 === 0) {
          return `Property D-${String(item).padStart(4, '0')}: Tower ${pageIndex + 1}; unit ${rowIndex + 1}; 2 bedrooms; 1,245 sq ft; AED ${1_200_000 + item * 1_000} sale; availability unknown; reference DENSE-P-${item}.`;
        }
        if (pageIndex % 3 === 1) {
          return `Class D-${String(item).padStart(4, '0')}: pottery session ${rowIndex + 1}; 2026-10-15 18:00 Asia/Dubai; AED 180 per session; capacity unknown; reference DENSE-C-${item}.`;
        }
        return `Service D-${String(item).padStart(4, '0')}: studio hire; 90 minutes; AED 250 per booking; equipment included; availability requires confirmation; reference DENSE-S-${item}.`;
      }),
    );

    const parsed = await parseCollectionPdf(textPdf(pages));
    const extractedText = parsed.segments.map((segment) => segment.text).join('\n');

    expect(extractedText.length).toBeGreaterThan(100_000);
    expect(parsed.coverage.characterCount).toBeGreaterThan(100_000);
    expect(parsed.coverage).toMatchObject({
      status: 'complete',
      totalPages: pageCount,
      extractedPages: pageCount,
      unresolvedPages: [],
      extractedCount: pageCount,
      unresolvedCount: 0,
      characterCount: extractedText.length - (pageCount - 1),
    });
    expect(parsed.segments[0]).toMatchObject({ inputId: 'page-0001', locator: { page: 1 } });
    expect(parsed.segments.at(-1)).toMatchObject({ inputId: 'page-0036', locator: { page: 36 } });
    expect(extractedText).toContain('reference DENSE-P-1.');
    expect(extractedText).toContain('reference DENSE-C-49.');
    expect(extractedText).toContain('reference DENSE-S-97.');
    expect(extractedText).toContain(`reference DENSE-S-${pageCount * rowsPerPage}.`);
  }, 20_000);

  it('rejects scanned-only, encrypted, malformed, empty and invalid base64 inputs explicitly', async () => {
    await expect(parseCollectionPdf(textPdf([null]))).rejects.toMatchObject({ code: 'PDF_SCANNED_ONLY', status: 422 });
    await expect(parseCollectionPdf(Buffer.from('%PDF-1.4\n/Encrypt'))).rejects.toMatchObject({ code: 'PDF_ENCRYPTED' });
    await expect(parseCollectionPdf(Buffer.from('not a pdf'))).rejects.toMatchObject({ code: 'PDF_MALFORMED' });
    await expect(parseCollectionPdf(Buffer.alloc(0))).rejects.toMatchObject({ code: 'PDF_EMPTY' });
    await expect(parseCollectionPdf(Buffer.alloc(COLLECTION_PDF_LIMITS.maxBytes + 1)))
      .rejects.toMatchObject({ code: 'LIMIT_EXCEEDED', status: 413 });
    expect(() => decodePdfPayload('%%%')).toThrowError(PdfIntakeError);
    expect(() => decodePdfPayload('%%%')).toThrowError(expect.objectContaining({ code: 'PDF_MALFORMED' }));
  });
});
