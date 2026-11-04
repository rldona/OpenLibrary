# OpenLibrary — Análisis funcional y diseño técnico (v0.1)

> Biblioteca personal de libros físicos. Un único propietario. Servidor en un PC Ubuntu doméstico que **no** está siempre encendido. Cliente web (catálogo y gestión desde el ordenador) y app Android nativa (lector de códigos de barras, cámara para portadas y consulta offline).

Documento vivo. Decisiones confirmadas (4 nov 2026): web con gestión completa, acceso desde fuera de casa, colección desde cero y lectura registrada por ejemplar. El resto son recomendaciones revisables.

---

## 1. Análisis de requisitos: ambigüedades, contradicciones y dependencias

| # | Tema | Problema detectado | Propuesta |
|---|------|--------------------|-----------|
| A1 | **Rol de la web** | En la conversación dices que la web es "visualización del catálogo", pero la definición (§11) le pide alta manual, edición, ejemplares, ubicaciones, importación/exportación… | La web es el **puesto de gestión completo** (todo salvo escanear/fotografiar). Android es el **puesto de captura y consulta**. Las dos editan; la web solo online. **Decidido:** gestión completa. |
| A2 | **Estado de lectura: ¿ejemplar u obra?** | §8 dice "cada ejemplar podrá tener un estado de lectura", pero la lectura es una experiencia sobre la obra (si tienes dos ejemplares de *1984* no lo "lees" dos veces), y §15 pide distinguir métricas por obra y por ejemplar. | Se registra la lectura como **`Lectura` (sesión) vinculada a un ejemplar** (lo que tenías en la mano), y el estado de la **obra se deriva** (leído si alguna sesión de cualquier ejemplar/edición está terminada). La UI muestra un único estado y un botón "Releer" que abre otra sesión. **Decidido** (revisable). |
| A3 | **Metadatos con el PC apagado** | Si la búsqueda de ISBN pasa por el servidor, escanear con el PC apagado nunca recupera datos aunque el móvil tenga Internet. | Android consulta **directamente** a los proveedores (Open Library, Google Books) cuando tiene Internet; la web lo hace a través del servidor (proxy). Mismo módulo de normalización en ambos. |
| A4 | **Acceso desde fuera de casa** | No se especifica si Android sincroniza solo en la Wi-Fi de casa o también desde fuera. Exponer el PC a Internet contradice §16 (privacidad). | **Tailscale** (VPN mesh, sin abrir puertos): funciona en casa y fuera, sin exposición pública. **Decidido:** acceso desde fuera. La arquitectura queda preparada para exponerse a Internet sin cambios de código (§9.1). |
| A5 | **"Servidor como referencia central" vs. ediciones offline** | Si el servidor manda y Android edita offline, hay que definir qué pasa cuando ambos tocan lo mismo. | Fusión **por campo** con versión base; conflicto solo si el *mismo campo* cambió en los dos lados → se presenta al usuario (§6). |
| A6 | **Libros provisionales** | Alta sin conexión: ¿se completa sola después? | Se marca `metadata_status = provisional`. Al recuperar Internet se **propone** (no se aplica) la búsqueda; el usuario revisa. Nunca se sobrescriben datos editados a mano. |
| A7 | **ISBN duplicado entre obras** | Algunas editoriales reutilizan ISBN o un ISBN cubre una obra en varios tomos. | ISBN es índice **no único** a nivel de sistema; la app advierte de coincidencia y deja elegir "es la misma edición / es otra". |
| A8 | **Portada: ¿de la edición o del ejemplar?** | Tú quieres fotografiar portadas. Una foto de *tu* ejemplar (con desgaste, dedicatoria) es distinta de la portada "oficial". | La portada pertenece a la **edición**. Una foto puede usarse como portada de la edición o guardarse como **foto del ejemplar** (MVP: solo portada de edición; fotos de ejemplar → evolución). |
| A9 | **Importación** | No se dice de qué formato viene "una colección existente". | **Decidido:** se parte de cero. MVP: importar solo el formato propio (CSV y JSON), útil para restaurar y migrar. Goodreads y otros formatos quedan como evolución. |
| A10 | **Seguridad del móvil offline** | Datos privados en el teléfono: ¿bloqueo de app? | Base local cifrada (SQLCipher) + bloqueo opcional con biometría. Token de dispositivo revocable desde la web. |
| A11 | **Serie / colección / tomos** | No aparecen pero son habituales (Dune, El Señor de los Anillos, enciclopedias). | Campo `series` + `series_index` en la obra; volúmenes múltiples como campo `volumes` en la edición. Sin modelo propio en el MVP. |
| A12 | **Moneda y precio** | Precio de compra sin moneda. | `price_amount` (decimal en céntimos) + `price_currency` (EUR por defecto). |
| A13 | **"Otros identificadores"** | Abierto. | Tabla genérica `edition_identifier (scheme, value)`: OLID, Google Books ID, Depósito Legal, BNE, OCLC… |

**Dependencias no resueltas**: disponibilidad/calidad de metadatos para ediciones españolas antiguas (Open Library y Google Books tienen huecos importantes; ver riesgos R1), y que el PC Ubuntu tenga disco con espacio y algún destino externo para copias.

---

## 2. Casos de uso y flujos principales

### Actores
- **Propietario** (único usuario), desde web o Android.
- **Proveedores externos** de metadatos (sistema).
- **Servidor** (sistema): referencia de datos, sincronización, copias.

### Casos de uso (MVP)

| ID | Caso de uso | Web | Android | Offline (Android) |
|----|-------------|:---:|:-------:|:-----------------:|
| CU01 | Escanear ISBN y dar de alta | — | ✔ | ✔ (provisional) |
| CU02 | Alta manual (con/sin ISBN) | ✔ | ✔ | ✔ |
| CU03 | Revisar/corregir metadatos propuestos | ✔ | ✔ | ✔ (sin búsqueda remota) |
| CU04 | Fotografiar portada | — | ✔ | ✔ (se sube luego) |
| CU05 | Añadir ejemplar a edición existente | ✔ | ✔ | ✔ |
| CU06 | Mover / retirar ejemplar | ✔ | ✔ | ✔ |
| CU07 | Gestionar ubicaciones (árbol) | ✔ | ✔ (consulta + alta simple) | consulta |
| CU08 | Buscar, filtrar, ordenar | ✔ | ✔ | ✔ |
| CU09 | Cambiar estado de lectura, valorar, notas, citas | ✔ | ✔ | ✔ |
| CU10 | Lista de deseos y "lo he comprado" | ✔ | ✔ | ✔ |
| CU11 | Estadísticas | ✔ | ✔ | ✔ (sobre datos locales) |
| CU12 | Importar colección | ✔ | — | — |
| CU13 | Exportar CSV / JSON completo | ✔ | (compartir export) | — |
| CU14 | Copias de seguridad y restauración | ✔ (lanzar/ver) + CLI | — | — |
| CU15 | Sincronizar y resolver conflictos | (online) | ✔ | cola persistente |
| CU16 | Gestionar credenciales y dispositivos | ✔ | login/logout | — |

### Flujo clave CU01 — Escaneo
```
Añadir → Cámara (CameraX + ML Kit, on-device)
  → Código leído → normalizar → ¿EAN-13 978/979 o ISBN-10 válido?
      no  → aviso "No es un ISBN (p. ej. ISSN 977…)" y seguir escaneando
      sí  → ¿existe edición con ese ISBN en la BD local?
              sí → "Ya tienes esta edición (N ejemplares en …)" → [Añadir otro ejemplar] [Ver ficha]
              no → ¿está en la lista de deseos? → aviso "se marcará como adquirido"
                 → ¿hay Internet?
                     no → formulario con ISBN, marcado PROVISIONAL
                     sí → consultar proveedores (timeout 6 s, en paralelo)
                            encontrado → formulario prerrellenado (fuente indicada)
                            vacío      → "Sin resultados", formulario vacío con ISBN
  → Revisar/corregir + datos del ejemplar (ubicación, conservación, lectura)
  → Guardar (local, transacción) → cola de sincronización
```

### Flujo CU10 — Deseo → colección
Deseo (texto libre o vinculado a obra/edición) → "Lo he comprado" → abre el alta prerrellenada (reutiliza obra/edición si existe) → al guardar, el deseo queda `acquired` con referencia al ejemplar creado (no se borra: historial).

---

## 3. Modelo de dominio

```
Work (obra)                 1 ── * Edition (edición)            1 ── * Copy (ejemplar)
 id, title, original_title       id, work_id, title?, subtitle        id, edition_id, code (EJ-0001)
 original_language               publisher, published_year            location_id?, condition
 description, series,            language, pages, format, volumes     acquired_on, price_amount,
 series_index                    isbn13?, isbn10?, cover_asset_id?    price_currency, notes,
 *contributors (Person+rol)      metadata_status, metadata_source     status (active|retired),
 *subjects (géneros)             *identifiers (scheme,value)          retired_reason, retired_on

Location (árbol)             Copy * ── 0..1 Location
 id, parent_id?, name, kind (casa|habitación|mueble|balda|caja|otro), sort_order

ReadingSession (lectura)     Copy 1 ── * ReadingSession
 id, copy_id, status (pending|reading|read|abandoned), started_on?, finished_on?,
 rating (1–5, medios puntos), notes

Quote (cita)                 id, work_id, copy_id?, text, page?, note
WishlistItem                 id, work_id?, edition_id?, free_title?, free_authors?, isbn13?,
                             priority, notes, status (open|acquired|discarded), acquired_copy_id?
Person                       id, name, sort_name           WorkContributor(work_id, person_id, role, position)
Subject                      id, name                      WorkSubject(work_id, subject_id)
Asset                        id = sha256, mime, width, height, bytes, origin (provider|photo|import)
```

> **Simplificación aplicada en F1:** autores y géneros se guardan como listas JSON en la obra (`works.authors`, `works.subjects`) en lugar de tablas `Person`/`Subject`. Cada lista es un campo atómico para la fusión por campo de la sincronización y basta para búsqueda, filtros y estadísticas. Si más adelante hace falta (fichas de autor, traductores), se normaliza sin cambiar la API.

**Por qué así**
- *Obra ↔ Edición ↔ Ejemplar* sigue FRBR simplificado (Obra/Manifestación/Ítem); se omite "Expresión" (traducción) para no complicar: la traducción es un atributo de la edición (`language`, traductor como contributor con rol `translator` a nivel de edición — evolución).
- La lectura cuelga del **ejemplar** (A2); la obra y la edición derivan su estado.
- `Asset` direccionado por contenido (hash) → subidas idempotentes, deduplicación natural y copias de seguridad sencillas.
- Todas las entidades sincronizables llevan: `id` UUIDv7 generado en el cliente, `version` (entero, lo incrementa el servidor), `updated_at`, `deleted_at` (lápida).

---

## 4. Reglas de negocio y estados

**Catálogo**
- RN01. Solo `Work.title` es obligatorio. Una edición puede no tener ISBN.
- RN02. ISBN se normaliza: se eliminan guiones/espacios, ISBN-10 → ISBN-13 (y viceversa si prefijo 978). Se valida el dígito de control. 979-xxx no tiene ISBN-10.
- RN03. Prefijo 977 = ISSN, 979-0 = ISMN (partituras): se rechazan con mensaje claro. EAN-5 de precio adicional se ignora.
- RN04. ISBN duplicado → no se crea edición nueva sin confirmación explícita.
- RN05. Los datos externos son **propuestas**: nunca se aplican sin revisión; un campo editado manualmente queda marcado como `manual` y una re-búsqueda no lo sobrescribe.
- RN06. Sin portada → portada generada (título/autor sobre fondo neutro). Provisional → distintivo visual.

**Ejemplares y ubicaciones**
- RN07. Un ejemplar pertenece a exactamente una edición; puede no tener ubicación ("Sin ubicación" es un filtro).
- RN08. Retirar ≠ borrar: `status = retired` + motivo (vendido, regalado, perdido, deteriorado). Los retirados no cuentan en la colección pero conservan su historial de lectura. Borrado físico solo desde "papelera" en la web.
- RN09. Una ubicación no puede ser su propio ancestro (validado en servidor). Borrar una ubicación con contenido exige mover antes sus ejemplares/hijos (o moverlos al padre).
- RN10. Código humano del ejemplar `EJ-0001` asignado por el servidor al sincronizar (en offline se muestra un código temporal). Permite etiquetar físicamente en el futuro.

**Lectura**
```
          iniciar             terminar
 pending ─────────▶ reading ─────────▶ read
    ▲                 │ abandonar         │ releer (nueva sesión)
    └──── reset ──────┴──▶ abandoned      └──────▶ reading
```
- RN11. Pasar a `reading` fija `started_on` = hoy si está vacío; a `read`, `finished_on` = hoy. Fechas editables.
- RN12. Valoración y notas por sesión; la ficha muestra la última.
- RN13. Estado de obra: `reading` si alguna sesión activa; `read` si alguna terminada; si no `pending`.

**Lista de deseos**
- RN14. Un deseo nunca cuenta como colección. Al adquirir: se crea ejemplar (y edición/obra si no existían) y el deseo pasa a `acquired`.
- RN15. Si se escanea un ISBN que está en deseos, se avisa y se enlaza.

---

## 5. Arquitectura técnica y tecnologías

```
┌──────────────── Android (Kotlin) ────────────────┐        ┌────────────── PC Ubuntu ──────────────┐
│ Compose UI ─ ViewModels ─ Repositorios            │        │ tailscale serve (TLS) ─ API (Fastify)  │
│ Room + FTS4 (SQLCipher)   Outbox de operaciones    │◀─HTTPS─▶│   ├ SQLite (WAL) + FTS5              │
│ CameraX + ML Kit Barcode  WorkManager (sync)       │ Tailnet │   ├ /data/assets (portadas por hash) │
│ Coil (caché portadas)     Cliente proveedores ISBN │        │   ├ Proveedores ISBN (proxy web)       │
└───────────────────────────────────────────────────┘        │   └ Web estática (React) servida aquí  │
            Navegador (React + Vite + TanStack Query) ───────▶│ systemd timers: backup nocturno         │
                                                             └────────────────────────────────────────┘
```

### Decisiones (alternativas evaluadas)

| Área | Recomendación | Alternativas consideradas | Motivo |
|------|---------------|---------------------------|--------|
| App móvil | **Kotlin + Jetpack Compose** nativo | Flutter, React Native, PWA | Pediste nativa. Acceso directo a CameraX/ML Kit, WorkManager para sync fiable en segundo plano, Room maduro para offline. PWA no garantiza cámara+almacenamiento persistente de forma fiable. |
| Escáner | **ML Kit Barcode Scanning (modelo empaquetado)** | ZXing, servicio en la nube | Funciona 100 % offline, rápido, sin dependencias de Google Play si se usa la variante *bundled*. |
| BD móvil | **Room (SQLite) + FTS4**, cifrada con SQLCipher | Realm, DataStore | SQL estándar, búsqueda de texto completo offline con miles de libros en ms. |
| Backend | **Node.js 22 + TypeScript + Fastify** | Kotlin/Ktor, Python/FastAPI, Go, PocketBase | Comparte tipos y validación (Zod) con la web; ecosistema simple; poco consumo. Ktor permitiría compartir modelos con Android vía KMP, pero añade complejidad de build que no compensa en un proyecto unipersonal. PocketBase/Supabase resuelven CRUD pero no el protocolo de sync con conflictos por campo. |
| BD servidor | **SQLite (WAL) + FTS5**, vía Drizzle ORM | PostgreSQL | Un usuario, miles de registros: SQLite sobra. Un único fichero → copias triviales y restauración fiable. Drizzle permite migrar a Postgres si algún día hace falta. |
| Web | **React + Vite + TanStack Query/Router**, servida por el propio backend | SvelteKit, Next.js | SPA estática sin SSR (no hay SEO, es privada). Tablas virtualizadas para colecciones grandes. Deja la puerta abierta a PWA offline (evolución). |
| Contrato | **OpenAPI 3.1** como fuente de verdad, generado desde esquemas Zod | GraphQL, gRPC | REST + JSON es lo más simple de consumir desde Kotlin (generador OpenAPI/Retrofit) y TS. |
| Red | **Tailscale** + HTTPS con `tailscale serve` (certificado automático, sin proxy adicional) | Port-forwarding + DDNS, Cloudflare Tunnel | Sin puertos abiertos ni exposición pública, gratis para uso personal, funciona dentro y fuera de casa. Cloudflare Tunnel expone a Internet (aunque detrás de Access). |
| Despliegue | **Docker Compose** (1 contenedor: API + web) con volumen `/srv/openlibrary`, escuchando solo en 127.0.0.1 | systemd nativo | Aislado y reproducible; actualizaciones con `deploy/scripts/update.sh`. Las copias corren con systemd timer en el host. |
| Metadatos | **Open Library** (principal) + **Google Books** (respaldo) | ISBNdb (de pago), BNE (SRU/MARC) | Gratuitos. BNE es muy valiosa para libros españoles: propuesta como evolución (F5). |
| Auth | Contraseña (Argon2id) + **sesión por cookie** (web) y **token de dispositivo** de larga duración revocable (Android) | OAuth/OIDC, Basic | Un solo usuario: OIDC es desproporcionado. Tokens por dispositivo permiten revocar un móvil perdido. |

---

## 6. Funcionamiento offline y protocolo de sincronización

### Principios
1. **Local-first en Android**: la UI lee y escribe *siempre* en Room. La red nunca está en el camino de la interacción.
2. **IDs generados en cliente** (UUIDv7) → crear offline sin colisiones ni reasignaciones.
3. **Outbox persistente**: cada cambio se guarda en la misma transacción que el dato como una operación con `op_id` único.
4. **Idempotencia**: el servidor registra cada `op_id` aplicado; repetirlo devuelve el mismo resultado sin reaplicar.
5. **Pull por cursor**: el servidor mantiene un `change_log` con secuencia monótona; el cliente pide "dame todo desde la secuencia N".
6. **Conflictos por campo**, nunca "último gana" silencioso.

### Operación (push)
```json
{
  "op_id": "0192f4c1-7a3e-7c2e-9d1a-4b6f3c2e1a90",
  "entity": "copy",
  "entity_id": "0192f4c1-6b10-7aa1-8c33-55e1d0b2f001",
  "kind": "update",            // create | update | delete
  "base_version": 7,           // versión que el cliente tenía
  "fields": { "location_id": "…", "notes": "Prestado a nadie, está en la mesilla" },
  "client_ts": "2026-11-04T09:12:33Z"
}
```

### Algoritmo en servidor (por operación, en transacción)
```
si op_id ∈ applied_ops → devolver resultado guardado (idempotente)
cargar entidad actual (version = v)
si kind=create y no existe → insertar (version 1)
si base_version == v → aplicar todos los campos
si base_version <  v → para cada campo enviado:
       ¿cambió ese campo en el change_log entre base_version y v?
          no → aplicar
          sí y valor igual → ignorar (convergente)
          sí y valor distinto → registrar CONFLICTO (no aplicar ese campo)
si kind=delete y hay cambios posteriores a base_version → conflicto "editado vs borrado"
incrementar version, escribir change_log(seq++, entity, id, version, campos)
guardar op_id → resultado
```

### Ciclo de sincronización (cliente)
```
1. PUSH  POST /sync/push   { device_id, batch_id, ops[≤100] }  → { results[op_id: applied|duplicate|conflict|rejected] }
2. ASSETS PUT /assets/{sha256} (portadas pendientes; idempotente por hash)
3. PULL  GET  /sync/pull?since=<cursor>&limit=500 → { changes[], next_cursor, has_more }
4. Aplicar cambios remotos en Room (si la entidad tiene ops locales pendientes, se re-basa)
5. Descargar portadas nuevas en segundo plano (miniatura 300 px; original bajo demanda)
```
- Disparadores: al abrir la app, tras cada cambio (debounce 5 s), al recuperar red (WorkManager con `NetworkType.CONNECTED`), periódico cada 30 min, y botón manual.
- Reintentos: backoff exponencial (5 s → 10 min). El mismo lote se reenvía con los mismos `op_id` → sin duplicados aunque la respuesta se perdiera.
- **Primera conexión**: `GET /sync/snapshot` (JSON comprimido de todo + cursor) y luego portadas en cola.
- **Estados visibles**: `Sincronizado · hace 2 min` · `3 cambios pendientes` · `Servidor no disponible — datos del 4 nov 09:12` · `1 conflicto por revisar`.
- **Conflictos**: lista en "Sincronización" con valor local vs servidor por campo → *Mantener el mío / Mantener el del servidor / Combinar (texto)*. La resolución es otra operación normal.
- **Rechazos** (validación): se muestran con mensaje legible y la op se puede editar o descartar; no bloquea el resto de la cola.
- Web: online, usa la misma API de mutación con `base_version` (así un formulario web antiguo tampoco pisa un cambio del móvil).

### Alcance offline en Android
| Disponible offline | Requiere conexión |
|---|---|
| Consultar, buscar, filtrar, estadísticas | Búsqueda de metadatos (Internet) |
| Alta manual / provisional, fotos de portada | Sincronizar (servidor) |
| Ejemplares, lectura, notas, citas, deseos | Importar/exportar/copias (web) |
| Consultar ubicaciones, crear ubicación simple | Reorganizar árbol de ubicaciones (web, para evitar conflictos estructurales) |

---

## 7. Contratos cliente–backend (resumen)

Base: `https://openlibrary.<tailnet>.ts.net/api/v1` · JSON · errores RFC 9457 (`application/problem+json`).

| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/auth/login` | `{password}` → cookie (web) |
| POST | `/auth/devices` | registra dispositivo → `{device_id, token}` (Android) |
| GET / DELETE | `/auth/devices[/{id}]` | listar / revocar dispositivos |
| POST | `/auth/password` | cambiar contraseña |
| GET | `/works?q=&status=&subject=&location=&lang=&sort=&cursor=&limit=` | listado paginado con búsqueda FTS |
| GET | `/works/{id}` | obra + ediciones + ejemplares + lecturas |
| POST/PATCH/DELETE | `/works`, `/editions`, `/copies`, `/locations`, `/reading-sessions`, `/quotes`, `/wishlist` | CRUD (PATCH exige `If-Match: <version>`) |
| GET | `/locations/tree` | árbol con conteos |
| GET | `/lookup/isbn/{isbn}` | propuesta normalizada de metadatos (proxy proveedores, caché 30 días) |
| PUT / GET | `/assets/{sha256}` | subir / descargar portada (`?size=thumb`) |
| GET | `/sync/snapshot` · `/sync/pull` · POST `/sync/push` | protocolo §6 |
| GET | `/sync/conflicts` · POST `/sync/conflicts/{id}/resolve` | conflictos |
| GET | `/stats` | estadísticas agregadas |
| GET | `/export/csv` · `/export/full` (zip: `library.json` + `assets/`) | exportación |
| POST | `/import` (multipart) → `{job_id}`; GET `/import/{job}` | importación con informe (dry-run por defecto) |
| POST/GET | `/admin/backups` · POST `/admin/backups/{id}/restore` | copias |

**Formato de metadatos propuestos (lookup)**
```json
{ "isbn13": "9788432221477", "found": true, "sources": ["openlibrary"],
  "proposal": { "title": "…", "subtitle": null, "authors": ["…"], "publisher": "…",
                "published_year": 2013, "language": "es", "pages": 240,
                "subjects": ["…"], "description": "…", "cover_url": "…",
                "identifiers": [{"scheme":"olid","value":"OL…M"}] },
  "confidence": "high" }
```

**Formato de exportación completa** (`library.json`, versionado `format_version: 1`): arrays `works, editions, copies, locations, reading_sessions, quotes, wishlist, persons, subjects, assets` con todas las claves y relaciones por ID; portadas en `assets/<sha256>.<ext>`. Reimportable sin pérdida (es también el formato de restauración "lógica").

---

## 8. Estructura del repositorio

```
OpenLibrary/
├── apps/
│   ├── server/            # Fastify + Drizzle + SQLite. src/{modules/{catalog,copies,locations,reading,wishlist,sync,lookup,assets,io,stats,auth}, db, lib}
│   ├── web/               # React + Vite. src/{routes, features/*, components, api (cliente generado)}
│   └── android/           # Gradle multi-módulo:
│       ├── app/           #   navegación, DI (Hilt)
│       ├── core/{model,database,network,sync,isbn,designsystem}
│       └── feature/{library,detail,scan,cover,locations,reading,wishlist,stats,settings}
├── packages/
│   ├── contracts/         # esquemas Zod → openapi.yaml (fuente de verdad) + tipos TS generados
│   └── isbn/              # normalización/validación ISBN (TS) + vectores de prueba compartidos (JSON) que también usa Android
├── deploy/                # docker-compose.yml, .env.example, systemd/openlibrary-backup.{service,timer}, scripts/{backup,restore,update}.sh + ol (CLI)
├── docs/                  # este documento, ADRs, runbooks
└── prototypes/            # prototipos navegables (web y Android)
```
Monorepo con **pnpm workspaces** para la parte TS; Android con Gradle independiente que consume `packages/contracts/openapi.yaml` para generar su cliente.

---

## 9. Despliegue en Ubuntu, copias de seguridad y restauración

### Despliegue
- `/srv/openlibrary/{data/library.db, data/assets/, backups/, .env}`.
- `docker compose up -d` → contenedor `app` (API + web estática) publicado **solo** en `127.0.0.1:8080`. `tailscale serve --bg --https=443 http://127.0.0.1:8080` lo expone por HTTPS únicamente a la tailnet. Guía paso a paso: [runbook-despliegue.md](runbook-despliegue.md).
- Arranque con el sistema (`restart: unless-stopped`); como el PC se apaga, no hay nada que "mantener vivo": la app arranca en ~2 s.
- Primera ejecución: `docker compose run app setup` pide la contraseña del propietario.

### Copias de seguridad
- **Nocturna y al arrancar** (systemd timer con `Persistent=true`, así se ejecuta aunque el PC estuviera apagado a la hora prevista):
  1. `sqlite3 library.db "VACUUM INTO 'snap.db'"` (copia consistente en caliente).
  2. `tar` de `snap.db` + `assets/` (los assets son inmutables por hash → incremental).
  3. **restic** a dos destinos: disco externo/NAS y, opcionalmente, nube cifrada (B2/S3). Retención: 7 diarias, 4 semanales, 12 mensuales.
  4. `restic check` semanal + alerta si la última copia tiene más de 3 días (aviso en la web).
- Además, la web permite descargar la **exportación completa** (zip) en cualquier momento: es la copia "independiente de la aplicación".
- Android es en la práctica una tercera copia de los datos (no de las portadas originales).

### Restauración
```bash
deploy/scripts/restore.sh --snapshot latest   # detiene app, restaura library.db y assets, arranca, verifica integridad (PRAGMA integrity_check + conteos)
```
- Tras restaurar, el servidor cambia su `epoch` de datos: los clientes detectan el cambio y hacen **resincronización completa** (sus cambios pendientes se reenvían y, si chocan, aparecen como conflictos, nunca se pierden).
- Restauración lógica alternativa: importar `library.json` en una instalación nueva.
- **Simulacro de restauración** automatizado en CI (§12) y manual cada trimestre.

---

### 9.1 Preparado para Internet desde el primer día

Se programa como si fuera a estar en Internet, aunque al principio viva en el PC con Tailscale. Así, publicarlo después es **cambiar el despliegue, no el código**.

**Requisitos de la aplicación (desde F0):**
- HTTPS siempre; la URL pública se configura con una variable (`PUBLIC_URL`) y nada asume una red "de confianza".
- Contraseña con Argon2id, bloqueo progresivo tras intentos fallidos y limitación de peticiones en `/auth/*`.
- Cookies `Secure`, `HttpOnly`, `SameSite=Strict`, protección CSRF y cabeceras de seguridad (CSP, HSTS).
- Segundo factor opcional (TOTP) preparado, activable al pasar a público.
- Tokens de dispositivo revocables y caducables; registro de accesos visible en la web.
- Portadas servidas solo con sesión: nada de la biblioteca es accesible sin autenticar.
- Todo el estado vive en `/srv/openlibrary` (BD + portadas + `.env`), así que mover el servidor es copiar una carpeta o restaurar una copia.

**Opciones para publicarlo más adelante:**

| Opción | Qué cambia | Coste | Pros | Contras |
|--------|-----------|-------|------|---------|
| **A. Tailscale (actual)** | — | 0 € | Privado, sin puertos abiertos, funciona fuera de casa | Cada dispositivo necesita Tailscale; la web no está si el PC está apagado |
| **B. Cloudflare Tunnel desde el PC** | Añadir contenedor `cloudflared` + dominio | ~10 €/año (dominio) | Web desde cualquier navegador; sin abrir puertos; Cloudflare Access como capa de login extra | Sigue dependiendo de que el PC esté encendido |
| **C. VPS** (Hetzner, OVH…) | Mismo `docker compose` en otra máquina + restaurar copia | 4–6 €/mes | Web siempre disponible; el PC deja de importar | Datos en un servidor alquilado (cifrado en disco y copias cifradas) |

Paso de A a B o C: aproximadamente **una tarde de trabajo de despliegue**. No cambian la API, la sincronización ni las apps; en Android solo cambia la URL del servidor en Ajustes.

**Decidido (4 nov 2026): opción A**, coste cero. Se evaluó también Vercel (web) + Railway (API + Postgres): viable, pero exige dominio propio (cookies entre sitios distintos), almacenamiento privado para portadas y coste mensual por uso. Se descarta para el MVP.

**Si más adelante se publica:** comprar dominio y elegir B (sigue en el PC) o C/Railway (siempre disponible; implicaría pasar de SQLite a Postgres, que Drizzle ya permite, y guardar portadas en un almacenamiento S3 privado). La app ya está endurecida, así que no cambia el código de negocio.

## 10. Plan del MVP por fases

| Fase | Contenido | Criterios de aceptación verificables |
|------|-----------|--------------------------------------|
| **F0 · Cimientos** (1 sem) | Monorepo, CI (lint, test, build), esquema BD + migraciones, auth (login, dispositivos), Docker Compose + `tailscale serve`, scripts de copia/restauración **(implementada 4 nov 2026)** | `docker compose up` en Ubuntu sirve `/api/v1/health` por HTTPS en la tailnet; login con contraseña; sin acceso desde fuera de la tailnet; backup genera snapshot restic verificable |
| **F1 · Catálogo en web** (2 sem) | CRUD obra/edición/ejemplar/ubicación, alta manual, lookup ISBN (proxy), portadas, búsqueda FTS + filtros + orden, ficha, árbol de ubicaciones **(implementada 4 nov 2026)** | Alta manual sin ISBN ✔; ISBN → propuesta editable ✔; 2 ejemplares de una edición sin duplicar edición ✔; filtrar por "Salón › Estantería" incluye baldas hijas ✔; búsqueda < 150 ms con 10 000 ejemplares sintéticos |
| **F2 · Android lectura + sync pull** (2 sem) | Room + FTS, snapshot + pull incremental, caché de portadas, listado/búsqueda/ficha/ubicaciones offline, estado de sync | Con el PC apagado se consulta y busca toda la biblioteca y sus portadas ✔; cambio hecho en web aparece en Android tras sincronizar ✔ |
| **F3 · Android captura + escritura offline** (3 sem) | Escáner, alta provisional, fotos de portada, edición de ejemplares/lectura/notas, outbox + push idempotente, conflictos | Flujo CU01 completo ✔; cambios en modo avión persisten tras matar la app y reiniciar el móvil ✔; reenviar el mismo lote 3 veces no duplica ✔; editar el mismo campo en web y Android genera conflicto visible ✔ |
| **F4 · Lectura, deseos, estadísticas** (1,5 sem) | Sesiones de lectura y relecturas, citas, lista de deseos → adquisición, estadísticas (obras vs ejemplares) | "Lo he comprado" crea ejemplar sin duplicar obra ✔; stats coinciden con consultas SQL de referencia ✔ |
| **F5 · Portabilidad y endurecimiento** (1,5 sem) | Export CSV/JSON+zip, import (formato propio) con dry-run e informe, restauración + resync, bloqueo app, cifrado local, accesibilidad, rendimiento | Exportar → instalación limpia → importar = mismos conteos y relaciones ✔; restore.sh recupera la copia de anoche ✔; import informa duplicados y filas erróneas ✔ |

Total orientativo: **~11 semanas** a tiempo parcial-alto. Cada fase termina con algo usable.

**Trazabilidad con §19 de la definición**: sin ISBN → F1; escanear → F3; corregir → F1/F3; varios ejemplares → F1; localizar por ubicación → F1/F2; estado de lectura → F3/F4; búsqueda offline → F2; PC apagado → F2; cambios offline → F3; sin duplicados → F3; conflictos → F3; exportar/restaurar → F5; privacidad → F0/F5.

---

## 11. Riesgos

| ID | Riesgo | Prob. | Impacto | Mitigación |
|----|--------|:-----:|:-------:|------------|
| R1 | Metadatos pobres para libros en español / antiguos | Alta | Medio | Dos proveedores + BNE como evolución; alta manual rápida; fotos de portada; nunca bloquear el alta |
| R2 | Errores sutiles de sincronización (pérdida/duplicado) | Media | Alto | Protocolo simple (outbox + cursor), pruebas de propiedades y de inyección de fallos, logs de sync legibles |
| R3 | Pérdida del disco del PC | Media | Alto | restic a 2 destinos + export zip + copia implícita en Android; alerta de copia antigua |
| R4 | El móvil no alcanza al PC (red, Tailscale caído, IP) | Media | Bajo | Offline es el modo normal; estado claro; nombre MagicDNS estable |
| R5 | Restaurar backup "rompe" clientes con datos más nuevos | Baja | Alto | `epoch` + resync completo que conserva ops pendientes como conflictos |
| R6 | Lectura de código de barras con poca luz / EAN-5 añadido | Media | Bajo | Linterna, entrada manual de ISBN, ignorar suplemento |
| R7 | Alcance excesivo para un proyecto personal | Alta | Medio | Fases entregables; lo no-MVP en backlog; web y Android comparten contrato |
| R8 | Cambios/caídas en APIs de proveedores | Media | Bajo | Capa adaptador + caché de lookup; los datos ya guardados no dependen de ellos |
| R9 | Fuga de datos privados (móvil perdido) | Baja | Medio | SQLCipher, bloqueo biométrico, revocar token desde la web |

---

## 12. Estrategia de pruebas

| Nivel | Qué | Herramientas |
|-------|-----|--------------|
| Unitarias | ISBN (vectores compartidos TS/Kotlin: válidos, inválidos, ISSN, ISMN, X), reglas de lectura, fusión por campo, derivación de estados, ciclos en ubicaciones | Vitest, JUnit5 + Kotest |
| Propiedades | Convergencia del sync: secuencias aleatorias de ops en 2 réplicas + reordenación + duplicación ⇒ mismo estado final o conflicto explícito, nunca pérdida | fast-check (servidor), Kotest property |
| Contrato | Servidor cumple `openapi.yaml`; cliente Android generado compila contra él; snapshots de respuestas | Schemathesis / Dredd, tests de deserialización |
| Integración servidor | API real + SQLite temporal: CRUD, búsqueda, import/export ida y vuelta, idempotencia de `/sync/push` | Vitest + supertest |
| Fallos de red | Proxy de fallos (Toxiproxy) entre app y servidor: cortar **después** de que el servidor confirme y antes de que llegue la respuesta → reintento ⇒ `duplicate`, sin duplicado; latencia alta; 500 intermitente; servidor apagado a mitad de lote | Toxiproxy, MockWebServer (Android) |
| Android | Room + migraciones, outbox persiste tras matar el proceso, WorkManager reintenta, UI Compose (búsqueda offline, flujo de escaneo con imagen de prueba) | Robolectric, Compose UI tests, WorkManager TestDriver |
| E2E web | Flujos de alta, ficha, ubicaciones, deseos, importación con fichero erróneo | Playwright |
| Copias | Job de CI: crear datos → backup → borrar → restore → comparar conteos e integridad | script + contenedor efímero |
| Rendimiento | 10 000 ejemplares sintéticos: búsqueda web < 150 ms, Android < 100 ms, snapshot inicial < 10 s en LAN | k6 / benchmark Macrobenchmark |
| Manual (checklist por release) | Modo avión, PC apagado, reinicio del PC durante sync, dos dispositivos editando, luz baja al escanear | matriz de escenarios en `docs/qa-checklist.md` |

---

## 13. Fuera del MVP — evoluciones con valor real
1. **BNE (Biblioteca Nacional)** como proveedor de metadatos (gran mejora para libros españoles).
2. **Préstamos** (a quién, cuándo) — encaja en el modelo como entidad sobre `Copy`.
3. **Etiquetas QR por balda/ejemplar** (el código `EJ-0001` ya lo prepara).
4. **Web PWA offline** (la arquitectura no lo impide).
5. Fotos múltiples por ejemplar (dedicatorias, estado).
6. Series como entidad, traductores por edición.

---

## 14. Prototipos
Navegables, sin dependencias, con datos de ejemplo (`prototypes/shared/data.js`):
- **Web**: `prototypes/web/index.html` — catálogo, búsqueda, filtros, ficha obra/ediciones/ejemplares, ubicaciones, deseos, estadísticas, importar/exportar, sincronización y copias.
- **Android**: `prototypes/android/index.html` — marco de teléfono con panel de escenarios (PC encendido/apagado, Internet sí/no, fallos de red, conflictos) para probar escaneo, foto de portada, ficha, ubicaciones, deseos y cola de sincronización.
