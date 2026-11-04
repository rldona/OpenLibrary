/**
 * Server-side messages (API errors) in English and Spanish.
 * The language is negotiated per request from the Accept-Language header (default: English).
 */
import { SHARED, translator, type Dict, type Lang } from '@openlibrary/contracts';

const SERVER: Record<Lang, Dict> = {
  en: {
    'title.400': 'Invalid request',
    'title.401': 'Not authenticated',
    'title.403': 'Forbidden',
    'title.404': 'Not found',
    'title.409': 'Conflict',
    'title.413': 'Payload too large',
    'title.415': 'Unsupported media type',
    'title.429': 'Too many requests',
    'title.500': 'Internal error',
    'title.502': 'Provider error',
    'title.503': 'Service unavailable',
    'errors.unexpected': 'Unexpected error.',
    'errors.rateLimited': 'Too many requests. Please slow down.',
    'errors.validation': 'Invalid data: {details}',
    'errors.notFound': 'Not found.',
    'errors.routeNotFound': '{method} {path} does not exist.',
    'errors.baseVersionAhead': 'baseVersion is greater than the current version.',
    // sync
    'errors.epochMismatch': 'The server data was restored from a backup. A full resync is needed.',
    'errors.cursorAhead': 'The sync cursor is ahead of the server. A full resync is needed.',
    // auth
    'errors.unauthorized': 'You need to sign in.',
    'errors.wrongPassword': 'Wrong password.',
    'errors.notConfigured': 'The library has no password yet. Run "ol set-password" on the server.',
    'errors.tooManyAttempts': 'Too many attempts. Wait before trying again.',
    'errors.passwordTooShort': 'The password must be at least {min} characters long.',
    'errors.sessionNotFound': 'That session or device does not exist or was already revoked.',
    'errors.originNotAllowed': 'Origin not allowed: {origin}',
    'errors.crossSite': 'Cross-site request blocked.',
    'errors.missingOrigin': 'Missing Origin header.',
    // catalog
    'errors.bookNotFound': 'That book does not exist.',
    'errors.workNotFound': 'The given work does not exist.',
    'errors.editionNotFound': 'The given edition does not exist.',
    'errors.locationNotFound': 'The given location does not exist.',
    'errors.parentNotFound': 'The parent location does not exist.',
    'errors.locationCycle': 'A location cannot be moved inside itself or one of its sub-locations.',
    'errors.locationHasChildren': 'It has sub-locations: move or delete them first.',
    'errors.locationHasCopies': 'There are {n} copies here: move them before deleting it.',
    'errors.coverNotFound': 'That cover does not exist. Upload it first.',
    'errors.duplicateIsbn':
      'You already own this edition ("{title}", {n} copies). Add another copy instead of duplicating it.',
    'errors.alreadyExists.work': 'That work already exists.',
    'errors.alreadyExists.edition': 'That edition already exists.',
    'errors.alreadyExists.copy': 'That copy already exists.',
    'errors.alreadyExists.location': 'That location already exists.',
    'errors.conflict.work':
      'Another device changed {fields} of this book while you were editing it. Nothing was overwritten.',
    'errors.conflict.edition':
      'Another device changed {fields} of this edition while you were editing it. Nothing was overwritten.',
    'errors.conflict.copy':
      'Another device changed {fields} of this copy while you were editing it. Nothing was overwritten.',
    'errors.conflict.location':
      'Another device changed {fields} of this location while you were editing it. Nothing was overwritten.',
    // images
    'errors.imageNotFound': 'That image does not exist.',
    'errors.imageEmpty': 'The image is empty.',
    'errors.imageInvalid': 'The file is not a valid image (use JPEG, PNG or WebP).',
    'errors.imageDims': 'The image dimensions cannot be read.',
    'errors.imageTooSmall': 'The image is too small to be a cover.',
    'errors.imageTooLarge': 'The image is too large.',
    'errors.unsupportedMedia': 'Send the image with an image/* Content-Type.',
    'errors.hostNotAllowed': 'Images from {host} are not allowed.',
    'errors.noCover': 'The provider has no cover for this book.',
    'errors.providerError': 'The provider answered {status}.',
    'errors.tooManyRedirects': 'Too many redirects.',
  },
  es: {
    'title.400': 'Petición no válida',
    'title.401': 'No autenticado',
    'title.403': 'Prohibido',
    'title.404': 'No encontrado',
    'title.409': 'Conflicto',
    'title.413': 'Contenido demasiado grande',
    'title.415': 'Tipo de contenido no soportado',
    'title.429': 'Demasiadas peticiones',
    'title.500': 'Error interno',
    'title.502': 'Error del proveedor',
    'title.503': 'Servicio no disponible',
    'errors.unexpected': 'Error inesperado.',
    'errors.rateLimited': 'Demasiadas peticiones. Ve un poco más despacio.',
    'errors.validation': 'Datos no válidos: {details}',
    'errors.notFound': 'No encontrado.',
    'errors.routeNotFound': 'No existe {method} {path}.',
    'errors.baseVersionAhead': 'baseVersion es mayor que la versión actual.',
    // sync
    'errors.epochMismatch':
      'Los datos del servidor se restauraron desde una copia. Hace falta una sincronización completa.',
    'errors.cursorAhead':
      'El cursor de sincronización va por delante del servidor. Hace falta una sincronización completa.',
    'errors.unauthorized': 'Necesitas iniciar sesión.',
    'errors.wrongPassword': 'Contraseña incorrecta.',
    'errors.notConfigured':
      'La biblioteca aún no tiene contraseña. Ejecuta «ol set-password» en el servidor.',
    'errors.tooManyAttempts': 'Demasiados intentos. Espera antes de volver a probar.',
    'errors.passwordTooShort': 'La contraseña debe tener al menos {min} caracteres.',
    'errors.sessionNotFound': 'Esa sesión o dispositivo no existe o ya estaba revocado.',
    'errors.originNotAllowed': 'Origen no permitido: {origin}',
    'errors.crossSite': 'Petición entre sitios bloqueada.',
    'errors.missingOrigin': 'Falta la cabecera Origin.',
    'errors.bookNotFound': 'Ese libro no existe.',
    'errors.workNotFound': 'La obra indicada no existe.',
    'errors.editionNotFound': 'La edición indicada no existe.',
    'errors.locationNotFound': 'La ubicación indicada no existe.',
    'errors.parentNotFound': 'La ubicación padre no existe.',
    'errors.locationCycle': 'No puedes mover una ubicación dentro de sí misma o de una de sus subdivisiones.',
    'errors.locationHasChildren': 'Tiene subdivisiones: muévelas o bórralas primero.',
    'errors.locationHasCopies': 'Hay {n} ejemplar(es) aquí: muévelos antes de borrarla.',
    'errors.coverNotFound': 'La portada indicada no existe. Súbela primero.',
    'errors.duplicateIsbn':
      'Ya tienes esta edición («{title}», {n} ejemplar(es)). Añade otro ejemplar en lugar de duplicarla.',
    'errors.alreadyExists.work': 'Esa obra ya existe.',
    'errors.alreadyExists.edition': 'Esa edición ya existe.',
    'errors.alreadyExists.copy': 'Ese ejemplar ya existe.',
    'errors.alreadyExists.location': 'Esa ubicación ya existe.',
    'errors.conflict.work':
      'Otro dispositivo cambió {fields} de este libro mientras lo editabas. No se ha sobrescrito nada.',
    'errors.conflict.edition':
      'Otro dispositivo cambió {fields} de esta edición mientras la editabas. No se ha sobrescrito nada.',
    'errors.conflict.copy':
      'Otro dispositivo cambió {fields} de este ejemplar mientras lo editabas. No se ha sobrescrito nada.',
    'errors.conflict.location':
      'Otro dispositivo cambió {fields} de esta ubicación mientras la editabas. No se ha sobrescrito nada.',
    'errors.imageNotFound': 'Esa imagen no existe.',
    'errors.imageEmpty': 'La imagen está vacía.',
    'errors.imageInvalid': 'El archivo no es una imagen válida (usa JPEG, PNG o WebP).',
    'errors.imageDims': 'No se pueden leer las dimensiones de la imagen.',
    'errors.imageTooSmall': 'La imagen es demasiado pequeña para ser una portada.',
    'errors.imageTooLarge': 'La imagen es demasiado grande.',
    'errors.unsupportedMedia': 'Envía la imagen con un Content-Type image/*.',
    'errors.hostNotAllowed': 'No se permiten imágenes de {host}.',
    'errors.noCover': 'El proveedor no tiene portada para este libro.',
    'errors.providerError': 'El proveedor respondió {status}.',
    'errors.tooManyRedirects': 'Demasiadas redirecciones.',
  },
};

const cache = new Map<Lang, ReturnType<typeof translator>>();
export function tr(lang: Lang) {
  let t = cache.get(lang);
  if (!t) {
    t = translator([SHARED, SERVER], lang);
    cache.set(lang, t);
  }
  return t;
}

/** Every key must exist in both languages (checked by the tests). */
export const SERVER_MESSAGES = SERVER;
