// ─────────────────────────────────────────────────────────────────────────────
// ML LAB ENGINE — Parser · Matcher · Calculator · Consultant · Scenarios
// ─────────────────────────────────────────────────────────────────────────────

import type {
  OdooMLRule, MLPublication, MLLabProduct, MLProductParams, MLCalcResult,
  MLAlert, MLSyncStatus, MLConsultantReport, MLScenario, ScenarioKey,
} from './ml-lab-types';

// ─────────────────────────────────────────────────────────────────────────────
// UTILS
// ─────────────────────────────────────────────────────────────────────────────

export function parseNum(v: unknown): number {
  if (typeof v === 'number') return isNaN(v) ? 0 : v;
  const s = String(v ?? '').trim().replace(/[$%\s]/g, '');
  // Spanish format: "1.234,56"
  if (s.includes(',') && s.lastIndexOf(',') > s.lastIndexOf('.')) {
    return parseFloat(s.replace(/\./g, '').replace(',', '.')) || 0;
  }
  // "1.234" (thousands dot, no decimals)
  if (/^\d+\.\d{3}$/.test(s)) return parseInt(s.replace('.', ''), 10);
  return parseFloat(s) || 0;
}

function normalizeStr(s: string): string {
  return (s ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeSku(s: string): string {
  return (s ?? '').trim().toLowerCase().replace(/\s+/g, '');
}

/**
 * Returns the "core" of a SKU by stripping common brand prefixes used in Odoo
 * (V-, M-, MAV-, MAK-, AJP-, BVL-, etc.) and removing dashes/spaces.
 * Allows matching "V-101000" ↔ "101000" and "M-9400" ↔ "9400".
 */
function skuCore(s: string): string {
  return (s ?? '').trim().toLowerCase()
    .replace(/^(v-|m-|mav-|mak-|ajp-|bvl-|kr-|reg-|ag-)/, '') // strip brand prefix
    .replace(/^0+(?=\d)/, '')                                    // strip leading zeros (00001257→1257)
    .replace(/[\s'\-]/g, '');
}

/** True if two SKUs match either exactly or after stripping brand prefixes */
function skuMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  const na = normalizeSku(a), nb = normalizeSku(b);
  if (na === nb) return true;
  const ca = skuCore(a), cb = skuCore(b);
  return ca.length >= 3 && ca === cb;
}

/** Jaccard similarity on word sets (words length ≥ 3) */
function nameSimilarity(a: string, b: string): number {
  const wa = new Set(normalizeStr(a).split(' ').filter(w => w.length >= 3));
  const wb = new Set(normalizeStr(b).split(' ').filter(w => w.length >= 3));
  if (wa.size === 0 || wb.size === 0) return 0;
  const inter = [...wa].filter(w => wb.has(w)).length;
  const union = new Set([...wa, ...wb]).size;
  return inter / union;
}

function detectCol(headers: string[], candidates: string[]): number {
  const norm = headers.map(normalizeStr);
  for (const c of candidates) {
    const idx = norm.findIndex(h => h.includes(normalizeStr(c)));
    if (idx !== -1) return idx;
  }
  return -1;
}

function uid(): string {
  return Math.random().toString(36).slice(2, 11);
}

function roundToN(price: number, n: number): number {
  if (n <= 0) return Math.ceil(price);
  return Math.ceil(price / n) * n;
}

// ─────────────────────────────────────────────────────────────────────────────
// COLUMN MAPS (orden de preferencia)
// ─────────────────────────────────────────────────────────────────────────────

const ODOO_COLS = {
  id:             ['product_template_id', 'ID', 'id externo', 'external id', 'id plantilla'],
  sku:            ['referencia interna', 'referencia', 'internal reference', 'sku', 'ref', 'codigo'],
  barcode:        ['codigo de barras', 'barcode', 'ean', 'gtin'],
  name:           ['nombre', 'name', 'producto', 'product', 'descripcion'],
  markup:         ['recargo de precio', 'markup', 'factor de precio', 'porcentaje', 'descuento', 'price surcharge', 'factor', 'precio recargo', 'incremento'],
  computedPrice:  ['precio calculado', 'precio', 'price', 'computed price', 'precio final'],
  category:       ['categoria', 'category'],
};

const ML_COLS = {
  mlItemId:       ['id item', 'item id', 'id publicacion', 'id', 'mla', 'numero de publicacion', 'codigo'],
  title:          ['titulo', 'title', 'nombre', 'name', 'producto'],
  price:          ['precio', 'price', 'precio de venta', 'precio publicado'],
  status:         ['estado', 'status'],
  stock:          ['stock disponible', 'stock', 'cantidad disponible', 'available quantity', 'cantidad'],
  sold:           ['unidades vendidas', 'vendidos', 'sold', 'ventas', 'sold quantity'],
  visits:         ['visitas', 'visits'],
  freeShipping:   ['envio gratis', 'free shipping', 'envio', 'tiene envio gratis'],
  hasInstallments:['cuotas sin interes', 'cuotas', 'installments', 'tiene cuotas'],
  isFull:         ['es full', 'full', 'is full'],
  listingType:    ['tipo de publicacion', 'listing type', 'tipo'],
  permalink:      ['url', 'permalink', 'enlace', 'link'],
  sku:            ['referencia del vendedor', 'seller sku', 'referencia interna', 'sku', 'ref'],
  condition:      ['condicion', 'condition'],
  thumbnail:      ['imagen', 'thumbnail', 'foto', 'picture'],
};

// ─────────────────────────────────────────────────────────────────────────────
// PARSERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract numeric product template ID from Odoo external ID string.
 * "__export__.product_template_10767_47d56eb1" → 10767
 */
function extractOdooTemplateId(extId: string): number | undefined {
  const m = String(extId ?? '').match(/product_template_(\d+)/);
  return m ? parseInt(m[1], 10) : undefined;
}

/**
 * Extract SKU and clean name from Odoo product name with prefix.
 * "[M-1039] Sacahojas NEW Original con bolsa" → { sku: "M-1039", name: "Sacahojas NEW Original con bolsa" }
 */
function extractOdooProductName(raw: string): { sku: string | undefined; name: string } {
  const m = String(raw ?? '').trim().match(/^\[([^\]]+)\]\s*(.+)$/);
  if (m) return { sku: m[1].trim(), name: m[2].trim() };
  return { sku: undefined, name: String(raw ?? '').trim() };
}

/**
 * Detect Odoo pricelist export format.
 * Identified by header "item_ids/product_tmpl_id" in any column.
 */
function isOdooPricelistFormat(headers: string[]): boolean {
  return headers.some(h => h.includes('item_ids/product_tmpl_id'));
}

/**
 * Inspect the raw headers from an Odoo export and return debug info.
 * Used by the ImportTab to show what was detected.
 */
export function inspectOdooHeaders(rows: unknown[][]): {
  isPricelist: boolean;
  isPrintFormat: boolean;
  allHeaders: string[];
  markupCol: string | null;
  nameCol: string | null;
  skuCol: string | null;
  rowCount: number;
} {
  if (rows.length < 1) return { isPricelist: false, isPrintFormat: false, allHeaders: [], markupCol: null, nameCol: null, skuCol: null, rowCount: 0 };
  const headers = rows[0].map(h => String(h ?? ''));
  const isPricelist  = isOdooPricelistFormat(headers);
  const isPrintFormat = isOdooPrintFormat(rows);

  // Markup column candidates (in priority order — Odoo renames this across versions)
  const MARKUP_CANDIDATES = [
    'item_ids/price_markup',    // custom Odoo / some versions
    'item_ids/price_discount',  // standard Odoo field (confusingly named, stores markup %)
    'item_ids/percent_price',   // old Odoo 12/13
    'item_ids/price_surcharge', // flat surcharge (not %, but fallback)
    'item_ids/margen_de_ganancia',
  ];
  const markupCol = MARKUP_CANDIDATES.find(c => headers.some(h => h.toLowerCase() === c.toLowerCase())) ?? null;

  return {
    isPricelist,
    isPrintFormat,
    allHeaders: headers,
    markupCol: isPrintFormat ? '(texto: "X % utilidad sobre el costo")' : markupCol,
    nameCol: headers.find(h => h === 'item_ids/product_tmpl_id') ?? null,
    skuCol:  headers.find(h => h.toLowerCase().includes('referencia') || h.toLowerCase().includes('sku')) ?? null,
    rowCount: rows.length - 1,
  };
}

/**
 * Detect Odoo pricelist PRINT/REPORT format.
 * Identified by a cell containing "X % utilidad sobre el costo" pattern.
 * This is what Odoo exports when you print/export the pricelist report view.
 */
function isOdooPrintFormat(rows: unknown[][]): boolean {
  for (const row of rows.slice(0, 40)) {
    for (const cell of row) {
      if (/\d+[.,]?\d*\s*%\s*(utilidad|markup|margen)/i.test(String(cell ?? ''))) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Parse Odoo pricelist print format.
 * Each product row has:
 *   Col A: "[SKU] Product Name"   OR   "Product Name"
 *   Col B: "105 % utilidad sobre el costo (%) en costo del producto"
 *   Col C: "0,00"  (fixed surcharge — usually 0)
 */
function parseOdooPrintFormat(rows: unknown[][]): OdooMLRule[] {
  const results: OdooMLRule[] = [];

  // Words that indicate metadata rows (not products)
  const META_RE = /^(mercado libre|moneda|empresa|grupos de paises|reglas de precio|comercio electronico|aplicar en|precio|acqua pacheco|ars$|pagina|\d+\s*\/\s*\d+)/i;

  for (const row of rows) {
    let markupRaw = 0;
    let productName = '';
    let fixedFee = 0;

    for (const cell of row) {
      const s = String(cell ?? '').trim();
      if (!s) continue;

      // ① Detect markup: "105 % utilidad sobre el costo"
      const mUtilidad = s.match(/([\d.,]+)\s*%\s*(utilidad|markup|margen)/i);
      if (mUtilidad && markupRaw === 0) {
        markupRaw = parseNum(mUtilidad[1]);
        continue;
      }

      // ② Detect fixed fee: small number like "0,00" or "1525"
      if (markupRaw > 0 && /^[\d.,]+$/.test(s) && fixedFee === 0) {
        const n = parseNum(s);
        if (n >= 0 && n < 100000) fixedFee = n;
        continue;
      }

      // ③ Detect product name: not metadata, not a pure number
      if (!productName && s.length > 3 && !META_RE.test(s) && !/^\d+[.,]?\d*$/.test(s)) {
        productName = s;
      }
    }

    if (markupRaw > 0 && productName) {
      const { sku, name } = extractOdooProductName(productName);
      if (name) {
        results.push({
          sku,
          name,
          markup: markupRaw,
          raw: { _fixedFee: fixedFee },
        } as OdooMLRule);
      }
    }
  }

  return results;
}

/** Parse raw XLSX rows (header row + data rows) into OdooMLRule[] */
export function parseOdooRows(rows: unknown[][]): OdooMLRule[] {
  if (rows.length < 2) return [];
  const headers = rows[0].map(h => String(h ?? ''));

  // ── Odoo pricelist PRINT/REPORT format (highest priority) ────────────────
  // Detected by "X % utilidad sobre el costo" pattern anywhere in first 40 rows
  if (isOdooPrintFormat(rows)) {
    return parseOdooPrintFormat(rows);
  }

  // ── Odoo pricelist export format ─────────────────────────────────────────
  // Odoo can export the markup/discount % under several column names depending on version:
  //   - item_ids/price_markup   (some custom/v17 builds)
  //   - item_ids/price_discount (standard Odoo model field — stores the "Margen de ganancia" %)
  //   - item_ids/percent_price  (Odoo 12/13 legacy)
  if (isOdooPricelistFormat(headers)) {
    const iExtId  = headers.findIndex(h => h === 'item_ids/product_tmpl_id/id');
    const iName   = headers.findIndex(h => h === 'item_ids/product_tmpl_id');
    // Try all known markup column names in priority order
    const MARKUP_CANDIDATES = [
      'item_ids/price_markup',
      'item_ids/price_discount',
      'item_ids/percent_price',
    ];
    const iMarkup = (() => {
      for (const c of MARKUP_CANDIDATES) {
        const idx = headers.findIndex(h => h.toLowerCase() === c.toLowerCase());
        if (idx >= 0) return idx;
      }
      return -1;
    })();

    // Also try to find a computed/price column as fallback
    const iPriceComputed = headers.findIndex(h =>
      h.toLowerCase().includes('precio_calculado') ||
      h.toLowerCase().includes('computed_price') ||
      h.toLowerCase() === 'item_ids/price'
    );

    // Also find the base (cost/sale_price/etc) column
    const iBase = headers.findIndex(h => h.toLowerCase() === 'item_ids/base');
    const iComputePrice = headers.findIndex(h => h.toLowerCase() === 'item_ids/compute_price');

    return rows.slice(1).flatMap(row => {
      const rawName = String(row[iName] ?? '').trim();
      if (!rawName) return [];

      const { sku, name } = extractOdooProductName(rawName);
      const templateId    = iExtId >= 0 ? extractOdooTemplateId(String(row[iExtId] ?? '')) : undefined;
      const markupRaw     = iMarkup >= 0 ? parseNum(row[iMarkup]) : 0;

      // Detect compute_price type so we interpret the value correctly
      const computeType   = iComputePrice >= 0 ? String(row[iComputePrice] ?? '').toLowerCase() : '';
      const basedOn       = iBase >= 0 ? String(row[iBase] ?? '').toLowerCase() : '';

      let markup = markupRaw;

      // For formula-type rules: price_discount stores "Margen de ganancia %" directly (e.g. 170 = 170%)
      // For percentage-type rules: price_discount is a discount % (negative = surcharge)
      if (computeType === 'percentage' && markup < 0) {
        markup = Math.abs(markup); // negative discount = markup
      }

      // If markup = 0 and we have a computed price, try to derive markup from it
      // (fallback: some exports only have the final price)
      const computedPrice = iPriceComputed >= 0 ? parseNum(row[iPriceComputed]) : 0;

      const rawObj: Record<string, unknown> = {};
      headers.forEach((h, i) => { rawObj[h] = row[i]; });

      return [{
        productTemplateId: templateId,
        sku,
        name,
        markup,
        computedPrice: computedPrice || undefined,
        raw: rawObj,
      }] as OdooMLRule[];
    });
  }

  // ── Generic / legacy format ───────────────────────────────────────────────
  const idx = {
    id:           detectCol(headers, ODOO_COLS.id),
    sku:          detectCol(headers, ODOO_COLS.sku),
    barcode:      detectCol(headers, ODOO_COLS.barcode),
    name:         detectCol(headers, ODOO_COLS.name),
    markup:       detectCol(headers, ODOO_COLS.markup),
    price:        detectCol(headers, ODOO_COLS.computedPrice),
    category:     detectCol(headers, ODOO_COLS.category),
  };

  return rows.slice(1).flatMap(row => {
    const get = (i: number) => (i >= 0 ? String(row[i] ?? '') : '');
    const name = get(idx.name).trim();
    if (!name) return [];

    const rawMarkup = idx.markup >= 0 ? parseNum(row[idx.markup]) : 0;
    const rawPrice  = idx.price  >= 0 ? parseNum(row[idx.price])  : 0;

    // markup could be a multiplier (1.5) or a percentage (50)
    let markup = rawMarkup;
    if (rawMarkup > 0 && rawMarkup <= 5 && rawMarkup > 1) {
      markup = (rawMarkup - 1) * 100;
    } else if (rawMarkup < 0) {
      markup = Math.abs(rawMarkup);
    }

    const rawObj: Record<string, unknown> = {};
    headers.forEach((h, i) => { rawObj[h] = row[i]; });

    return [{
      productTemplateId: idx.id >= 0 ? (parseNum(row[idx.id]) || undefined) : undefined,
      sku:       get(idx.sku)     || undefined,
      barcode:   get(idx.barcode) || undefined,
      name,
      markup,
      computedPrice: rawPrice || undefined,
      category:  get(idx.category) || undefined,
      raw: rawObj,
    }] as OdooMLRule[];
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// ML FILE FORMAT DETECTION & PARSING
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Detect ML Seller Center bulk-edit export.
 * Row 0 has English ALL_CAPS keys: ITEM_ID, SKU, TITLE, QUANTITY, PRICE, STATUS …
 * Rows 1-5 are metadata; actual data starts at row 6.
 */
function isMLSellerCenterFormat(rows: unknown[][]): boolean {
  if (rows.length < 2) return false;
  const first = rows[0].map(h => String(h ?? '').toUpperCase());
  return first.includes('ITEM_ID') && first.includes('PRICE') && first.includes('STATUS');
}

/**
 * Parse commission string "14.00% + $1365.00" → { pct: 14, fixed: 1365 }
 * or "14.00%" → { pct: 14, fixed: 0 }
 */
function parseMLFee(s: string): { pct: number; fixed: number } {
  const pctM   = String(s ?? '').match(/([\d.,]+)\s*%/);
  const fixedM = String(s ?? '').match(/\$\s*([\d.,]+)/);
  return {
    pct:   pctM   ? parseFloat(pctM[1])   : 0,
    fixed: fixedM ? parseNum(fixedM[1])   : 0,
  };
}

/**
 * Determine free shipping / Full from SHIPPING_METHOD column.
 * "Mercado Envíos Full" → isFull=true
 * "Envío gratis" in string → freeShipping=true
 */
function parseMLShipping(s: string): { freeShipping: boolean; isFull: boolean } {
  const lower = String(s ?? '').toLowerCase();
  return {
    isFull:      lower.includes('full'),
    freeShipping: lower.includes('gratis') || lower.includes('full'),
  };
}

/** Normalize ML status string to lowercase internal value */
function normalizeMLStatus(s: string): string {
  const lower = String(s ?? '').toLowerCase().trim();
  if (lower.includes('activ')) return 'active';
  if (lower.includes('paus'))  return 'paused';
  if (lower.includes('cerr') || lower.includes('close')) return 'closed';
  return lower || 'unknown';
}

/** Parse raw XLSX rows into MLPublication[] */
export function parseMLRows(rows: unknown[][]): MLPublication[] {
  if (rows.length < 2) return [];

  // ── ML Seller Center bulk-edit format ─────────────────────────────────────
  if (isMLSellerCenterFormat(rows)) {
    // Row 0: English column keys; rows 1-5: metadata; row 6+: data
    const headers = rows[0].map(h => String(h ?? '').toUpperCase());
    const iItemId    = headers.indexOf('ITEM_ID');
    const iSku       = headers.indexOf('SKU');
    const iTitle     = headers.indexOf('TITLE');
    const iQuantity  = headers.indexOf('QUANTITY');
    const iPrice     = headers.indexOf('PRICE');
    const iStatus    = headers.indexOf('STATUS');
    const iCondition = headers.indexOf('CONDITION');
    const iShipping  = headers.indexOf('SHIPPING_METHOD');
    const iFee       = headers.indexOf('FEE_PER_SALE_MARKETPLACE_V2');
    const iListType  = headers.indexOf('LISTING_TYPE_V3');
    const iFinancing = headers.indexOf('COST_OF_FINANCING_MARKETPLACE');
    const iCategory  = headers.indexOf('CATEGORY');

    const dataRows = rows.slice(6); // skip 6 header/metadata rows

    return dataRows.flatMap(row => {
      const get = (i: number) => (i >= 0 ? String(row[i] ?? '') : '');
      const mlItemId = get(iItemId).trim();
      const title    = get(iTitle).trim();
      if (!mlItemId && !title) return [];

      const feeStr      = get(iFee);
      const { pct: commissionPct, fixed: commissionFixed } = parseMLFee(feeStr);
      const shipping    = parseMLShipping(get(iShipping));
      const listType    = get(iListType).trim();
      const hasInstallments = listType.toLowerCase() !== 'no agregar cuotas' && listType !== '';
      const financingPct = iFinancing >= 0 ? parseFloat(String(row[iFinancing] ?? '').replace('%', '').trim()) || 0 : 0;

      const rawObj: Record<string, unknown> = {};
      rows[0].forEach((h, i) => { rawObj[String(h)] = row[i]; });

      return [{
        mlItemId:        mlItemId || `UNKNOWN-${uid()}`,
        title,
        price:           iPrice >= 0    ? parseNum(row[iPrice])    : 0,
        status:          normalizeMLStatus(get(iStatus)),
        stock:           iQuantity >= 0 ? parseNum(row[iQuantity]) : 0,
        sold:            0,    // not in bulk-edit export
        visits:          undefined,
        freeShipping:    shipping.freeShipping,
        hasInstallments,
        isFull:          shipping.isFull,
        listingType:     listType || undefined,
        permalink:       undefined,
        sku:             get(iSku) || undefined,
        condition:       get(iCondition).toLowerCase() || undefined,
        thumbnail:       undefined,
        // Store commission info in raw for the engine to use
        raw: {
          ...rawObj,
          _commissionPct:   commissionPct,
          _commissionFixed: commissionFixed,
          _financingPct:    financingPct,
          _category:        get(iCategory),
        },
      }] as MLPublication[];
    });
  }

  // ── Generic format ────────────────────────────────────────────────────────
  const headers = rows[0].map(h => String(h ?? ''));

  const idx = {
    mlItemId:       detectCol(headers, ML_COLS.mlItemId),
    title:          detectCol(headers, ML_COLS.title),
    price:          detectCol(headers, ML_COLS.price),
    status:         detectCol(headers, ML_COLS.status),
    stock:          detectCol(headers, ML_COLS.stock),
    sold:           detectCol(headers, ML_COLS.sold),
    visits:         detectCol(headers, ML_COLS.visits),
    freeShipping:   detectCol(headers, ML_COLS.freeShipping),
    hasInstallments:detectCol(headers, ML_COLS.hasInstallments),
    isFull:         detectCol(headers, ML_COLS.isFull),
    listingType:    detectCol(headers, ML_COLS.listingType),
    permalink:      detectCol(headers, ML_COLS.permalink),
    sku:            detectCol(headers, ML_COLS.sku),
    condition:      detectCol(headers, ML_COLS.condition),
    thumbnail:      detectCol(headers, ML_COLS.thumbnail),
  };

  const parseBool = (v: unknown) => {
    const s = String(v ?? '').toLowerCase().trim();
    return s === 'true' || s === 'si' || s === 'sí' || s === 'yes' || s === '1' || s === 'x';
  };

  return rows.slice(1).flatMap(row => {
    const get = (i: number) => (i >= 0 ? String(row[i] ?? '') : '');
    const mlItemId = get(idx.mlItemId).trim().replace(/\s+/g, '');
    const title    = get(idx.title).trim();
    if (!mlItemId && !title) return [];

    const rawObj: Record<string, unknown> = {};
    headers.forEach((h, i) => { rawObj[h] = row[i]; });

    return [{
      mlItemId:        mlItemId || `UNKNOWN-${uid()}`,
      title:           title,
      price:           parseNum(row[idx.price]),
      status:          normalizeMLStatus(get(idx.status)),
      stock:           parseNum(row[idx.stock]),
      sold:            parseNum(row[idx.sold]),
      visits:          idx.visits >= 0 ? parseNum(row[idx.visits]) : undefined,
      freeShipping:    idx.freeShipping >= 0 ? parseBool(row[idx.freeShipping]) : false,
      hasInstallments: idx.hasInstallments >= 0 ? parseBool(row[idx.hasInstallments]) : false,
      isFull:          idx.isFull >= 0 ? parseBool(row[idx.isFull]) : false,
      listingType:     get(idx.listingType) || undefined,
      permalink:       get(idx.permalink) || undefined,
      sku:             get(idx.sku)       || undefined,
      condition:       get(idx.condition) || undefined,
      thumbnail:       get(idx.thumbnail) || undefined,
      raw: rawObj,
    }] as MLPublication[];
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// CALCULATOR
// ─────────────────────────────────────────────────────────────────────────────

export function calcProfitability(
  price: number,
  cost: number,
  p: MLProductParams,
): MLCalcResult | null {
  if (price <= 0 || cost <= 0) return null;

  const commission      = price * (p.commission / 100);
  const installments    = price * (p.installmentsCost / 100);
  const advertisingCalc = 0; // advertising applied on netRevenue below
  const fixedFee        = p.fixedFee;
  const shippingCost    = p.shippingCost;

  const depositML = price - commission - fixedFee - installments - shippingCost;

  const revenueBeforeTax = p.isRI ? depositML / 1.21 : depositML;
  const ivaDiscounted    = p.isRI ? depositML - revenueBeforeTax : 0;

  const iibbCost         = revenueBeforeTax * (p.iibb / 100);
  const advertisingCost  = revenueBeforeTax * (p.advertising / 100);
  const otherCosts       = p.otherCosts;

  const netRevenue = revenueBeforeTax - iibbCost - advertisingCost - otherCosts;
  const netProfit  = netRevenue - cost;
  const netMargin  = netRevenue > 0 ? (netProfit / netRevenue) * 100 : -Infinity;
  const markupPct  = cost > 0 ? ((price / 1.21 / cost) - 1) * 100 : 0;

  return {
    price,
    commission,
    fixedFee,
    shippingCost,
    installmentsCost: installments,
    advertisingCost,
    depositML,
    ivaDiscounted,
    revenueBeforeTax,
    iibbCost,
    otherCosts,
    netRevenue,
    cost,
    grossProfit: netRevenue - cost,
    netProfit,
    netMargin,
    markup: markupPct,
    odooListMarkup: price / 1.21,
    status: netMargin >= p.minMargin ? 'rentable'
          : netMargin >= 0           ? 'bajo_margen'
          :                            'pierde',
  };
}

/** Find the ML price that achieves targetMargin. Returns the ideal price. */
export function calcIdealPrice(cost: number, targetMargin: number, p: MLProductParams): number {
  if (cost <= 0) return 0;
  let price = cost * 3;
  for (let i = 0; i < 20; i++) {
    const c    = price * (p.commission / 100 + p.installmentsCost / 100);
    const dep  = price - c - p.fixedFee - p.shippingCost;
    const rev  = p.isRI ? dep / 1.21 : dep;
    const net  = rev * (1 - p.iibb / 100 - p.advertising / 100) - p.otherCosts;
    // we want: net = cost + targetMargin/100 × net → cost = net × (1 - tm)
    // so: target net = cost / (1 - targetMargin/100)
    const targetNet = cost / (1 - targetMargin / 100);
    const targetRev = (targetNet + p.otherCosts) / (1 - p.iibb / 100 - p.advertising / 100);
    const targetDep = p.isRI ? targetRev * 1.21 : targetRev;
    const newPrice  = (targetDep + p.fixedFee + p.shippingCost) / (1 - p.commission / 100 - p.installmentsCost / 100);
    if (Math.abs(newPrice - price) < 1) { price = newPrice; break; }
    price = newPrice;
    void c; void dep; void rev; void net;
  }
  return roundToN(price, p.roundTo);
}

// ─────────────────────────────────────────────────────────────────────────────
// ALERTS
// ─────────────────────────────────────────────────────────────────────────────

export function generateAlerts(product: MLLabProduct, params: MLProductParams): MLAlert[] {
  const alerts: MLAlert[] = [];
  const p = { ...params, ...product.params };

  if (!product.cost || product.cost === 0) {
    alerts.push({ type: 'danger', code: 'sin_costo', message: 'Sin costo — no se puede calcular rentabilidad.', priority: 1 });
  }
  if (product.stock === 0) {
    alerts.push({ type: 'danger', code: 'sin_stock', message: 'Sin stock disponible.', priority: 2 });
  }
  if (product.calc && product.calc.status === 'pierde') {
    alerts.push({ type: 'danger', code: 'pierde', message: `Margen negativo (${product.calc.netMargin.toFixed(1)}%). Estás perdiendo dinero.`, priority: 1 });
  } else if (product.calc && product.calc.status === 'bajo_margen') {
    alerts.push({ type: 'warning', code: 'bajo_margen', message: `Margen ${product.calc.netMargin.toFixed(1)}% bajo el mínimo de ${p.minMargin}%.`, priority: 2 });
  }
  if (product.syncStatus === 'precio_desalineado' && product.mlPrice && product.odooListML) {
    const diff = Math.abs((product.mlPrice - product.odooListML) / product.odooListML) * 100;
    alerts.push({ type: 'warning', code: 'precio_desalineado', message: `Precio ML (${ars(product.mlPrice)}) vs. calculado (${ars(product.odooListML)}) — diferencia ${diff.toFixed(0)}%.`, priority: 3 });
  }
  if (product.mlStatus && product.mlStatus !== 'active' && product.mlStatus !== 'activo') {
    alerts.push({ type: 'info', code: 'no_activa', message: `Publicación ${product.mlStatus} — no visible en ML.`, priority: 4 });
  }
  if (product.syncStatus === 'sin_publicacion') {
    alerts.push({ type: 'info', code: 'sin_publicacion', message: 'Tiene regla de precio Odoo pero no está publicado en ML.', priority: 3 });
  }
  if (product.syncStatus === 'sin_regla_odoo') {
    alerts.push({ type: 'warning', code: 'sin_regla', message: 'Publicado en ML pero sin regla de precio en Odoo.', priority: 2 });
  }
  if (product.mlVisits && product.mlSold !== undefined && product.mlVisits > 50 && product.mlSold === 0) {
    alerts.push({ type: 'warning', code: 'baja_conversion', message: `${product.mlVisits} visitas pero 0 ventas — posible problema de precio o publicación.`, priority: 2 });
  }
  if (product.mlSold !== undefined && product.mlSold > 10 && product.calc && product.calc.status !== 'rentable') {
    alerts.push({ type: 'danger', code: 'vendiendo_sin_margen', message: `${product.mlSold} ventas con margen insuficiente. Revisá urgente.`, priority: 1 });
  }

  return alerts.sort((a, b) => a.priority - b.priority);
}

function ars(n: number) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n);
}

// ─────────────────────────────────────────────────────────────────────────────
// MATCHING ENGINE
// ─────────────────────────────────────────────────────────────────────────────

interface SystemProduct {
  id: string;
  sku: string | null;
  barcode: string | null;
  name: string;
  cost: number;
  price: number;
  stock?: number;
  supplierName: string | null;
  category: string | null;
  image: string | null;
  odooId: number | null;
}

export function matchAndBuild(
  odooRules: OdooMLRule[],
  mlPubs: MLPublication[],
  systemProducts: SystemProduct[],
  globalParams: MLProductParams,
): MLLabProduct[] {
  const now = new Date().toISOString();
  const products: MLLabProduct[] = [];
  const matchedMLIds = new Set<string>();

  // ── Process Odoo rules ────────────────────────────────────────────
  for (const rule of odooRules) {
    // 1. Enrich from system products
    const sys = findSystemProduct(rule, systemProducts);

    const cost  = sys?.cost ?? 0;
    const stock = sys?.stock ?? 0;
    const image = sys?.image ?? undefined;
    const supplier = sys?.supplierName ?? undefined;
    const category = rule.category ?? sys?.category ?? undefined;

    const odooPrice   = cost > 0 && rule.markup > 0 ? cost * (1 + rule.markup / 100) : (rule.computedPrice ?? 0);
    const odooListML  = odooPrice * 1.21;

    // 2. Match ML publication
    let mlPub: MLPublication | null = null;
    let matchMethod = '';
    let confidence = 0;
    let isDuplicate = false;

    // Priority 1: SKU exact match (or exact after stripping brand prefix V-/M-/etc.)
    if (rule.sku) {
      const exact = mlPubs.filter(m => m.sku && skuMatch(m.sku, rule.sku!));
      if (exact.length === 1)    { mlPub = exact[0]; matchMethod = 'sku'; confidence = 97; }
      else if (exact.length > 1) {
        mlPub = exact[0]; matchMethod = 'sku'; confidence = 90; isDuplicate = true;
        // Mark ALL duplicate pubs as matched so they don't appear as "Sin regla Odoo"
        exact.forEach(m => matchedMLIds.add(m.mlItemId));
      }
    }
    // Priority 2: Barcode exact
    if (!mlPub && rule.barcode) {
      const found = mlPubs.find(m => skuMatch(m.sku ?? '', rule.barcode!));
      if (found) { mlPub = found; matchMethod = 'barcode'; confidence = 95; }
    }
    // Priority 3: Odoo product template ID appears in ML SKU
    if (!mlPub && rule.productTemplateId) {
      const idStr = String(rule.productTemplateId);
      const found = mlPubs.find(m => m.sku?.includes(idStr) || m.title?.includes(idStr));
      if (found) { mlPub = found; matchMethod = 'id'; confidence = 85; }
    }
    // Priority 3b: Odoo SKU core appears inside ML SKU or ML title
    // Catches: V-101001 (core="101001") ↔ ML title "Acople Rápido Espigado 1 1/2 - Vulcano 101001"
    //          1257 (core="1257")        ↔ ML sku "00001257"
    if (!mlPub && rule.sku) {
      const core = skuCore(rule.sku);
      if (core.length >= 4) {
        const found = mlPubs.find(m => {
          const mSkuCore = skuCore(m.sku ?? '');
          return mSkuCore === core ||
                 (mSkuCore.length >= 4 && (mSkuCore.includes(core) || core.includes(mSkuCore))) ||
                 normalizeStr(m.title ?? '').replace(/\s/g,'').includes(core);
        });
        if (found) { mlPub = found; matchMethod = 'sku_core'; confidence = 78; }
      }
    }
    // Priority 4: Name similarity
    // ⚠ Only searches ML pubs NOT yet claimed by a higher-priority match on a previous Odoo rule.
    //   This prevents Odoo rule B from stealing an ML pub already matched to rule A via SKU.
    //   Threshold 0.30 (Jaccard): catches long ML titles where extra SEO words dilute the ratio.
    //   Recall boost: if all words of the shorter name appear in the longer title → always matches.
    if (!mlPub) {
      const available = mlPubs.filter(m => !matchedMLIds.has(m.mlItemId));
      const scored = available
        .map(m => {
          const j = nameSimilarity(rule.name, m.title);
          // Recall: fraction of shorter name's words found in longer title
          const wa = new Set(normalizeStr(rule.name).split(' ').filter(w => w.length >= 3));
          const wb = new Set(normalizeStr(m.title).split(' ').filter(w => w.length >= 3));
          const inter = [...wa].filter(w => wb.has(w)).length;
          const recall = Math.min(wa.size, wb.size) > 0
            ? inter / Math.min(wa.size, wb.size) : 0;
          return { m, score: Math.max(j, recall >= 0.80 ? j + 0.05 : 0), jaccard: j };
        })
        .filter(x => x.jaccard >= 0.30)
        .sort((a, b) => b.score - a.score);
      if (scored.length > 0) {
        mlPub = scored[0].m;
        matchMethod = 'nombre';
        confidence = Math.round(scored[0].jaccard * 100);
        if (scored.length > 1 && scored[0].jaccard - scored[1].jaccard < 0.10) isDuplicate = true;
      }
    }

    // Determine sync status
    const syncStatus: MLSyncStatus = determineSyncStatus({
      hasCost: cost > 0,
      hasStock: stock > 0,
      hasMlPub: !!mlPub,
      hasOdooRule: true,
      confidence,
      isDuplicate,
      mlPrice: mlPub?.price,
      odooListML,
    });

    // Calculate profitability — merge actual ML commission if available
    const mergedParams = { ...globalParams };
    // Per-product param overrides (real values from ML Seller Center export)
    const productParamsOverride: Partial<MLProductParams> = {};
    if (mlPub?.freeShipping) {
      mergedParams.shippingCost = estimateShipping();
      productParamsOverride.shippingCost = estimateShipping();
    }
    // Use real commission % and fixed fee from ML Seller Center export (stored in raw)
    const mlCommPct   = mlPub?.raw?._commissionPct as number | undefined;
    const mlCommFixed = mlPub?.raw?._commissionFixed as number | undefined;
    if (mlCommPct   && mlCommPct   > 0) { mergedParams.commission = mlCommPct;   productParamsOverride.commission = mlCommPct; }
    if (mlCommFixed && mlCommFixed > 0) { mergedParams.fixedFee   = mlCommFixed; productParamsOverride.fixedFee   = mlCommFixed; }

    const calc     = mlPub?.price ? calcProfitability(mlPub.price, cost, mergedParams) ?? undefined : undefined;
    const calcIdeal = cost > 0 ? (() => {
      const ip = calcIdealPrice(cost, mergedParams.idealMargin, mergedParams);
      return calcProfitability(ip, cost, mergedParams) ?? undefined;
    })() : undefined;

    const partial: MLLabProduct = {
      id: uid(),
      odooId: rule.productTemplateId,
      sku: rule.sku,
      barcode: rule.barcode,
      name: rule.name,
      cost,
      markup: rule.markup,
      odooPrice,
      odooListML,
      stock,
      category,
      supplier,
      image,
      mlItemId: mlPub?.mlItemId,
      mlTitle: mlPub?.title,
      mlPrice: mlPub?.price,
      mlStatus: mlPub?.status,
      mlStock: mlPub?.stock,
      mlSold: mlPub?.sold,
      mlVisits: mlPub?.visits,
      mlFreeShipping: mlPub?.freeShipping,
      mlHasInstallments: mlPub?.hasInstallments,
      mlIsFull: mlPub?.isFull,
      mlListingType: mlPub?.listingType,
      mlPermalink: mlPub?.permalink,
      mlCondition: mlPub?.condition,
      mlThumbnail: mlPub?.thumbnail,
      syncStatus,
      matchConfidence: confidence,
      matchMethod: matchMethod || undefined,
      // Persist real ML fees per-product so consultant uses them (not just global defaults)
      params: Object.keys(productParamsOverride).length > 0 ? productParamsOverride : undefined,
      calc,
      calcIdeal,
      alerts: [],
      createdAt: now,
      updatedAt: now,
    };
    partial.alerts = generateAlerts(partial, globalParams);
    products.push(partial);

    if (mlPub) matchedMLIds.add(mlPub.mlItemId);
  }

  // ── Unmatched ML publications (no Odoo rule) ──────────────────────
  for (const mlPub of mlPubs) {
    if (matchedMLIds.has(mlPub.mlItemId)) continue;

    // Try to find cost from system products by SKU (with core matching) or name
    const sys = systemProducts.find(p =>
      (mlPub.sku && p.sku && skuMatch(p.sku, mlPub.sku)) ||
      (mlPub.sku && p.barcode && skuMatch(p.barcode, mlPub.sku)) ||
      nameSimilarity(p.name, mlPub.title) > 0.65
    );

    const cost  = sys?.cost ?? 0;
    const stock = sys?.stock ?? 0;
    const mergedParams = { ...globalParams };
    if (mlPub.freeShipping) mergedParams.shippingCost = estimateShipping();
    const mlCommPct2   = mlPub.raw?._commissionPct as number | undefined;
    const mlCommFixed2 = mlPub.raw?._commissionFixed as number | undefined;
    if (mlCommPct2   && mlCommPct2   > 0) mergedParams.commission = mlCommPct2;
    if (mlCommFixed2 && mlCommFixed2 > 0) mergedParams.fixedFee   = mlCommFixed2;

    const calc = cost > 0 ? calcProfitability(mlPub.price, cost, mergedParams) ?? undefined : undefined;

    const partial: MLLabProduct = {
      id: uid(),
      sku: mlPub.sku,
      name: mlPub.title,
      cost,
      markup: 0,
      odooPrice: 0,
      odooListML: 0,
      stock,
      image: sys?.image ?? undefined,
      supplier: sys?.supplierName ?? undefined,
      category: sys?.category ?? undefined,
      mlItemId: mlPub.mlItemId,
      mlTitle: mlPub.title,
      mlPrice: mlPub.price,
      mlStatus: mlPub.status,
      mlStock: mlPub.stock,
      mlSold: mlPub.sold,
      mlVisits: mlPub.visits,
      mlFreeShipping: mlPub.freeShipping,
      mlHasInstallments: mlPub.hasInstallments,
      mlIsFull: mlPub.isFull,
      mlListingType: mlPub.listingType,
      mlPermalink: mlPub.permalink,
      mlCondition: mlPub.condition,
      mlThumbnail: mlPub.thumbnail,
      syncStatus: 'sin_regla_odoo',
      matchConfidence: 0,
      calc,
      alerts: [],
      createdAt: now,
      updatedAt: now,
    };
    partial.alerts = generateAlerts(partial, globalParams);
    products.push(partial);
  }

  return products;
}

function findSystemProduct(rule: OdooMLRule, sysProds: SystemProduct[]): SystemProduct | undefined {
  if (rule.productTemplateId) {
    const found = sysProds.find(p => p.odooId === rule.productTemplateId);
    if (found) return found;
  }
  if (rule.sku) {
    const found = sysProds.find(p => p.sku && skuMatch(p.sku, rule.sku!));
    if (found) return found;
  }
  if (rule.barcode) {
    const found = sysProds.find(p => p.barcode && skuMatch(p.barcode, rule.barcode!));
    if (found) return found;
  }
  // Name fallback
  const best = sysProds
    .map(p => ({ p, score: nameSimilarity(rule.name, p.name) }))
    .filter(x => x.score > 0.7)
    .sort((a, b) => b.score - a.score)[0];
  return best?.p;
}

function determineSyncStatus(opts: {
  hasCost: boolean; hasStock: boolean; hasMlPub: boolean; hasOdooRule: boolean;
  confidence: number; isDuplicate: boolean;
  mlPrice?: number; odooListML: number;
}): MLSyncStatus {
  if (!opts.hasCost) return 'sin_costo';
  if (opts.isDuplicate) return 'duplicado';
  if (!opts.hasMlPub && opts.hasOdooRule) return 'sin_publicacion';
  if (!opts.hasMlPub) return 'error_datos';
  if (!opts.hasStock) return 'sin_stock';
  if (opts.confidence < 50) return 'match_dudoso';

  if (opts.mlPrice && opts.odooListML > 0) {
    const diff = Math.abs((opts.mlPrice - opts.odooListML) / opts.odooListML);
    if (diff > 0.15) return 'precio_desalineado';
  }

  if (opts.confidence < 80) return 'match_dudoso';
  return 'sincronizado';
}

function estimateShipping(): number {
  return 1500; // default shipping cost estimate
}

// ─────────────────────────────────────────────────────────────────────────────
// SCENARIOS
// ─────────────────────────────────────────────────────────────────────────────

const SCENARIO_DEFS: { key: ScenarioKey; label: string; desc: string }[] = [
  { key: 'actual',          label: 'Actual',             desc: 'Sin cambios, condiciones actuales' },
  { key: 'envio_gratis',    label: 'Envío gratis',        desc: 'Absorber el costo de envío en el precio' },
  { key: 'cuotas_6x',       label: '6 cuotas sin int.',  desc: '6 cuotas sin interés (+12.7% a los fees)' },
  { key: 'envio_cuotas',    label: 'Envío + cuotas',     desc: 'Envío gratis + 6 cuotas sin interés' },
  { key: 'pack_x2',         label: 'Pack x2',            desc: 'Publicar 2 unidades juntas' },
  { key: 'pack_x3',         label: 'Pack x3',            desc: 'Publicar 3 unidades juntas' },
  { key: 'precio_agresivo', label: 'Precio agresivo',    desc: 'Margen mínimo para ser competitivo' },
  { key: 'precio_rentable', label: 'Precio rentable',    desc: 'Margen ideal sostenible' },
  { key: 'precio_premium',  label: 'Precio premium',     desc: 'Mayor margen, apuesta a calidad' },
  { key: 'promocion_5pct',  label: 'Promo -5%',         desc: 'Descuento temporal del 5%' },
];

export function generateScenarios(product: MLLabProduct, globalParams: MLProductParams): MLScenario[] {
  const cost = product.cost;
  if (cost <= 0) return [];

  const base = { ...globalParams, ...product.params };
  const currentPrice = product.mlPrice ?? product.odooListML;

  return SCENARIO_DEFS.map(def => {
    const p = { ...base };
    let price = currentPrice;
    let qty = 1;

    switch (def.key) {
      case 'actual':          break;
      case 'envio_gratis':    p.shippingCost = estimateShipping(); break;
      case 'cuotas_6x':       p.installmentsCost = 12.7; break;
      case 'envio_cuotas':    p.shippingCost = estimateShipping(); p.installmentsCost = 12.7; break;
      case 'pack_x2':         qty = 2; break;
      case 'pack_x3':         qty = 3; break;
      case 'precio_agresivo': price = calcIdealPrice(cost, base.minMargin, p); break;
      case 'precio_rentable': price = calcIdealPrice(cost, base.idealMargin, p); break;
      case 'precio_premium':  price = calcIdealPrice(cost, base.idealMargin + 10, p); break;
      case 'promocion_5pct':  price = currentPrice * 0.95; break;
    }

    const effectiveCost = cost * qty;
    if (qty > 1) price = calcIdealPrice(effectiveCost, base.idealMargin, p);

    const calc = price > 0 ? calcProfitability(price, effectiveCost, p) : null;
    const currentCalc = currentPrice > 0 ? calcProfitability(currentPrice, cost, base) : null;

    const recommendedMarkup = calc
      ? (price / 1.21 / effectiveCost - 1) * 100
      : null;

    const vsActualMargin = (calc && currentCalc)
      ? calc.netMargin - currentCalc.netMargin
      : null;

    const competitiveness: MLScenario['competitiveness'] =
      def.key === 'precio_agresivo' || def.key === 'promocion_5pct' ? 'alta' :
      def.key === 'precio_premium' ? 'baja' : 'media';

    const risk: MLScenario['risk'] =
      (calc && calc.netMargin < base.minMargin) ? 'alto' :
      def.key === 'pack_x2' || def.key === 'pack_x3' ? 'medio' : 'bajo';

    const recommended = !!(calc && calc.netMargin >= base.minMargin &&
      (def.key === 'precio_rentable' || def.key === 'envio_gratis' || def.key === 'cuotas_6x'));

    return {
      key: def.key,
      label: def.label,
      description: def.desc,
      calc,
      recommendedMarkup,
      vsActualMargin,
      competitiveness,
      risk,
      recommended,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// CONSULTANT (rule-based)
// ─────────────────────────────────────────────────────────────────────────────

export function generateConsultantReport(
  product: MLLabProduct,
  globalParams: MLProductParams,
  marketAvgPrice?: number,
): MLConsultantReport {
  const p = { ...globalParams, ...product.params };
  const calc = product.calc;
  const cost = product.cost;
  const mlPrice = product.mlPrice ?? 0;

  // 1. Diagnóstico
  let diagnosis = '';
  if (!cost) {
    diagnosis = 'No hay costo cargado. No es posible calcular rentabilidad ni hacer recomendaciones.';
  } else if (!mlPrice) {
    diagnosis = 'Producto sin publicación activa en MercadoLibre. Tiene regla de precio en Odoo pero no hay publicación que analizar.';
  } else if (calc?.status === 'pierde') {
    diagnosis = `El producto está perdiendo dinero. Por cada unidad vendida generás una pérdida neta de ${ars(Math.abs(calc.netProfit))}. El margen actual es ${calc.netMargin.toFixed(1)}%, muy por debajo del mínimo de ${p.minMargin}%.`;
  } else if (calc?.status === 'bajo_margen') {
    diagnosis = `Margen actual de ${calc?.netMargin.toFixed(1)}%, por debajo del objetivo mínimo de ${p.minMargin}%. Estás vendiendo, pero con rentabilidad insuficiente para sostener el negocio.`;
  } else if (calc) {
    diagnosis = `Producto rentable con ${calc.netMargin.toFixed(1)}% de margen neto. Utilidad neta de ${ars(calc.netProfit)} por unidad vendida.`;
  } else {
    diagnosis = 'Sin datos suficientes para diagnóstico.';
  }

  // 2. Mercado
  let marketSituation = '';
  if (marketAvgPrice) {
    const diff = mlPrice > 0 ? ((mlPrice - marketAvgPrice) / marketAvgPrice * 100) : 0;
    if (diff > 15) marketSituation = `Tu precio (${ars(mlPrice)}) está ${diff.toFixed(0)}% por encima del promedio de mercado (${ars(marketAvgPrice)}). Riesgo de poca visibilidad.`;
    else if (diff > 5) marketSituation = `Tu precio está ${diff.toFixed(0)}% sobre el promedio. Podés competir si tu publicación tiene valor diferencial (cuotas, envío gratis, buenas fotos).`;
    else if (diff < -10) marketSituation = `Precio ${Math.abs(diff).toFixed(0)}% por debajo del mercado. Podés subir el precio sin perder ventas.`;
    else marketSituation = `Tu precio está alineado con el mercado (${ars(mlPrice)} vs. promedio ${ars(marketAvgPrice)}).`;
  } else {
    marketSituation = 'No hay datos de mercado disponibles. Usá el scout para obtener precios de competencia antes de decidir.';
  }

  // 3. Problema publicación
  let publicationProblem = '';
  if (product.mlVisits && product.mlVisits > 30 && (product.mlSold ?? 0) === 0) {
    const conv = 0;
    publicationProblem = `Hay ${product.mlVisits} visitas pero 0 ventas. Conversión ${conv.toFixed(1)}%. El precio o las condiciones están ahuyentando compradores.`;
  } else if (product.mlVisits && product.mlSold && product.mlVisits > 0) {
    const conv = (product.mlSold / product.mlVisits) * 100;
    if (conv < 1) publicationProblem = `Conversión baja (${conv.toFixed(1)}%). Revisá foto principal, título y condiciones de venta.`;
    else if (conv > 5) publicationProblem = `Conversión excelente (${conv.toFixed(1)}%). La publicación está funcionando bien.`;
    else publicationProblem = `Conversión normal (${conv.toFixed(1)}%). Hay margen para mejorar con mejor foto o condiciones.`;
  } else if (!product.mlItemId) {
    publicationProblem = 'Sin publicación activa. Si hay demanda, este producto podría generar ventas.';
  } else {
    publicationProblem = 'Sin datos suficientes de visitas/ventas para evaluar la publicación.';
  }

  // 4. Condición — foco en las condiciones que aumentan ventas, no en precio
  let conditionAdvice = '';
  const missingConditions: string[] = [];
  if (!product.mlFreeShipping) missingConditions.push('envío gratis');
  if (!product.mlHasInstallments) missingConditions.push('cuotas sin interés');
  if (missingConditions.length === 2) {
    conditionAdvice = `Sin envío gratis ni cuotas. Estas dos condiciones son las que más impactan la conversión en ML. Antes de cambiar el precio, activá ambas y medí el resultado.`;
  } else if (!product.mlFreeShipping) {
    conditionAdvice = `Tenés cuotas pero sin envío gratis. El envío gratis tiene el mayor impacto individual en la visibilidad y conversión de ML. Evaluá si el margen lo soporta.`;
  } else if (!product.mlHasInstallments) {
    conditionAdvice = `Tenés envío gratis pero sin cuotas. Agregar 3 o 6 cuotas sin interés puede aumentar el ticket de compra. El costo es bajo si el margen lo permite.`;
  } else {
    conditionAdvice = `Envío gratis + cuotas: condiciones fuertes. El foco ahora es la calidad de la publicación: foto principal clara, título con palabras clave y descripción completa.`;
  }

  // 5-7. Precio y markup
  const idealPrice     = cost > 0 ? calcIdealPrice(cost, p.idealMargin, p) : 0;
  const minViablePrice = cost > 0 ? calcIdealPrice(cost, 0, p) : 0; // break-even price

  // Precio recomendado:
  // - Si pierde o bajo margen → subir al precio que logra el margen ideal (o al mercado si alcanza)
  // - Si es rentable → MANTENER el precio actual (la palanca son las condiciones, no el precio)
  let recommendedPriceFinal = idealPrice;
  if (calc?.status === 'pierde' || calc?.status === 'bajo_margen') {
    if (marketAvgPrice && marketAvgPrice > 0) {
      if (marketAvgPrice >= idealPrice) {
        recommendedPriceFinal = idealPrice;       // mercado permite margen ideal
      } else if (marketAvgPrice >= minViablePrice) {
        recommendedPriceFinal = marketAvgPrice;   // al menos break-even
      } else {
        recommendedPriceFinal = idealPrice;       // mostrar el precio necesario aunque esté por encima del mercado
      }
    } else {
      recommendedPriceFinal = idealPrice;
    }
  } else if (mlPrice > 0) {
    // Rentable → mantener precio actual; el trabajo es mejorar condiciones y publicación
    recommendedPriceFinal = mlPrice;
  }
  recommendedPriceFinal = roundToN(recommendedPriceFinal, p.roundTo);

  const idealMarkup     = recommendedPriceFinal > 0 && cost > 0 ? (recommendedPriceFinal / 1.21 / cost - 1) * 100 : 0;
  const idealCalc       = idealPrice > 0 ? calcProfitability(idealPrice, cost, p) : null;
  const recommendedCalc = recommendedPriceFinal > 0 ? calcProfitability(recommendedPriceFinal, cost, p) : idealCalc;

  // 8. Riesgo
  let risk = '';
  let riskLevel: MLConsultantReport['riskLevel'] = 'bajo';
  if (!cost) {
    risk = 'Alto: sin costo no hay control de rentabilidad.';
    riskLevel = 'alto';
  } else if (calc?.status === 'pierde') {
    if (marketAvgPrice && minViablePrice > marketAvgPrice) {
      risk = `Muy alto: el mercado (${ars(marketAvgPrice)}) está por debajo de tu punto de equilibrio (${ars(minViablePrice)}). Evaluá negociar el costo o pausar.`;
    } else {
      risk = 'Muy alto: cada venta genera pérdida. Subí el precio urgente.';
    }
    riskLevel = 'alto';
  } else if (idealPrice > 0 && marketAvgPrice && idealPrice > marketAvgPrice * 1.2) {
    risk = 'Medio: el precio rentable está muy por encima del mercado. Puede ser difícil vender.';
    riskLevel = 'medio';
  } else if (product.stock === 0) {
    risk = 'Medio: sin stock. Si llega un pedido no podés cumplir.';
    riskLevel = 'medio';
  } else {
    risk = 'Bajo: el producto puede operar con margen saludable.';
    riskLevel = 'bajo';
  }

  // 9. Acción principal — condiciones primero, precio solo cuando es urgente
  let trialAction = '';
  if (!mlPrice || !product.mlItemId) {
    const newMkp = recommendedPriceFinal > 0 && cost > 0 ? (recommendedPriceFinal / 1.21 / cost - 1) * 100 : 0;
    trialAction = `Creá la publicación con precio ${ars(recommendedPriceFinal)} (markup ${newMkp.toFixed(1)}%), envío gratis y 6 cuotas sin interés si el margen lo permite.`;
  } else if (calc?.status === 'pierde') {
    if (marketAvgPrice && minViablePrice > marketAvgPrice) {
      trialAction = `El mercado (${ars(marketAvgPrice)}) está por debajo de tu punto de equilibrio (${ars(minViablePrice)}). Negociá mejor costo con el proveedor o pausá el producto.`;
    } else {
      trialAction = `Subí el precio a ${ars(recommendedPriceFinal)} (markup ${idealMarkup.toFixed(1)}%) para dejar de perder dinero. Mantené las demás condiciones.`;
    }
  } else if (calc?.status === 'bajo_margen') {
    trialAction = `Subí el precio a ${ars(recommendedPriceFinal)} (markup ${idealMarkup.toFixed(1)}%) → margen estimado ${recommendedCalc?.netMargin.toFixed(1) ?? '—'}%. El precio actual no cubre los costos adecuadamente.`;
  } else if (missingConditions.length > 0) {
    // Rentable pero le faltan condiciones
    trialAction = `Precio rentable (${calc?.netMargin.toFixed(1)}% margen). La clave para vender más es ${missingConditions.join(' y ')}. Activalos y medí el impacto en visitas en 7 días.`;
  } else {
    // Todo OK → publicación
    trialAction = `Condiciones y precio bien configurados. Mejorá la foto principal (fondo blanco, producto completo), el título (marca + modelo + medida) y la descripción para subir la conversión.`;
  }

  // 10. Qué medir
  const whatToMeasure = 'Visitas diarias, tasa de conversión (ventas/visitas), posición en búsqueda para las palabras clave del producto, y margen neto real por unidad vendida.';

  // Strategy — conditions-first cuando es rentable; precio solo cuando pierde dinero
  const tooExpensiveForMarket = !!(marketAvgPrice && idealPrice > marketAvgPrice * 1.3);
  let strategy: MLConsultantReport['strategy'] = 'mantener';
  let strategyLabel = 'Mantener como está';
  if (!cost) {
    strategy = 'pausar'; strategyLabel = 'Sin costo — completar primero';
  } else if (calc?.status === 'pierde' && tooExpensiveForMarket) {
    strategy = 'pausar'; strategyLabel = 'Evaluar pausar — no da margen';
  } else if (calc?.status === 'pierde') {
    strategy = 'subir_markup'; strategyLabel = 'Subir precio urgente ↑';
  } else if (calc?.status === 'bajo_margen') {
    strategy = 'subir_markup'; strategyLabel = 'Subir precio / markup';
  } else if (!product.mlFreeShipping) {
    // Rentable → conditions-first, no price comparison
    strategy = 'activar_envio_gratis'; strategyLabel = 'Activar envío gratis';
  } else if (!product.mlHasInstallments) {
    strategy = 'activar_cuotas'; strategyLabel = 'Agregar cuotas';
  } else {
    strategy = 'mejorar_publicacion'; strategyLabel = 'Mejorar publicación';
  }

  // Overall score 0-100
  let score = 50;
  if (calc) {
    if (calc.status === 'rentable') score += 25;
    else if (calc.status === 'pierde') score -= 30;
  }
  if (product.mlFreeShipping)    score += 10;
  if (product.mlHasInstallments) score += 5;
  if (product.mlSold && product.mlSold > 10) score += 10;
  if (product.stock > 0) score += 5;
  if (product.syncStatus === 'sincronizado') score += 5;
  score = Math.max(0, Math.min(100, score));

  return {
    diagnosis,
    marketSituation,
    publicationProblem,
    conditionAdvice,
    recommendedPrice: recommendedPriceFinal,
    recommendedMarkup: idealMarkup,
    estimatedMargin: recommendedCalc?.netMargin ?? idealCalc?.netMargin ?? 0,
    risk,
    riskLevel,
    trialAction,
    whatToMeasure,
    strategy,
    strategyLabel,
    overallScore: score,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ODOO EXPORT
// ─────────────────────────────────────────────────────────────────────────────

export function buildOdooExportRows(products: MLLabProduct[], globalParams: MLProductParams): string[][] {
  const headers = [
    'id_odoo', 'sku', 'nombre', 'costo',
    'markup_actual', 'markup_recomendado',
    'precio_ml_actual', 'precio_ml_recomendado',
    'margen_neto_estimado', 'estado_sync',
    'estado_rentabilidad', 'estrategia', 'estado_publicacion', 'fecha_scan',
  ];

  const rows = products.map(p => {
    const params = { ...globalParams, ...p.params };
    const idealPrice  = p.cost > 0 ? calcIdealPrice(p.cost, params.idealMargin, params) : 0;
    const idealMarkup = idealPrice > 0 && p.cost > 0 ? (idealPrice / 1.21 / p.cost - 1) * 100 : 0;
    const calc = p.calc;

    return [
      String(p.odooId ?? ''),
      p.sku ?? '',
      p.name,
      p.cost > 0 ? p.cost.toFixed(2) : '',
      p.markup > 0 ? p.markup.toFixed(2) : '',
      idealMarkup > 0 ? idealMarkup.toFixed(2) : '',
      p.mlPrice ? p.mlPrice.toFixed(2) : '',
      idealPrice > 0 ? idealPrice.toFixed(2) : '',
      calc?.netMargin ? calc.netMargin.toFixed(2) : '',
      p.syncStatus,
      calc?.status ?? '',
      p.alerts[0]?.code ?? 'ok',
      p.mlStatus ?? '',
      new Date().toISOString().split('T')[0],
    ];
  });

  return [headers, ...rows];
}
