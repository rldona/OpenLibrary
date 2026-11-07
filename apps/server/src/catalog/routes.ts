import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  BookCreate,
  CopyCreate,
  CopyPatch,
  EditionPatch,
  Id,
  LibraryQuery,
  LocationCreate,
  LocationPatch,
  ReadingCreate,
  ReadingPatch,
  WishCreate,
  WishPatch,
  QuoteCreate,
  QuotePatch,
  WorkPatch,
} from '@openlibrary/contracts';
import { parse } from '../errors.js';
import { requireAuth } from '../auth/routes.js';
import type { CatalogService } from './service.js';

/** Catalog routes. All of them require a session. */
export async function catalogRoutes(app: FastifyInstance, opts: { catalog: CatalogService }) {
  const { catalog } = opts;
  app.addHook('preHandler', async (req) => {
    requireAuth(req);
  });
  const sid = (req: { session: { id: string } | null }) => req.session?.id ?? null;
  const idParam = (req: FastifyRequest) => parse(Id, (req.params as { id: string }).id, req.lang);

  // ---------- Library ----------
  app.get('/library', async (req) => catalog.library(parse(LibraryQuery, req.query, req.lang)));
  app.get('/library/facets', async () => catalog.facets());

  // ---------- Works, editions, copies ----------
  app.post('/books', async (req, reply) => {
    reply.code(201);
    return catalog.createBook(parse(BookCreate, req.body, req.lang), sid(req));
  });
  app.get('/works/:id', async (req) => catalog.getWork(idParam(req)));
  // Web-only favorite mark (not a sync entity for now).
  app.post('/works/:id/favorite', async (req) => catalog.setFavorite(idParam(req), true));
  app.delete('/works/:id/favorite', async (req) => catalog.setFavorite(idParam(req), false));
  app.patch('/works/:id', async (req) =>
    catalog.patchWork(idParam(req), parse(WorkPatch, req.body, req.lang), sid(req)),
  );
  app.patch('/editions/:id', async (req) =>
    catalog.patchEdition(idParam(req), parse(EditionPatch, req.body, req.lang), sid(req)),
  );
  app.delete('/editions/:id', async (req) => catalog.deleteEdition(idParam(req), sid(req)));
  app.post('/copies', async (req, reply) => {
    reply.code(201);
    return catalog.createCopy(parse(CopyCreate, req.body, req.lang), sid(req));
  });
  app.patch('/copies/:id', async (req) =>
    catalog.patchCopy(idParam(req), parse(CopyPatch, req.body, req.lang), sid(req)),
  );

  // ---------- Reading ----------
  app.post('/reading-sessions', async (req, reply) => {
    reply.code(201);
    return catalog.createReading(parse(ReadingCreate, req.body, req.lang), sid(req));
  });
  app.patch('/reading-sessions/:id', async (req) =>
    catalog.patchReading(idParam(req), parse(ReadingPatch, req.body, req.lang), sid(req)),
  );

  // ---------- Quotes ----------
  app.post('/quotes', async (req, reply) => {
    reply.code(201);
    return catalog.createQuote(parse(QuoteCreate, req.body, req.lang), sid(req));
  });
  app.patch('/quotes/:id', async (req) =>
    catalog.patchQuote(idParam(req), parse(QuotePatch, req.body, req.lang), sid(req)),
  );
  app.delete('/quotes/:id', async (req) => catalog.deleteQuote(idParam(req), sid(req)));

  // ---------- Wishlist ----------
  app.get('/wishlist', async () => catalog.wishlist());
  app.post('/wishlist', async (req, reply) => {
    reply.code(201);
    return catalog.createWish(parse(WishCreate, req.body, req.lang), sid(req));
  });
  app.patch('/wishlist/:id', async (req) =>
    catalog.patchWish(idParam(req), parse(WishPatch, req.body, req.lang), sid(req)),
  );
  app.delete('/wishlist/:id', async (req, reply) => {
    catalog.deleteWish(idParam(req), sid(req));
    return reply.code(204).send();
  });

  // ---------- Locations ----------
  app.get('/locations', async () => catalog.locationTree());
  app.post('/locations', async (req, reply) => {
    reply.code(201);
    return catalog.createLocation(parse(LocationCreate, req.body, req.lang), sid(req));
  });
  app.patch('/locations/:id', async (req) =>
    catalog.patchLocation(idParam(req), parse(LocationPatch, req.body, req.lang), sid(req)),
  );
  app.delete('/locations/:id', async (req) => catalog.deleteLocation(idParam(req), sid(req)));
}
