/**
 * seed-data.mjs
 * Copies default JSON data files to the DATA_DIR if they don't exist yet.
 * Runs at Railway startup before `next start`.
 *
 * Railway: set DATA_DIR=/data and mount a volume at /data
 * Local:   DATA_DIR is not set → script is a no-op (src/data already has the files)
 */

import { existsSync, copyFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = resolve(__dirname, '..');
const DATA_DIR  = process.env.DATA_DIR;

// Only run when DATA_DIR is explicitly set (Railway environment)
if (!DATA_DIR) {
  console.log('[seed] DATA_DIR not set — skipping (local dev)');
  process.exit(0);
}

console.log('[seed] Data directory:', DATA_DIR);
mkdirSync(DATA_DIR, { recursive: true });

// ── Files to copy from bundled src/data (only if not already in volume) ──
const SEED_FILES = [
  'products.json',
  'suppliers.json',
  'params.json',
  'stock.json',
  'ml-lab.json',
  'change-history.json',
  'odoo-supplierinfo.json',
  'seiq-catalog.json',
];

for (const file of SEED_FILES) {
  const dest = resolve(DATA_DIR, file);
  const src  = resolve(ROOT, 'src/data', file);
  if (!existsSync(dest)) {
    if (existsSync(src)) {
      copyFileSync(src, dest);
      console.log(`[seed] ✅ Copied ${file}`);
    } else {
      console.log(`[seed] ⚠️  Source not found: ${file}`);
    }
  } else {
    console.log(`[seed] ✓  ${file} already exists — keeping volume version`);
  }
}

// ── settings.json: create blank if not present (user configures via UI) ──
const settingsPath = resolve(DATA_DIR, 'settings.json');
if (!existsSync(settingsPath)) {
  writeFileSync(settingsPath, JSON.stringify({
    odooServerUrl: '',
    odooUsername:  '',
    odooApiKey:    '',
    odooDbName:    '',
    mlAppId:       '',
    mlAppSecret:   '',
    mlSite:        'MLA',
    geminiKey:     '',
  }, null, 2), 'utf8');
  console.log('[seed] ✅ Created blank settings.json — configure in Parámetros');
}

// ── competitor-links.json ──
const linksPath = resolve(DATA_DIR, 'competitor-links.json');
if (!existsSync(linksPath)) {
  writeFileSync(linksPath, '{}', 'utf8');
  console.log('[seed] ✅ Created empty competitor-links.json');
}

// ── action-log.jsonl ──
const logPath = resolve(DATA_DIR, 'action-log.jsonl');
if (!existsSync(logPath)) {
  writeFileSync(logPath, '', 'utf8');
  console.log('[seed] ✅ Created empty action-log.jsonl');
}

// ── catalogs dir ──
const catalogsDir = resolve(DATA_DIR, 'catalogs');
if (!existsSync(catalogsDir)) {
  mkdirSync(catalogsDir, { recursive: true });
  console.log('[seed] ✅ Created catalogs/ dir');
}

console.log('[seed] 🚀 Data directory ready');
