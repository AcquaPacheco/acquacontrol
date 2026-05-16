import { NextRequest, NextResponse } from 'next/server';
import { read, utils } from 'xlsx';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const PRODUCTS_PATH  = resolve(process.cwd(), 'src/data/products.json');
const SUPPLIER_PATH  = resolve(process.cwd(), 'src/data/odoo-supplierinfo.json');
const CONTACTS_PATH  = resolve(process.cwd(), 'src/data/suppliers.json');
const STOCK_PATH     = resolve(process.cwd(), 'src/data/stock.json');

// ─────────────────────────────────────────────────────────────────────────────
// TIPOS
// ─────────────────────────────────────────────────────────────────────────────

interface Product {
  id: string; sku: string | null; name: string;
  cost: number; price: number; margin: number | null;
  image: string | null; supplierName: string | null;
  supplierPrice: number | null; supplierCode: string | null;
  category: string | null; status: string;
  odooId: number | null;   // ID numérico extraído del external ID para URLs de imagen
}

interface OdooProduct {
  si_id: string; tmpl_id: string | null; tmpl_name: string;
  sup_name: string | null; code: string; min_qty: number;
  price: number; discount: number; net_price: number;
}

interface SupplierGroup {
  name: string; slug: string; count: number; products: OdooProduct[];
}

interface Contact {
  id: string; name: string; slug: string;
  phone: string | null; tags: string[];
  fiscalCondition: string | null;
  odooId: number | null;   // ID numérico extraído del external ID para URLs de imagen
}

interface StockItem {
  id: string;            // rowId o external id
  productName: string;   // nombre del producto
  sku: string | null;    // referencia interna / default_code
  qtyAvailable: number;  // stock disponible / qty_available
  qtyReserved: number;   // cantidad reservada
  qtyForecast: number;   // stock previsto / virtual_available
  location: string | null; // ubicación / almacén
  date: string;          // fecha del snapshot (ISO)
  uom: string | null;    // unidad de medida
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/** Normaliza un string de header para comparaciones */
function norm(s: unknown): string {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // quita tildes
    .replace(/[^a-z0-9\s]/g, ' ')                        // no alfanum → espacio
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Detecta en qué columna está un campo buscando por alias.
 * Retorna el primer índice cuyo header sea igual o contenga el alias.
 */
function detectCol(headers: string[], aliases: string[]): number {
  for (const alias of aliases) {
    // Primero: coincidencia exacta
    const exact = headers.findIndex(h => h === alias);
    if (exact !== -1) return exact;
    // Segundo: el header empieza con el alias
    const starts = headers.findIndex(h => h.startsWith(alias));
    if (starts !== -1) return starts;
    // Tercero: contiene el alias
    const contains = headers.findIndex(h => h.includes(alias));
    if (contains !== -1) return contains;
  }
  return -1;
}

/** Parsea un número de una celda Excel (maneja comas, pesos, etc.) */
function parseNum(val: unknown): number {
  if (typeof val === 'number') return val;
  const s = String(val ?? '')
    .replace(/[$%\s]/g, '')
    .replace(',', '.')
    .trim();
  return parseFloat(s) || 0;
}

/**
 * Extrae el ID numérico de Odoo desde un external ID como
 * "__export__.product_template_1513_3ed5c773" → 1513
 * "__export__.res_partner_838_c94aefaf"       → 838
 */
function extractOdooId(externalId: string): number | null {
  const match = externalId.match(/_(\d+)_[a-f0-9]+$/);
  return match ? parseInt(match[1], 10) : null;
}

/** Genera un slug a partir de un nombre */
function toSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

/**
 * Extrae el nombre de un product_tmpl_id con formato "[SKU] Nombre del producto"
 * Si no tiene ese formato, devuelve el string completo.
 */
function extractTmplName(val: string): string {
  const match = val.match(/^\[[^\]]*\]\s*(.*)/);
  return match ? match[1].trim() : val.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// MAPA DE COLUMNAS
// ─────────────────────────────────────────────────────────────────────────────

// Columnas del export de productos de Odoo (product.template)
// Headers reales normalizados: id, default code, name, standard price, list price,
// categ id, seller ids partner id name, seller ids price, seller ids product code, etc.
const PRODUCT_COLS = {
  id:              ['id'],
  sku:             ['default code', 'referencia interna', 'ref interna', 'sku', 'internal reference', 'cod art'],
  name:            ['name', 'nombre', 'descripcion'],
  cost:            ['standard price', 'precio de coste', 'precio costo', 'costo', 'coste'],
  price:           ['list price', 'precio de venta', 'precio venta', 'sales price', 'pvp'],
  supplierName:    ['seller ids partner id name', 'nombre de proveedor', 'proveedor', 'supplier name'],
  supplierPrice:   ['seller ids price', 'precio proveedor', 'precio compra'],
  supplierCode:    ['seller ids product code', 'codigo proveedor', 'ref proveedor'],
  category:        ['categ id', 'categoria interna', 'categoria', 'category'],
};

// Columnas del export de listas de proveedor de Odoo (product.supplierinfo)
// Headers reales: id, partner_id, product_tmpl_id, product_name, product_code, min_qty, price, discount
const SUPPLIERINFO_COLS = {
  siId:     ['id'],
  supName:  ['partner id'],                          // partner_id → proveedor
  tmplId:   ['product tmpl id', 'tmpl id'],          // product_tmpl_id → "[SKU] Nombre"
  name:     ['product name', 'nombre', 'name'],      // product_name (a veces vacío)
  code:     ['product code', 'codigo', 'code'],      // product_code → código del proveedor
  minQty:   ['min qty', 'cant min', 'minimo'],
  price:    ['price', 'precio lista', 'precio'],
  discount: ['discount', 'descuento', 'dto'],
};

// Columnas de listas de precio de un proveedor individual (no Odoo, formato libre)
const SUPPLIER_COLS = {
  code:     ['codigo', 'code', 'cod', 'articulo', 'ref', 'item', 'cod art'],
  name:     ['nombre', 'descripcion', 'articulo', 'name', 'producto', 'detalle', 'denominacion'],
  supName:  ['nombre prov', 'nombre del prov', 'sup name', 'nombre proveedor', 'desc prov'],
  price:    ['precio lista', 'precio bruto', 'precio base', 'p lista', 'pvp', 'lista', 'precio unit'],
  discount: ['descuento', 'dto', 'bonif', 'bonificacion', 'dto %', '% dto', 'desc %'],
  // 'final' cubre el formato Romyl (columna "Final" = precio neto)
  netPrice: ['precio neto', 'p neto', 'neto', 'net price', 'costo neto', 'precio final', 'final'],
  minQty:   ['cant min', 'cantidad min', 'minimo', 'min qty', 'qty min', 'unid min', 'uxb', 'ux b', 'unid x bulto'],
  tmplId:   ['id odoo', 'tmpl id', 'id plantilla', 'odoo id', 'id producto'],
};

// Columnas del export de contactos de Odoo (res.partner)
// Headers reales: id, name, mobile, category_id, l10n_ar_afip_responsibility_type_id, phone, etc.
const CONTACT_COLS = {
  id:     ['id'],
  name:   ['name', 'nombre', 'complete name', 'razon social'],
  phone:  ['mobile', 'phone', 'celular', 'telefono'],
  tags:   ['category id', 'categoria', 'tags', 'etiquetas'],
  fiscal: ['l10n ar afip', 'responsabilidad', 'condicion fiscal', 'afip'],
};

// Columnas del export de stock de Odoo (stock.quant o product.product)
// stock.quant:   product_id viene como "[SKU] Nombre del producto"
// product.product: columnas id, name, qty_available, display_name, barcode, outgoing_qty
const STOCK_COLS = {
  id:           ['id'],
  name:         ['product id', 'display name', 'nombre'],               // stock.quant: product_id | product.product: display_name o name
  nameAlt:      ['name'],                                                // fallback: columna "name" de product.product
  qtyAvailable: ['inventory quantity', 'qty available', 'quantity',      // inventory_quantity
                 'cantidad disponible', 'stock disponible', 'disponible', 'cantidad'],
  qtyReserved:  ['reserved quantity', 'qty reserved', 'cantidad reservada', 'reservado'],
  qtyForecast:  ['virtual available', 'stock previsto', 'previsto', 'forecasted', 'outgoing qty'],
  location:     ['location id', 'ubicacion', 'location', 'almacen'],
  uom:          ['uom id', 'unidad de medida', 'uom'],
};

// ─────────────────────────────────────────────────────────────────────────────
// TIPO DE RESULTADO
// ─────────────────────────────────────────────────────────────────────────────

type SheetType = 'products' | 'supplierinfo' | 'supplier' | 'contacts' | 'stock';

interface ParseResult {
  type: SheetType;
  rows: Product[] | OdooProduct[] | Contact[] | StockItem[];
  colMap: Record<string, number>;
  headers: string[];
  stats: { total: number; imported: number; skipped: number; warnings: string[] };
  supplierInfo?: { name: string; slug: string };
  // Para supplierinfo agrupado:
  groups?: SupplierGroup[];
}

// ─────────────────────────────────────────────────────────────────────────────
// PARSER: PRODUCTOS (export product.template de Odoo)
// ─────────────────────────────────────────────────────────────────────────────

function parseProductsSheet(rawRows: unknown[][], headerRowIdx = 0): ParseResult {
  const rawHeaders = (rawRows[headerRowIdx] as unknown[]).map(norm);
  const colMap: Record<string, number> = {};
  for (const [field, aliases] of Object.entries(PRODUCT_COLS)) {
    colMap[field] = detectCol(rawHeaders, aliases);
  }

  const products: Product[] = [];
  const warnings: string[] = [];
  let skipped = 0;
  const seenIds = new Set<string>(); // dedup: Odoo repite filas por proveedor

  for (let i = headerRowIdx + 1; i < rawRows.length; i++) {
    const row = rawRows[i] as unknown[];
    const name = colMap.name !== -1 ? String(row[colMap.name] ?? '').trim() : '';
    if (!name) { skipped++; continue; }

    const rawId = colMap.id !== -1 ? String(row[colMap.id] ?? '').trim() : '';
    const id    = rawId || `row_${i}`;

    // Odoo puede repetir el producto si tiene múltiples proveedores → tomar solo primera fila
    if (seenIds.has(id)) { skipped++; continue; }
    seenIds.add(id);

    const cost  = colMap.cost  !== -1 ? parseNum(row[colMap.cost])  : 0;
    const price = colMap.price !== -1 ? parseNum(row[colMap.price]) : 0;
    const margin = (cost > 0 && price > 1)
      ? parseFloat((((price - cost) / price) * 100).toFixed(2))
      : null;

    // Status basado en datos reales (Spanish values para compatibilidad con la UI)
    let status: string;
    if (cost === 0)        status = 'sin_costo';
    else if (price <= 1)   status = 'revisar';     // precio placeholder ($1 en Odoo = sin precio real)
    else if (margin !== null && margin < 35) status = 'critico';
    else                   status = 'activo';

    if (cost === 0 && price === 0) warnings.push(`Fila ${i + 1} — "${name}": sin costo ni precio`);

    products.push({
      id,
      sku:           colMap.sku           !== -1 ? String(row[colMap.sku]           ?? '').trim() || null : null,
      name,
      cost,
      price,
      margin,
      image:         null, // base64 en Excel es inmanejable — se usa odooId para URL de imagen
      supplierName:  colMap.supplierName  !== -1 ? String(row[colMap.supplierName]  ?? '').trim() || null : null,
      supplierPrice: colMap.supplierPrice !== -1 ? parseNum(row[colMap.supplierPrice]) || null : null,
      supplierCode:  colMap.supplierCode  !== -1 ? String(row[colMap.supplierCode]  ?? '').trim() || null : null,
      category:      colMap.category      !== -1 ? String(row[colMap.category]      ?? '').trim() || null : null,
      status,
      odooId:        extractOdooId(id),
    });
  }

  return {
    type:    'products',
    rows:    products,
    colMap,
    headers: rawHeaders,
    stats:   { total: rawRows.length - headerRowIdx - 1, imported: products.length, skipped, warnings },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PARSER: SUPPLIERINFO (export product.supplierinfo de Odoo — todos los proveedores)
// ─────────────────────────────────────────────────────────────────────────────

function parseSupplierinfoSheet(rawRows: unknown[][], headerRowIdx = 0): ParseResult {
  const rawHeaders = (rawRows[headerRowIdx] as unknown[]).map(norm);
  const colMap: Record<string, number> = {};
  for (const [field, aliases] of Object.entries(SUPPLIERINFO_COLS)) {
    colMap[field] = detectCol(rawHeaders, aliases);
  }

  const products: OdooProduct[] = [];
  const warnings: string[] = [];
  let skipped = 0;

  for (let i = headerRowIdx + 1; i < rawRows.length; i++) {
    const row = rawRows[i] as unknown[];

    // El nombre del producto viene de product_name o se extrae de product_tmpl_id
    let tmplName = '';
    if (colMap.name !== -1) tmplName = String(row[colMap.name] ?? '').trim();
    if (!tmplName && colMap.tmplId !== -1) {
      tmplName = extractTmplName(String(row[colMap.tmplId] ?? ''));
    }
    if (!tmplName) { skipped++; continue; }

    const supName  = colMap.supName  !== -1 ? String(row[colMap.supName]  ?? '').trim() || null : null;
    const price    = colMap.price    !== -1 ? parseNum(row[colMap.price])    : 0;
    const discount = colMap.discount !== -1 ? parseNum(row[colMap.discount]) : 0;
    const netPrice = price > 0
      ? parseFloat((price * (1 - discount / 100)).toFixed(2))
      : 0;

    products.push({
      si_id:     colMap.siId   !== -1 ? String(row[colMap.siId]   ?? '').trim() || `row_${i}` : `row_${i}`,
      tmpl_id:   colMap.tmplId !== -1 ? String(row[colMap.tmplId] ?? '').trim() || null : null,
      tmpl_name: tmplName,
      sup_name:  supName,
      code:      colMap.code   !== -1 ? String(row[colMap.code]   ?? '').trim() : '',
      min_qty:   colMap.minQty !== -1 ? parseNum(row[colMap.minQty]) || 1 : 1,
      price,
      discount,
      net_price: netPrice,
    });
  }

  if (products.length === 0) {
    warnings.push('No se encontraron filas válidas. Verificá el formato del archivo.');
  }

  // Agrupar por proveedor (sup_name / partner_id)
  const groupMap = new Map<string, OdooProduct[]>();
  for (const p of products) {
    const key = p.sup_name || 'Sin proveedor';
    if (!groupMap.has(key)) groupMap.set(key, []);
    groupMap.get(key)!.push(p);
  }

  const groups: SupplierGroup[] = Array.from(groupMap.entries())
    .map(([name, prods]) => ({ name, slug: toSlug(name), count: prods.length, products: prods }))
    .sort((a, b) => b.count - a.count);

  return {
    type:    'supplierinfo',
    rows:    products,
    colMap,
    headers: rawHeaders,
    stats:   { total: rawRows.length - headerRowIdx - 1, imported: products.length, skipped, warnings },
    groups,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PARSER: LISTA DE PROVEEDOR INDIVIDUAL (formato libre, no Odoo)
// ─────────────────────────────────────────────────────────────────────────────

function parseSupplierSheet(
  rawRows: unknown[][],
  supplierName: string,
  supplierSlug: string,
  headerRowIdx = 0,
): ParseResult {
  const rawHeaders = (rawRows[headerRowIdx] as unknown[]).map(norm);
  const colMap: Record<string, number> = {};
  for (const [field, aliases] of Object.entries(SUPPLIER_COLS)) {
    colMap[field] = detectCol(rawHeaders, aliases);
  }

  const products: OdooProduct[] = [];
  const warnings: string[] = [];
  let skipped = 0;

  for (let i = headerRowIdx + 1; i < rawRows.length; i++) {
    const row = rawRows[i] as unknown[];
    const name = colMap.name !== -1 ? String(row[colMap.name] ?? '').trim() : '';
    if (!name) { skipped++; continue; }

    const price    = colMap.price    !== -1 ? parseNum(row[colMap.price])    : 0;
    const discount = colMap.discount !== -1 ? parseNum(row[colMap.discount]) : 0;

    let netPrice = colMap.netPrice !== -1 ? parseNum(row[colMap.netPrice]) : 0;
    if (netPrice === 0 && price > 0) {
      netPrice = parseFloat((price * (1 - discount / 100)).toFixed(2));
    }

    products.push({
      si_id:     `${supplierSlug}_${i}`,
      tmpl_id:   colMap.tmplId  !== -1 ? String(row[colMap.tmplId]  ?? '').trim() || null : null,
      tmpl_name: name,
      sup_name:  supplierName || null,
      code:      colMap.code   !== -1 ? String(row[colMap.code]    ?? '').trim() : '',
      min_qty:   colMap.minQty !== -1 ? parseNum(row[colMap.minQty]) || 1 : 1,
      price,
      discount,
      net_price: netPrice,
    });
  }

  if (products.length === 0) warnings.push('No se encontraron filas válidas. Verificá el formato del archivo.');

  return {
    type:         'supplier',
    rows:         products,
    colMap,
    headers:      rawHeaders,
    stats:        { total: rawRows.length - headerRowIdx - 1, imported: products.length, skipped, warnings },
    supplierInfo: { name: supplierName, slug: supplierSlug },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PARSER: CONTACTOS (export res.partner de Odoo)
// ─────────────────────────────────────────────────────────────────────────────

function parseContactsSheet(rawRows: unknown[][], headerRowIdx = 0): ParseResult {
  const rawHeaders = (rawRows[headerRowIdx] as unknown[]).map(norm);
  const colMap: Record<string, number> = {};
  for (const [field, aliases] of Object.entries(CONTACT_COLS)) {
    colMap[field] = detectCol(rawHeaders, aliases);
  }

  const contacts: Contact[] = [];
  const warnings: string[] = [];
  let skipped = 0;

  for (let i = headerRowIdx + 1; i < rawRows.length; i++) {
    const row = rawRows[i] as unknown[];
    const name = colMap.name !== -1 ? String(row[colMap.name] ?? '').trim() : '';
    if (!name) { skipped++; continue; }

    // category_id viene como "Tag1,Tag2,Tag3" — lo separamos
    const tagsRaw = colMap.tags !== -1 ? String(row[colMap.tags] ?? '').trim() : '';
    const tags = tagsRaw
      ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean)
      : [];

    const rawId = colMap.id !== -1 ? String(row[colMap.id] ?? '').trim() : '';
    const id    = rawId || `contact_${i}`;

    contacts.push({
      id,
      name,
      slug:            toSlug(name),
      phone:           colMap.phone !== -1 ? String(row[colMap.phone] ?? '').trim() || null : null,
      tags,
      fiscalCondition: colMap.fiscal !== -1 ? String(row[colMap.fiscal] ?? '').trim() || null : null,
      odooId:          extractOdooId(id),
    });
  }

  if (contacts.length === 0) warnings.push('No se encontraron contactos válidos.');

  return {
    type:    'contacts',
    rows:    contacts,
    colMap,
    headers: rawHeaders,
    stats:   { total: rawRows.length - headerRowIdx - 1, imported: contacts.length, skipped, warnings },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PARSER: STOCK (informe de stock de Odoo)
// ─────────────────────────────────────────────────────────────────────────────

/** Extrae el SKU del formato "[SKU] Nombre" */
function extractSkuFromProductId(val: string): string | null {
  const match = val.match(/^\[([^\]]+)\]/);
  return match ? match[1].trim() || null : null;
}

function parseStockSheet(rawRows: unknown[][], date: string, headerRowIdx = 0): ParseResult {
  const rawHeaders = (rawRows[headerRowIdx] as unknown[]).map(norm);
  const colMap: Record<string, number> = {};
  for (const [field, aliases] of Object.entries(STOCK_COLS)) {
    colMap[field] = detectCol(rawHeaders, aliases as string[]);
  }

  const items: StockItem[] = [];
  const warnings: string[] = [];
  let skipped = 0;

  // Soporta tanto stock.quant ("[SKU] Nombre") como product.product (name/display_name)
  for (let i = headerRowIdx + 1; i < rawRows.length; i++) {
    const row = rawRows[i] as unknown[];

    // Intentar con columna principal (product_id / display_name), luego con name
    let rawProductId = colMap.name !== -1 ? String(row[colMap.name] ?? '').trim() : '';
    if (!rawProductId && colMap.nameAlt !== -1) {
      rawProductId = String(row[colMap.nameAlt] ?? '').trim();
    }
    if (!rawProductId) { skipped++; continue; }

    // Extraer nombre y SKU del formato "[SKU] Nombre" (stock.quant) o nombre plano (product.product)
    const productName = extractTmplName(rawProductId);
    const sku         = extractSkuFromProductId(rawProductId);
    if (!productName) { skipped++; continue; }

    const qtyAvailable = colMap.qtyAvailable !== -1 ? parseNum(row[colMap.qtyAvailable]) : 0;
    const qtyReserved  = colMap.qtyReserved  !== -1 ? parseNum(row[colMap.qtyReserved])  : 0;
    const qtyForecast  = colMap.qtyForecast  !== -1 ? parseNum(row[colMap.qtyForecast])  : (qtyAvailable - qtyReserved);

    const rawId = colMap.id !== -1 ? String(row[colMap.id] ?? '').trim() : '';
    const id    = rawId || `stock_row_${i}`;

    items.push({
      id,
      productName,
      sku,
      qtyAvailable,
      qtyReserved,
      qtyForecast,
      location: colMap.location !== -1 ? String(row[colMap.location] ?? '').trim() || null : null,
      uom:      colMap.uom      !== -1 ? String(row[colMap.uom]      ?? '').trim() || null : null,
      date,
    });
  }

  if (items.length === 0) warnings.push('No se encontraron filas de stock válidas. Verificá que el archivo sea el export de stock.quant de Odoo.');

  return {
    type:    'stock',
    rows:    items,
    colMap,
    headers: rawHeaders,
    stats:   { total: rawRows.length - headerRowIdx - 1, imported: items.length, skipped, warnings },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// DETECCIÓN AUTOMÁTICA DEL TIPO DE ARCHIVO
// ─────────────────────────────────────────────────────────────────────────────

function autoDetectType(headers: string[]): SheetType {
  const h = headers.join(' ');

  // stock.quant: tiene inventory_quantity + product_id + location_id (formato Odoo)
  // O tiene qty_available / virtual_available (formato genérico)
  if ((/inventory quantity/.test(h) && /product id/.test(h) && /location id/.test(h)) ||
      /qty available|virtual available|stock previsto|stock disponible/.test(h)) return 'stock';

  // product.supplierinfo: tiene partner_id + product_tmpl_id
  if (/partner id/.test(h) && /product tmpl id/.test(h)) return 'supplierinfo';

  // res.partner: tiene mobile o category_id con l10n_ar
  if (/mobile/.test(h) || /l10n ar afip/.test(h) || /category id/.test(h)) return 'contacts';

  // product.template: tiene standard_price + list_price
  if (/standard price/.test(h) && /list price/.test(h)) return 'products';

  // Heurísticas genéricas
  const hasCost     = /coste|costo|standard/.test(h);
  const hasListPx   = /precio.?venta|list.?price|sales.?price/.test(h);
  const hasDiscount = /\bdto\b|descuento|bonif|discount/.test(h);

  if (hasCost && hasListPx) return 'products';
  if (hasDiscount) return 'supplier';

  // Lista de proveedor en formato libre (ej. Romyl: "codigo | descripcion | uxb | final")
  // Si tiene "codigo" o "articulo" junto con "final", "neto", "precio" → proveedor individual
  const hasCode  = /\bcodigo\b|\barticulo\b|\bcod\b/.test(h);
  const hasPrice = /\bfinal\b|\bneto\b|\blista\b|\bprecio\b/.test(h);
  if (hasCode && hasPrice) return 'supplier';

  return 'products';
}

// ─────────────────────────────────────────────────────────────────────────────
// BUSCAR FILA DE HEADERS
// ─────────────────────────────────────────────────────────────────────────────

function findHeaderRow(rows: unknown[][]): number {
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const row = rows[i] as unknown[];
    const nonEmpty = row.filter(c => String(c ?? '').trim().length > 1).length;
    if (nonEmpty >= 3) return i;
  }
  return 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// HANDLER PRINCIPAL
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ ok: false, error: 'No se recibió ningún archivo' }, { status: 400 });
    }

    const buffer   = Buffer.from(await file.arrayBuffer());
    const workbook = read(buffer, { type: 'buffer', cellDates: true });

    const results: ParseResult[] = [];

    // Parámetros opcionales del form
    const typeParam         = (formData.get('type') as string | null)?.toLowerCase() as SheetType | null;
    const supplierNameParam = (formData.get('supplierName') as string | null)?.trim() ?? '';
    const supplierSlugParam = (formData.get('supplierSlug') as string | null)?.trim() ?? toSlug(supplierNameParam);
    const dryRun            = formData.get('dryRun') === 'true';
    // Fecha del snapshot de stock (default: hoy)
    const stockDate         = (formData.get('stockDate') as string | null)?.trim()
                              ?? new Date().toISOString().split('T')[0];

    for (const sheetName of workbook.SheetNames) {
      const sheet   = workbook.Sheets[sheetName];
      const rawRows = utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', blankrows: false });

      if (rawRows.length < 2) continue;

      const headerIdx    = findHeaderRow(rawRows);
      const headers      = (rawRows[headerIdx] as unknown[]).map(norm);
      const detectedType = typeParam ?? autoDetectType(headers);

      if (detectedType === 'products') {
        results.push(parseProductsSheet(rawRows, headerIdx));

      } else if (detectedType === 'supplierinfo') {
        results.push(parseSupplierinfoSheet(rawRows, headerIdx));

      } else if (detectedType === 'supplier') {
        const supName = supplierNameParam || sheetName;
        const supSlug = supplierSlugParam || toSlug(supName);
        results.push(parseSupplierSheet(rawRows, supName, supSlug, headerIdx));

      } else if (detectedType === 'contacts') {
        results.push(parseContactsSheet(rawRows, headerIdx));

      } else if (detectedType === 'stock') {
        results.push(parseStockSheet(rawRows, stockDate, headerIdx));
      }
    }

    if (results.length === 0) {
      return NextResponse.json({ ok: false, error: 'El archivo no tiene hojas con datos válidos' }, { status: 400 });
    }

    // ── Vercel: filesystem read-only, solo permitir dryRun ───────────────────
    if (!dryRun && (process.env.VERCEL === '1' || process.env.VERCEL_ENV)) {
      return NextResponse.json(
        {
          ok: false,
          isVercel: true,
          error: 'La importación directa no está disponible en producción (Vercel, sistema de solo-lectura). Usá la función "Comparar listas" para analizar diferencias, o importá desde tu entorno local.',
        },
        { status: 503 },
      );
    }

    // ── dryRun: preview sin escribir ─────────────────────────────────────────
    if (dryRun) {
      return NextResponse.json({
        ok:     true,
        dryRun: true,
        sheets: results.map(r => ({
          type:         r.type,
          stats:        r.stats,
          supplierInfo: r.supplierInfo,
          detectedCols: r.colMap,
          headers:      r.headers,
          sample:       r.rows.slice(0, 5),
          // Para supplierinfo mostrar cuántos proveedores se detectaron
          ...(r.type === 'supplierinfo' && r.groups
            ? { groupCount: r.groups.length, groupSample: r.groups.slice(0, 3).map(g => ({ name: g.name, count: g.count })) }
            : {}),
        })),
      });
    }

    // ── Escribir a disco ─────────────────────────────────────────────────────
    const written: Record<string, number> = {};

    for (const result of results) {
      if (result.type === 'products') {
        const products = result.rows as Product[];
        writeFileSync(PRODUCTS_PATH, JSON.stringify(products, null, 2), 'utf8');
        written.products = products.length;

      } else if (result.type === 'supplierinfo') {
        // Reemplaza todo el supplierinfo con los grupos del export
        const groups = result.groups ?? [];
        writeFileSync(SUPPLIER_PATH, JSON.stringify(groups, null, 2), 'utf8');
        written.supplierinfo = groups.length;
        written.supplierinfo_products = result.rows.length;

        // Auto-generar contactos básicos desde los nombres de proveedor del supplierinfo
        // (evita necesitar un export res.partner separado)
        const existingContacts: Contact[] = (() => {
          try { return JSON.parse(readFileSync(CONTACTS_PATH, 'utf8')) as Contact[]; } catch { return []; }
        })();
        const existingSlugs = new Set(existingContacts.map(c => c.slug));
        const newContacts = groups
          .filter(g => g.name && !existingSlugs.has(g.slug))
          .map(g => ({
            id:              `si_${g.slug}`,
            name:            g.name,
            slug:            g.slug,
            phone:           null,
            tags:            [],
            fiscalCondition: null,
            odooId:          null,
          } as Contact));
        if (newContacts.length > 0) {
          const merged = [...existingContacts, ...newContacts].sort((a, b) => a.name.localeCompare(b.name));
          writeFileSync(CONTACTS_PATH, JSON.stringify(merged, null, 2), 'utf8');
          written.contacts_auto = newContacts.length;
        }

      } else if (result.type === 'supplier') {
        // Un proveedor individual: replace o append en odoo-supplierinfo.json
        const existing: SupplierGroup[] = JSON.parse(readFileSync(SUPPLIER_PATH, 'utf8'));
        const group: SupplierGroup = {
          name:     result.supplierInfo!.name,
          slug:     result.supplierInfo!.slug,
          count:    result.rows.length,
          products: result.rows as OdooProduct[],
        };
        const idx = existing.findIndex(s => s.slug === group.slug || s.name === group.name);
        if (idx !== -1) existing[idx] = group;
        else existing.push(group);
        existing.sort((a, b) => b.count - a.count);
        writeFileSync(SUPPLIER_PATH, JSON.stringify(existing, null, 2), 'utf8');
        written.supplier = group.count;

      } else if (result.type === 'contacts') {
        // Reemplaza suppliers.json con los contactos del export
        const contacts = result.rows as Contact[];
        writeFileSync(CONTACTS_PATH, JSON.stringify(contacts, null, 2), 'utf8');
        written.contacts = contacts.length;

      } else if (result.type === 'stock') {
        // REPLACE total del stock (snapshot diario — cada día reemplaza)
        const items = result.rows as StockItem[];
        writeFileSync(STOCK_PATH, JSON.stringify(items, null, 2), 'utf8');
        written.stock = items.length;
      }
    }

    const summary = results.map(r => ({
      type:         r.type,
      stats:        r.stats,
      supplierInfo: r.supplierInfo,
      ...(r.type === 'supplierinfo' && r.groups
        ? { groups: r.groups.length }
        : {}),
    }));

    return NextResponse.json({ ok: true, written, summary });

  } catch (e) {
    console.error('[import-excel]', e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
