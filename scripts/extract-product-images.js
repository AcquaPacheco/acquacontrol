#!/usr/bin/env node
/**
 * extract-product-images.js
 * Reads the Odoo image export Excel, extracts valid WebP base64 images,
 * saves them to public/images/products/{id}.webp, and patches products.json.
 */

const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const IMAGE_XLSX = path.resolve(
  'C:/Users/acqua/Downloads/Producto (product.template) - 2026-05-13T172342.378.xlsx'
);
const PRODUCTS_JSON = path.resolve(__dirname, '../src/data/products.json');
const OUTPUT_DIR = path.resolve(__dirname, '../public/images/products');

// Ensure output directory exists
fs.mkdirSync(OUTPUT_DIR, { recursive: true });

console.log('Reading image Excel...');
const wb = XLSX.readFile(IMAGE_XLSX, { raw: true, cellText: false });
const ws = wb.Sheets[wb.SheetNames[0]];
const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

console.log(`Total rows: ${rows.length}`);

// Column names from previous analysis: id, image_1920, website_meta_og_img
// The id column contains values like "product.template_1513"
const ID_COL    = 'id';
const IMAGE_COL = 'image_1920';

let saved = 0;
let skippedTrunc = 0;
let skippedEmpty = 0;

// Map: tmplId (string) -> relative web path
const imageMap = {};

for (const row of rows) {
  const rawId    = String(row[ID_COL] || '').trim();
  const rawImage = String(row[IMAGE_COL] || '').trim();

  // Extract numeric ID from e.g. "__export__.product_template_1513_3ed5c773"
  const match = rawId.match(/product_template_(\d+)_/);
  if (!match) continue;
  const tmplId = match[1];

  if (!rawImage) {
    skippedEmpty++;
    continue;
  }

  // Valid WebP base64 starts with "UklGR" (RIFF header after base64 encoding)
  if (!rawImage.startsWith('UklGR')) {
    skippedTrunc++;
    continue;
  }

  // Decode and save
  try {
    const buf = Buffer.from(rawImage, 'base64');
    const outPath = path.join(OUTPUT_DIR, `${tmplId}.webp`);
    fs.writeFileSync(outPath, buf);
    imageMap[tmplId] = `/images/products/${tmplId}.webp`;
    saved++;
  } catch (e) {
    console.warn(`  Error saving ${tmplId}: ${e.message}`);
  }
}

console.log(`\nImages saved:    ${saved}`);
console.log(`Truncated/bad:   ${skippedTrunc}`);
console.log(`Empty:           ${skippedEmpty}`);

// ── Patch products.json ────────────────────────────────────────────────────

console.log('\nPatching products.json...');
const products = JSON.parse(fs.readFileSync(PRODUCTS_JSON, 'utf8'));

let patched = 0;
for (const p of products) {
  const imgPath = imageMap[String(p.id)];
  if (imgPath) {
    p.image = imgPath;
    patched++;
  } else {
    p.image = null;
  }
}

fs.writeFileSync(PRODUCTS_JSON, JSON.stringify(products, null, 2));
console.log(`Patched ${patched} / ${products.length} products with images.`);
console.log('Done!');
