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
