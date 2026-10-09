/**
 * Proto code generation script.
 * Generates TypeScript type definitions from .proto files using @grpc/proto-loader.
 *
 * Usage: npm run proto:gen
 */
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PROTO_DIR = path.join(ROOT, 'proto');
const OUT_DIR = path.join(ROOT, 'packages', 'shared', 'src', 'generated');

// Ensure output directory exists
fs.mkdirSync(OUT_DIR, { recursive: true });

// Find all .proto files
const protoFiles = fs
  .readdirSync(PROTO_DIR)
  .filter((f) => f.endsWith('.proto'))
  .map((f) => path.join(PROTO_DIR, f));

if (protoFiles.length === 0) {
  console.error('No .proto files found in', PROTO_DIR);
  process.exit(1);
}

console.log(`Generating TypeScript definitions from ${protoFiles.length} proto files...`);

// Use proto-loader-gen-types to generate TypeScript definitions
// This generates typed client/server interfaces and message types
const genTypesPath = path.join(ROOT, 'node_modules', '.bin', 'proto-loader-gen-types');

for (const protoFile of protoFiles) {
  const baseName = path.basename(protoFile, '.proto');
  console.log(`  Processing ${baseName}.proto...`);

  const cmd = [
    genTypesPath,
    `--longs=Number`,
    `--enums=String`,
    `--defaults`,
    `--oneofs`,
    `--grpcLib=@grpc/grpc-js`,
    `-I ${PROTO_DIR}`,
    `-O ${OUT_DIR}`,
    protoFile,
  ].join(' ');

  try {
    execSync(cmd, { cwd: ROOT, stdio: 'inherit' });
  } catch (err) {
    console.error(`Failed to generate types for ${baseName}.proto`);
    process.exit(1);
  }
}

// Post-process generated .ts files to add .js extensions to relative imports for ESM compatibility
function addJsExtensions(dir: string) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      addJsExtensions(fullPath);
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      let content = fs.readFileSync(fullPath, 'utf-8');
      // Replace relative imports without .js extensions
      content = content.replace(/(from\s+['"]\.\.?[^'"]+?)(?<!\.js)(['"])/g, '$1.js$2');
      fs.writeFileSync(fullPath, content, 'utf-8');
    }
  }
}

addJsExtensions(OUT_DIR);

// Create a barrel index.ts for all generated types
const indexLines: string[] = [
  '// Auto-generated barrel export — do not edit manually.',
  '// Re-run `npm run proto:gen` to regenerate.',
  '',
];

// Export from the bank/v1 package namespace
const v1Dir = path.join(OUT_DIR, 'bank', 'v1');
if (fs.existsSync(v1Dir)) {
  const tsFiles = fs.readdirSync(v1Dir).filter((f) => f.endsWith('.ts') && f !== 'index.ts');
  for (const f of tsFiles) {
    const moduleName = f.replace('.ts', '');
    indexLines.push(`export * from './bank/v1/${moduleName}.js';`);
  }
}

fs.writeFileSync(path.join(OUT_DIR, 'index.ts'), indexLines.join('\n') + '\n');
console.log('\nGenerated barrel export at packages/shared/src/generated/index.ts');
console.log('Proto generation complete.');
