/**
 * Herramientas de administración que se ejecutan en el servidor (no por HTTP):
 *   set-password            crea o cambia la contraseña (lee OL_PASSWORD o la pide por teclado)
 *   backup <archivo.db>     copia consistente de la base de datos en caliente
 *   check                   comprueba la integridad de la base de datos
 *   after-restore           tras restaurar una copia: verifica y cambia el epoch (los clientes resincronizan)
 *   status                  resumen del estado
 *   demo-data               carga ubicaciones y libros de ejemplo (solo con la biblioteca vacía)
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { loadConfig } from './config.js';
import { bumpEpoch, getMeta, openDb, type Db } from './db/client.js';
import { AuthService } from './auth/service.js';
import { CatalogService } from './catalog/service.js';
import { loadDemo } from './demo.js';

function askHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const write = (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput;
    (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = (s: string) => {
      if (s.startsWith(question)) write.call(rl, s);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

function integrity(db: Db): string {
  const row = db.$client.pragma('integrity_check', { simple: true });
  return String(row);
}

async function main(): Promise<number> {
  const [cmd, ...args] = process.argv.slice(2);
  const config = loadConfig();
  const db = openDb(config.dbPath);
  const auth = new AuthService(db, config.sessionTtlMs);

  switch (cmd) {
    case 'set-password': {
      let pw = process.env.OL_PASSWORD;
      if (!pw) {
        if (!process.stdin.isTTY) {
          console.error('Sin terminal: define OL_PASSWORD o ejecuta el comando de forma interactiva (-it).');
          return 1;
        }
        pw = await askHidden('Nueva contraseña (mín. 12 caracteres): ');
        const again = await askHidden('Repítela: ');
        if (pw !== again) {
          console.error('Las contraseñas no coinciden.');
          return 1;
        }
      }
      const existed = auth.isConfigured();
      await auth.setPassword(pw);
      console.log(
        existed
          ? 'Contraseña cambiada. Se han cerrado todas las sesiones y dispositivos.'
          : 'Contraseña creada. Ya puedes iniciar sesión.',
      );
      return 0;
    }
    case 'backup': {
      const out = args[0];
      if (!out) {
        console.error('Uso: backup <archivo-destino.db>');
        return 1;
      }
      fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
      const tmp = `${out}.tmp`;
      fs.rmSync(tmp, { force: true });
      await db.$client.backup(tmp);
      fs.renameSync(tmp, out);
      const size = (fs.statSync(out).size / 1024).toFixed(0);
      console.log(`Copia creada: ${out} (${size} KB)`);
      return 0;
    }
    case 'check': {
      const r = integrity(db);
      console.log(`Integridad: ${r}`);
      return r === 'ok' ? 0 : 2;
    }
    case 'after-restore': {
      const r = integrity(db);
      if (r !== 'ok') {
        console.error(`La base de datos restaurada no es íntegra: ${r}`);
        return 2;
      }
      const epoch = bumpEpoch(db);
      console.log(
        `Restauración verificada. Nuevo epoch ${epoch}: los dispositivos harán una resincronización completa.`,
      );
      return 0;
    }
    case 'status': {
      console.log(
        JSON.stringify(
          {
            dataDir: config.dataDir,
            publicUrl: config.publicUrl.href,
            passwordConfigured: auth.isConfigured(),
            epoch: getMeta(db, 'epoch'),
            activeSessions: auth.listActive().length,
            integrity: integrity(db),
          },
          null,
          2,
        ),
      );
      return 0;
    }
    case 'demo-data': {
      try {
        const r = loadDemo(new CatalogService(db));
        console.log(`Datos de ejemplo cargados: ${r.locations} ubicaciones y ${r.books} libros.`);
        return 0;
      } catch (e) {
        console.error((e as Error).message);
        return 1;
      }
    }
    default:
      console.log(
        'Comandos: set-password | backup <archivo.db> | check | after-restore | status | demo-data',
      );
      return cmd ? 1 : 0;
  }
}

process.exitCode = await main();
