// Marca i due output con il loro module system, così Node risolve
// correttamente `require()` (CJS) e `import` (ESM) dallo stesso pacchetto.
import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

for (const [dir, type] of [
  ['cjs', 'commonjs'],
  ['esm', 'module'],
]) {
  writeFileSync(resolve(root, 'dist', dir, 'package.json'), `${JSON.stringify({ type }, null, 2)}\n`);
}

console.log('dual build: dist/cjs (commonjs) + dist/esm (module)');
