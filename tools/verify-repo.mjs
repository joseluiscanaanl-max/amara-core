import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let ts;
try {
  ts = require('typescript');
} catch {
  ts = require('/opt/nvm/versions/node/v22.16.0/lib/node_modules/typescript');
}

const roots = ['apps', 'packages'];
const diagnostics = [];
let tsFiles = 0;

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(fullPath);
    else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      tsFiles += 1;
      const source = fs.readFileSync(fullPath, 'utf8');
      const result = ts.transpileModule(source, {
        fileName: fullPath,
        reportDiagnostics: true,
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.CommonJS,
          jsx: ts.JsxEmit.ReactJSX,
        },
      });
      for (const diagnostic of result.diagnostics ?? []) {
        diagnostics.push(`${fullPath}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`);
      }
    }
  }
}

for (const root of roots) walk(root);

const migrations = fs.readdirSync('database/migrations')
  .filter((name) => /^\d{3}_.+\.sql$/.test(name))
  .sort();
for (let index = 0; index < migrations.length; index += 1) {
  const expected = String(index + 1).padStart(3, '0');
  if (!migrations[index].startsWith(expected)) diagnostics.push(`Migration sequence gap: expected ${expected}, found ${migrations[index]}`);
}

const required = [
  'package.json', 'pnpm-workspace.yaml', 'docker-compose.yml', '.env.example',
  'apps/api/src/main.ts', 'apps/household-web/app/page.tsx', 'apps/admin-web/app/page.tsx',
];
for (const file of required) if (!fs.existsSync(file)) diagnostics.push(`Required file missing: ${file}`);

console.log(`Checked ${tsFiles} TypeScript/TSX files and ${migrations.length} SQL migrations.`);
if (diagnostics.length) {
  console.error(diagnostics.join('\n'));
  process.exit(1);
}
console.log('Repository structural verification passed.');
