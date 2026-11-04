import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts', 'src/cli.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node24',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // Los paquetes del monorepo se empaquetan; las dependencias npm (incluidas las nativas) quedan externas.
  noExternal: [/^@openlibrary\//],
});
