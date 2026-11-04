import type { FastifyInstance } from 'fastify';
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

/** Rutas del catálogo. Todas requieren sesión. */
export async function catalogRoutes(app: FastifyInstance, opts: { catalog: CatalogService }) {
  const { catalog } = opts;
  app.addHook('preHandler', async (req) => {
    requireAuth(req);
  });
  const sid = (req: { session: { id: string } | null }) => req.session?.id ?? null;
  const idParam = (p: unknown) => parse(Id, (p as { id: string }).id);

  // ---------- Biblioteca ----------
  app.get('/library', async (req) => catalog.library(parse(LibraryQuery, req.query)));
  app.get('/library/facets', async () => catalog.facets());

  // ---------- Obras, ediciones, ejemplares ----------
  app.post('/books', async (req, reply) => {
    reply.code(201);
    return catalog.createBook(parse(BookCreate, req.body), sid(req));
  });
  app.get('/works/:id', async (req) => catalog.getWork(idParam(req.params)));
  app.patch('/works/:id', async (req) =>
    catalog.patchWork(idParam(req.params), parse(WorkPatch, req.body), sid(req)),
  );
  app.patch('/editions/:id', async (req) =>
    catalog.patchEdition(idParam(req.params), parse(EditionPatch, req.body), sid(req)),
  );
  app.delete('/editions/:id', async (req) => catalog.deleteEdition(idParam(req.params), sid(req)));
  app.post('/copies', async (req, reply) => {
    reply.code(201);
    return catalog.createCopy(parse(CopyCreate, req.body), sid(req));
  });
  app.patch('/copies/:id', async (req) =>
    catalog.patchCopy(idParam(req.params), parse(CopyPatch, req.body), sid(req)),
  );

  // ---------- Ubicaciones ----------
  app.get('/locations', async () => catalog.locationTree());
  app.post('/locations', async (req, reply) => {
    reply.code(201);
    return catalog.createLocation(parse(LocationCreate, req.body), sid(req));
  });
  app.patch('/locations/:id', async (req) =>
    catalog.patchLocation(idParam(req.params), parse(LocationPatch, req.body), sid(req)),
  );
  app.delete('/locations/:id', async (req) => catalog.deleteLocation(idParam(req.params), sid(req)));
}
