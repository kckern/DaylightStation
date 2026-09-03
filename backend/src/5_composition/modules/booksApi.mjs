// backend/src/5_composition/modules/booksApi.mjs
// Composition wiring for the Books domain: metadata gateways, the household
// book repository, `ResolveBook`, and the `/books` API router.

import { OpenLibraryAdapter } from '#adapters/books/OpenLibraryAdapter.mjs';
import { GoogleBooksAdapter } from '#adapters/books/GoogleBooksAdapter.mjs';
import { YamlBookRepository } from '#adapters/persistence/yaml/YamlBookRepository.mjs';
import { ResolveBook } from '#apps/books/ResolveBook.mjs';
import { createBooksRouter } from '#api/v1/routers/books.mjs';

/**
 * The Books domain, composed once and handed to whoever consumes it (School's
 * shelf is the first). Metadata precedence lives in the domain; this only
 * decides WHICH gateways exist: OpenLibrary always, Google Books when the
 * household holds a Books-restricted key.
 *
 * The key is `GOOGLE_BOOKS_API_KEY` in `household/auth/google.yml` — a second,
 * Books-only key, because Google refuses to add Books API to the CSE key's
 * restriction list. Absent, Google is still wired keyless: that path is
 * usually 429 (shared anonymous quota), and ResolveBook treats a throw as
 * "this provider could not help", never as "no such book".
 *
 * @param {object} deps
 * @param {object} deps.configService
 * @param {object} [deps.logger]
 * @returns {{ resolveBook: ResolveBook, bookRepository: YamlBookRepository, gateways: object[] }}
 */
export function createBooksModule({ configService, logger = console } = {}) {
  if (!configService) throw new Error('createBooksModule requires configService');
  const log = logger.child ? logger.child({ module: 'books' }) : logger;
  const googleAuth = configService.getHouseholdAuth?.('google') ?? null;
  const apiKey = googleAuth?.GOOGLE_BOOKS_API_KEY ?? null;
  const gateways = [
    new OpenLibraryAdapter({ logger: log }),
    new GoogleBooksAdapter({ apiKey, logger: log }),
  ];
  const bookRepository = new YamlBookRepository({ configService, logger: log });
  const resolveBook = new ResolveBook({ gateways, repository: bookRepository, logger: log });
  log.info?.('books.module.composed', { gateways: gateways.map((g) => g.id), googleKeyed: Boolean(apiKey) });
  return { resolveBook, bookRepository, gateways };
}

/**
 * The household-wide `/api/v1/books` router (resolve-by-title/ISBN). Not the
 * School shelf — that mounts under `/school/books` with its own grants.
 */
export function createBooksApiRouter({ resolveBook } = {}) {
  return createBooksRouter({ resolveBook });
}
