import express from 'express';
import { asyncHandler } from '#system/http/middleware/index.mjs';

const STATUS = { ok: 200, invalid: 400, 'not-found': 404, unavailable: 503 };
const ISBN13 = /^\d{13}$/;

/**
 * The one URL every surface renders a cover from.
 *
 * A provider URL is a promise that art was there once; this is the household's
 * own copy. Emitting it instead of the provider's own URL is what lets the
 * cover CASCADE happen out of sight: the shelf asks for one address, and
 * whether the bytes behind it came from OpenLibrary, Amazon, Google or an
 * image search is the resolver's business.
 */
export function bookCoverPath(isbn13) {
  return ISBN13.test(String(isbn13 ?? '')) ? `/api/v1/books/${isbn13}/cover` : null;
}

/** The lookup a child's shelf uses. No auth — book facts are not private. */
export function createBooksRouter({ resolveBook, resolveBookCover = null, logger = console } = {}) {
  if (!resolveBook) throw new Error('createBooksRouter requires resolveBook');
  const router = express.Router();

  router.get('/resolve', asyncHandler(async (req, res) => {
    const id = typeof req.query.id === 'string' ? req.query.id : '';
    if (!id.trim()) return res.status(400).json({ status: 'invalid', reason: 'empty' });
    const result = await resolveBook.execute(id, { refresh: req.query.refresh === '1' });

    if (result.status === 'ok' && result.book?.isbn13 && resolveBookCover) {
      // The confirmation card renders the moment this responds, so the ladder
      // starts NOW rather than when the image element asks. Deliberately not
      // awaited: a book resolves with or without art (`ResolveBook`'s "a
      // partial record is a success"), and a child must never wait on a cover.
      resolveBookCover.execute(result.book.isbn13, { record: result.book })
        .catch((error) => logger.warn?.('books.cover.warm-failed', { isbn13: result.book.isbn13, error: error.message }));
      return res.status(200).json({ ...result, book: { ...result.book, coverUrl: bookCoverPath(result.book.isbn13) } });
    }
    return res.status(STATUS[result.status] ?? 400).json(result);
  }));

  if (resolveBookCover) {
    router.get('/:isbn13/cover', asyncHandler(async (req, res) => {
      const { isbn13 } = req.params;
      if (!ISBN13.test(String(isbn13 ?? ''))) return res.status(400).json({ status: 'invalid', reason: 'isbn13' });

      const art = await resolveBookCover.cover(isbn13, { refresh: req.query.refresh === '1' });
      if (!art) return res.status(404).json({ status: 'not-found', reason: 'no-cover-anywhere' });

      const body = art.bytes ?? art.svg;
      // Size plus the moment the ladder stored it. Both change together and
      // only when the art is re-saved, which is exactly what a validator has to
      // track — and it costs no hash over bytes we are about to send anyway.
      const etag = `"${body.length}-${String(art.checkedAt ?? '0').replace(/[^\dTZ:.-]/g, '')}"`;
      res.set({
        'Content-Type': art.contentType,
        // A drawn cover is a placeholder that should give way the moment real
        // art turns up, so it is cached for a day rather than a week.
        'Cache-Control': art.generated ? 'public, max-age=86400' : 'public, max-age=604800',
        ETag: etag,
        'X-Cover-Source': art.source ?? 'unknown',
      });
      if (req.headers['if-none-match'] === etag) return res.status(304).end();
      return res.status(200).send(body);
    }));
  }

  return router;
}

export default createBooksRouter;
