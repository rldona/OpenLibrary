/**
 * Admin tools that run on the server (not over HTTP):
 *   set-password            creates or changes the password (reads OL_PASSWORD or prompts for it)
 *   backup <file.db>        consistent hot copy of the database
 *   check                   checks database integrity
 *   after-restore           after restoring a backup: verifies it and bumps the epoch (clients resync)
 *   status                  state summary
 *   demo-data [en|es]       loads sample locations and books (only on an empty library)
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { pickLang } from '@openlibrary/contracts';
import { loadConfig } from './config.js';
import { bumpEpoch, getMeta, openDb, type Db } from './db/client.js';
import { AuthService } from './auth/service.js';
import { CatalogService } from './catalog/service.js';
import { HttpError } from './errors.js';
import { tr } from './i18n.js';
import { loadDemo } from './demo.js';
import { dropPrivileges } from './privileges.js';

function askHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const out = rl as unknown as { _writeToOutput: (s: string) => void };
    const write = out._writeToOutput;
    out._writeToOutput = (s: string) => {
      if (s.startsWith(question)) write.call(rl, s);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

const integrity = (db: Db) => String(db.$client.pragma('integrity_check', { simple: true }));

async function main(): Promise<number> {
  const [cmd, ...args] = process.argv.slice(2);
  const config = loadConfig();
  dropPrivileges(config.dataDir);
  const db = openDb(config.dbPath);
  const auth = new AuthService(db, config.sessionTtlMs);

  switch (cmd) {
    case 'set-password': {
      let pw = process.env.OL_PASSWORD;
      if (!pw) {
        if (!process.stdin.isTTY) {
          console.error('No terminal: set OL_PASSWORD or run the command interactively (-it).');
          return 1;
        }
        pw = await askHidden('New password (min. 12 characters): ');
        const again = await askHidden('Repeat it: ');
        if (pw !== again) {
          console.error('The passwords do not match.');
          return 1;
        }
      }
      const existed = auth.isConfigured();
      try {
        await auth.setPassword(pw);
      } catch (e) {
        if (e instanceof HttpError) {
          console.error(tr('en')(e.key, e.params));
          return 1;
        }
        throw e;
      }
      console.log(
        existed
          ? 'Password changed. Every session and device has been signed out.'
          : 'Password created. You can sign in now.',
      );
      return 0;
    }
    case 'backup': {
      const out = args[0];
      if (!out) {
        console.error('Usage: backup <target-file.db>');
        return 1;
      }
      fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
      const tmp = `${out}.tmp`;
      fs.rmSync(tmp, { force: true });
      await db.$client.backup(tmp);
      fs.renameSync(tmp, out);
      const size = (fs.statSync(out).size / 1024).toFixed(0);
      console.log(`Backup created: ${out} (${size} KB)`);
      return 0;
    }
    case 'check': {
      const r = integrity(db);
      console.log(`Integrity: ${r}`);
      return r === 'ok' ? 0 : 2;
    }
    case 'after-restore': {
      const r = integrity(db);
      if (r !== 'ok') {
        console.error(`The restored database is not consistent: ${r}`);
        return 2;
      }
      new CatalogService(db).reindexAll();
      const epoch = bumpEpoch(db);
      console.log(`Restore verified. New epoch ${epoch}: devices will perform a full resync.`);
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
      const lang = pickLang(args[0] ?? 'en');
      try {
        const r = loadDemo(new CatalogService(db), lang);
        console.log(`Sample data loaded (${lang}): ${r.locations} locations and ${r.books} books.`);
        return 0;
      } catch (e) {
        console.error((e as Error).message);
        return 1;
      }
    }
    default:
      console.log(
        'Commands: set-password | backup <file.db> | check | after-restore | status | demo-data [en|es]',
      );
      return cmd ? 1 : 0;
  }
}

process.exitCode = await main();
