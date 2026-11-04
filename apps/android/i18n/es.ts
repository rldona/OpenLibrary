import type { en } from './en.js';

/** Android-only UI messages (Spanish). Must have exactly the same keys as en.ts. */
export const es: Record<keyof typeof en, string> = {
  'app.name': 'OpenLibrary',

  'setup.title': 'Conecta con tu biblioteca',
  'setup.text':
    'Indica la dirección de tu servidor y tu contraseña. Este móvil tendrá su propio acceso, que puedes revocar desde la web.',
  'setup.server': 'Dirección del servidor',
  'setup.serverPlaceholder': 'https://openlibrary.tu-tailnet.ts.net',
  'setup.deviceName': 'Nombre de este móvil',
  'setup.connect': 'Conectar',
  'setup.connecting': 'Conectando…',
  'setup.invalidUrl': 'Indica una dirección válida, p. ej. https://openlibrary.tu-tailnet.ts.net',

  'sync.never': 'Aún sin sincronizar',
  'sync.syncing': 'Sincronizando…',
  'sync.synced': 'Sincronizado · {ago}',
  'sync.offline': 'Servidor no disponible — datos del {date}',
  'sync.failed': 'Falló la sincronización: {error}',
  'sync.now': 'Sincronizar ahora',
  'sync.downloadingLibrary': 'Descargando tu biblioteca…',
  'sync.resync': 'Volver a descargarlo todo',
  'sync.resyncHint': 'Sustituye la copia de este móvil por los datos del servidor.',

  'time.justNow': 'ahora mismo',
  'time.minutes': 'hace {n} min',
  'time.hours': 'hace {n} h',
  'time.days': 'hace {n} d',

  'device.disconnect': 'Desconectar este móvil',
  'device.disconnectConfirm':
    'Se borrará la copia de la biblioteca de este móvil. Podrás volver a conectarlo con tu contraseña.',
  'device.revoked': 'Este móvil ya no tiene acceso. Vuelve a conectarlo con tu contraseña.',
  'device.thisDevice': 'Este móvil',
  'device.lastSync': 'Última sincronización',
  'device.books': 'Ediciones en este móvil',

  'detail.back': 'Volver',
  'detail.retired': 'Retirado',
  'locations.allBooks': 'Libros aquí',
};
