/**
 * Android-only UI messages (English). Everything else comes from the shared catalog
 * (packages/contracts/src/i18n.ts) and the web dictionaries, so both apps use the same keys.
 * `npm run android:strings` turns all of them into res/values{,-es}/strings.xml.
 */
export const en = {
  'app.name': 'OpenLibrary',

  'setup.title': 'Connect to your library',
  'setup.text':
    'Enter your server address and password. This phone gets its own access, which you can revoke from the web.',
  'setup.server': 'Server address',
  'setup.serverPlaceholder': 'https://openlibrary.your-tailnet.ts.net',
  'setup.deviceName': 'Name of this phone',
  'setup.connect': 'Connect',
  'setup.connecting': 'Connecting…',
  'setup.invalidUrl': 'Enter a valid address, e.g. https://openlibrary.your-tailnet.ts.net',

  'sync.never': 'Not synced yet',
  'sync.syncing': 'Syncing…',
  'sync.synced': 'Synced · {ago}',
  'sync.offline': 'Server unavailable — data from {date}',
  'sync.failed': 'Sync failed: {error}',
  'sync.now': 'Sync now',
  'sync.downloadingLibrary': 'Downloading your library…',
  'sync.resync': 'Download everything again',
  'sync.resyncHint': 'Replaces the copy on this phone with the data on the server.',

  'time.justNow': 'just now',
  'time.minutes': '{n} min ago',
  'time.hours': '{n} h ago',
  'time.days': '{n} d ago',

  'device.disconnect': 'Disconnect this phone',
  'device.disconnectConfirm':
    'The copy of the library on this phone will be deleted. You can connect again with your password.',
  'device.revoked': 'This phone no longer has access. Connect again with your password.',
  'device.thisDevice': 'This phone',
  'device.lastSync': 'Last sync',
  'device.books': 'Editions on this phone',

  'detail.back': 'Back',
  'detail.retired': 'Retired',
  'locations.allBooks': 'Books here',
} as const;
