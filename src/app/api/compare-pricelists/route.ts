import { NextRequest, NextResponse } from 'next/server';
import { read, utils } from 'xlsx';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const PRODUCTS_PATH = resolve(process.cwd(), 'src/data/products.json');

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function norm(s: unknown): string {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseNum(val: unknown): number {
  if (typeof val === 'number') return isFinite(val) ? val : 0;
  const s = String(val ?? '').replace(/[$%\s ]/g, '').replace(',', '.').trim();
  const n = parseFloat(s);
  return isFinite(n) ? n : 0;
}

function detectCol(headers: string[], aliases: string[]): number {
  for (const alias of aliases) {
    const exact = headers.findIndex(h => h === alias);
    if (exact !== -1) return exact;
    const starts = headers.findIndex(h => h.startsWith(alias));
    if (starts !== -1) return starts;
    const contains = headers.findIndex(h => h.includes(alias));
    if (contains !== -1) return contains;
  }
  return -1;
}

/** Finds first row that looks like a header (≥3 non-trivial cells, many strings) */
function findHeaderRow(rows: unknown[][]): number {
  for (let i = 0; i < Math.min(15, rows.length); i++) {
    const row = rows[i] as unknown[];
    const nonEmpty = row.filter(c => {
      if (c === null || c === undefined || c === '') return false;
      const s = String(c).trim();
      return s.length > 0;
    });
    const strings = nonEmpty.filter(c => typeof c === 'string' && isNaN(Number(c)));
    if (nonEmpty.length >= 3 && strings.length >= 2) return i;
  }
  // Fallback: first row with ≥3 non-empty cells
  for (let i = 0; i < Math.min(15, rows.length); i++) {
    const row = rows[i] as unknown[];
    const nonEmpty = row.filter(c => c !== null && c !== undefined && String(c).trim() !== '');
    if (nonEmpty.length >= 3) return i;
  }
  return 0;
}

/** Find the best numeric column for "price" among a row of data */
function findNumericPriceCol(rows: unknown[][], headerIdx: number, nameIdx: number, codeIdx: number): number {
  // Sample 20 rows to find columns that are consistently numeric and > 100
  const dataRows = rows.slice(headerIdx + 1, Math.min(headerIdx + 30, rows.length));
  const numericCols = new Map<number, { count: number; sum: number }>();

  for (const rawRow of dataRows) {
    const row = rawRow as unknown[];
    for (let ci = 0; ci < row.length; ci++) {
      if (ci === nameIdx || ci === codeIdx) continue;
      const val = parseNum(row[ci]);
      if (val > 50) {
        const prev = numericCols.get(ci) ?? { count: 0, sum: 0 };
        numericCols.set(ci, { count: prev.count + 1, sum: prev.sum + val });
      }
    }
  }

  // Pick the column with the most numeric values and reasonable average (not qty/minQty)
  let best = -1, bestScore = 0;
  for (const [ci, { count, sum }] of numericCols.entries()) {
    const avg = sum / count;
    // A price column should have avg > 100 and appear in most rows
    if (count >= 3 && avg > 100) {
      const score = count * Math.log(avg);
      if (score > bestScore) { bestScore = score; best = ci; }
    }
  }
  return best;
}

// ─────────────────────────────────────────────────────────────────────────────
// UNIVERSAL SUPPLIER EXCEL PARSER
// Handles multiple formats:
//   Romyl:    Codigo | Descripción | UxB | Final
//   Polir:    CODIGO | DESCRIPCION | PRECIO | IMAGEN
//   Veneno:   ART. | DESCRIPCIÓN | CAJA | COMERCIO | PÚBLICO
//   Aquaflex: Producto | Descripción | Precio | (IVA%)
//   Generic:  any spreadsheet with code + name + price columns
// ─────────────────────────────────────────────────────────────────────────────

interface RawItem {
  code: string;
  desc: string;
  price: number;
  uxb: number;
}

interface ParseDiag {
  headerRow: number;
  headers: string[];
  codeCol: number;
  nameCol: number;
  priceCol: number;
  uxbCol: number;
  totalRows: number;
  itemsWithPrice: number;
  itemsNoPrice: number;
}

function parseSupplierExcel(buffer: Buffer): { items: RawItem[]; diag: ParseDiag } {
  const workbook = read(buffer, { type: 'buffer', cellDates: true });
  const items: RawItem[] = [];
  let diag: ParseDiag = {
    headerRow: 0, headers: [], codeCol: -1, nameCol: -1, priceCol: -1, uxbCol: -1,
    totalRows: 0, itemsWithPrice: 0, itemsNoPrice: 0,
  };

  // Try each sheet, return first with data
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rawRows = utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', blankrows: false });
    if (rawRows.length < 3) continue;

    const headerIdx = findHeaderRow(rawRows);
    const headers   = (rawRows[headerIdx] as unknown[]).map(norm);

    // ── Column detection with expanded aliases ────────────────────────────────
    const codeIdx = detectCol(headers, [
      'codigo', 'code', 'cod', 'art', 'articulo', 'ref', 'item', 'c digo', 'nro', 'numero', 'id',
    ]);
    const nameIdx = detectCol(headers, [
      'descripcion', 'nombre', 'articulo', 'name', 'producto', 'detalle', 'denominacion',
      'descripci n', 'desc', 'denom',
    ]);
    const priceIdx = detectCol(headers, [
      // Specific price names first (order matters: most specific → least specific)
      'precio neto', 'precio final', 'precio lista', 'precio bruto', 'precio base', 'precio unit',
      'final', 'neto', 'p neto', 'p lista',
      // Trade/wholesale prices (Veneno-style: COMERCIO)
      'comercio', 'mayorista', 'distrib', 'precio distribuidor', 'precio cliente',
      // Generic
      'precio', 'price', 'pvp', 'lista', 'importe',
    ]);
    const uxbIdx = detectCol(headers, [
      'uxb', 'ux b', 'unid x bulto', 'cant min', 'minimo', 'caja', 'bulto', 'x caja',
    ]);

    // If neither code nor name detected, skip this sheet
    if (codeIdx === -1 && nameIdx === -1) continue;

    // If no price column detected, try heuristic
    let effectivePriceIdx = priceIdx;
    if (priceIdx === -1) {
      effectivePriceIdx = findNumericPriceCol(rawRows, headerIdx, nameIdx, codeIdx);
    }

    diag = { headerRow: headerIdx, headers, codeCol: codeIdx, nameCol: nameIdx, priceCol: effectivePriceIdx, uxbCol: uxbIdx, totalRows: 0, itemsWithPrice: 0, itemsNoPrice: 0 };

    let itemsWithPrice = 0, itemsNoPrice = 0, totalRows = 0;

    for (let i = headerIdx + 1; i < rawRows.length; i++) {
      const row = rawRows[i] as unknown[];
      const rawCode = codeIdx !== -1 ? row[codeIdx] : null;
      const rawName = nameIdx !== -1 ? String(row[nameIdx] ?? '').trim() : '';

      // Skip section headers: text-only rows, or Romyl-style "002 - NOVEDADES"
      if (rawName && !rawCode && typeof rawCode !== 'number') continue;
      if (typeof rawCode === 'string' && /^00\d/.test(rawCode.trim())) continue;
      if (!rawName) continue;

      const code = String(rawCode ?? i).trim(); // fallback: use row index as code
      const price = effectivePriceIdx !== -1 ? parseNum(row[effectivePriceIdx]) : 0;
      const uxb   = uxbIdx !== -1 ? parseNum(row[uxbIdx]) : 1;

      totalRows++;
      if (price > 0) {
        itemsWithPrice++;
        items.push({ code, desc: rawName, price, uxb: uxb || 1 });
      } else {
        itemsNoPrice++;
        // Include with price=0 so we know about unpriced items
        items.push({ code, desc: rawName, price: 0, uxb: uxb || 1 });
      }
    }

    diag.totalRows      = totalRows;
    diag.itemsWithPrice = itemsWithPrice;
    diag.itemsNoPrice   = itemsNoPrice;

    if (items.length > 0) break;
  }

  return { items, diag };
}

// ─────────────────────────────────────────────────────────────────────────────
// CLUSTER DETECTION
// ─────────────────────────────────────────────────────────────────────────────

interface ClusterInfo {
  pct: number;
  count: number;
  hint: 'adjustment' | 'promo' | 'individual';
  label: string;
}

function detectClusters(changes: Array<{ pct: number }>): ClusterInfo[] {
  const buckets = new Map<number, number>();
  for (const c of changes) {
    const key = Math.round(c.pct);
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  const clusters: ClusterInfo[] = [];
  for (const [pct, count] of buckets.entries()) {
    if (count < 3) continue;
    let hint: ClusterInfo['hint'];
    let label: string;
    if (count >= 15) {
      hint  = 'adjustment';
      label = `Ajuste en bloque (${pct > 0 ? '+' : ''}${pct}%) — ${count} productos`;
    } else {
      hint  = 'promo';
      label = `Grupo coordinado (${pct > 0 ? '+' : ''}${pct}%) — ${count} productos`;
    }
    clusters.push({ pct, count, hint, label });
  }
  return clusters.sort((a, b) => Math.abs(b.count) - Math.abs(a.count));
}

// ─────────────────────────────────────────────────────────────────────────────
// TIPOS
// ─────────────────────────────────────────────────────────────────────────────

export interface DiffItem {
  code: string;
  desc: string;
  oldPrice: number;    // current cost in system (products.json)
  newPrice: number;    // new price from supplier list
  delta: number;
  pct: number;
  uxb: number;
  clusterPct?: number;
  clusterHint?: ClusterInfo['hint'];
  suspicious: boolean;
  inSystem: boolean;
  productId?: string;
  odooId?: number | null;
  productName?: string;
  currentSalePrice?: number;
  currentMargin?: number;
  marginIfMantener?: number;
  marginIfMarkup?: number;
  marginImprovement?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// HANDLER
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const formData    = await req.formData();
    const newFile     = formData.get('newFile') as File | null;
    const supplierSlug = (formData.get('supplierSlug') as string | null)?.trim() ?? '';
    const supplierName = (formData.get('supplierName') as string | null)?.trim() ?? '';

    if (!newFile) {
      return NextResponse.json({ ok: false, error: 'Se requiere el archivo de la lista (newFile)' }, { status: 400 });
    }

    // ── Parse new list ────────────────────────────────────────────────────────
    const newBuffer        = Buffer.from(await newFile.arrayBuffer());
    const { items: newItems, diag } = parseSupplierExcel(newBuffer);
    const priced = newItems.filter(i => i.price > 0);

    if (priced.length === 0) {
      return NextResponse.json({
        ok: false,
        error: `No se encontraron productos con precio en el archivo. Columnas detectadas: ${diag.headers.filter(Boolean).join(', ') || 'ninguna'}. Columna precio buscada en posición ${diag.priceCol + 1 || 'no encontrada'}. Total filas leídas: ${diag.totalRows}.`,
        diag,
      }, { status: 400 });
    }

    // ── Load products.json — this is the "old" baseline ──────────────────────
    let productsJson: Array<{
      id: string; name: string;
      supplierCode: string | null;
      supplierName: string | null;
      cost: number; price: number; margin: number | null;
      odooId?: number | null;
    }> = [];
    try {
      productsJson = JSON.parse(readFileSync(PRODUCTS_PATH, 'utf8'));
    } catch { /* ok — will show all as unlinked */ }

    // ── Build lookup: supplierCode → product ──────────────────────────────────
    // Also try matching by supplierName (normalize)
    const normSlug = norm(supplierSlug);
    const normName = norm(supplierName);

    const productByCode = new Map<string, typeof productsJson[0]>();
    const linkedToSupplier: typeof productsJson[0][] = [];

    for (const p of productsJson) {
      if (p.supplierCode) {
        productByCode.set(p.supplierCode.trim(), p);
      }
      // Consider a product "linked to this supplier" if supplierName matches
      const pSupNorm = norm(p.supplierName ?? '');
      if (pSupNorm && (pSupNorm.includes(normName) || normName.includes(pSupNorm) ||
          pSupNorm.includes(normSlug) || normSlug.includes(pSupNorm))) {
        linkedToSupplier.push(p);
      }
    }

    // ── Margin computation helper ─────────────────────────────────────────────
    const computeMargins = (prod: typeof productsJson[0] | undefined, oldCost: number, newCost: number) => {
      if (!prod || !prod.price || prod.price <= 0 || oldCost <= 0) return {};
      const salePrice = prod.price;
      const currentMargin    = ((salePrice - oldCost) / salePrice) * 100;
      const marginIfMantener = ((salePrice - newCost) / salePrice) * 100;
      const markup           = salePrice / oldCost;
      const newPriceMarkup   = newCost * markup;
      const marginIfMarkup   = newPriceMarkup > 0 ? ((newPriceMarkup - newCost) / newPriceMarkup) * 100 : null;
      const marginImprovement = marginIfMantener - currentMargin;
      return {
        currentMargin:     parseFloat(currentMargin.toFixed(1)),
        marginIfMantener:  parseFloat(marginIfMantener.toFixed(1)),
        marginIfMarkup:    marginIfMarkup !== null ? parseFloat(marginIfMarkup.toFixed(1)) : undefined,
        marginImprovement: parseFloat(marginImprovement.toFixed(1)),
      };
    };

    // ── Build diff using products.json costs as baseline ─────────────────────
    const up:           DiffItem[] = [];
    const down:         DiffItem[] = [];
    const unchanged:    DiffItem[] = [];
    const isNew:        DiffItem[] = [];    // in new list but not in system

    const seenCodes = new Set<string>();

    for (const newItem of priced) {
      if (!newItem.code) continue;
      seenCodes.add(newItem.code);

      const prod = productByCode.get(newItem.code);

      if (!prod || prod.cost <= 0) {
        // Not linked in system — show as "not in system"
        isNew.push({
          code:     newItem.code,
          desc:     newItem.desc,
          oldPrice: prod?.cost ?? 0,
          newPrice: newItem.price,
          delta:    newItem.price,
          pct:      0,
          uxb:      newItem.uxb,
          suspicious: false,
          inSystem:   !!prod,
          productId:  prod?.id,
          odooId:     prod?.odooId,
          productName: prod?.name,
          currentSalePrice: prod?.price,
          currentMargin: prod?.margin ?? undefined,
        });
        continue;
      }

      const oldCost = prod.cost;
      const delta   = newItem.price - oldCost;
      const pct     = (delta / oldCost) * 100;
      const margins = computeMargins(prod, oldCost, newItem.price);

      const item: DiffItem = {
        code:       newItem.code,
        desc:       newItem.desc,
        oldPrice:   oldCost,
        newPrice:   newItem.price,
        delta,
        pct,
        uxb:        newItem.uxb,
        suspicious: Math.abs(pct) > 40,
        inSystem:   true,
        productId:  prod.id,
        odooId:     prod.odooId,
        productName: prod.name,
        currentSalePrice: prod.price,
        ...margins,
      };

      if (Math.abs(delta) < 0.5) {
        unchanged.push(item);
      } else if (delta > 0) {
        up.push(item);
      } else {
        down.push(item);
      }
    }

    // Products in system linked to this supplier but NOT in new list → discontinued
    const discontinued: DiffItem[] = [];
    for (const prod of linkedToSupplier) {
      if (!prod.supplierCode) continue;
      if (seenCodes.has(prod.supplierCode)) continue;
      discontinued.push({
        code:      prod.supplierCode,
        desc:      prod.name,
        oldPrice:  prod.cost,
        newPrice:  0,
        delta:     -prod.cost,
        pct:       -100,
        uxb:       1,
        suspicious: false,
        inSystem:  true,
        productId: prod.id,
        odooId:    prod.odooId,
        productName: prod.name,
        currentSalePrice: prod.price,
        currentMargin: prod.margin ?? undefined,
      });
    }

    // ── Cluster detection ─────────────────────────────────────────────────────
    const downClusters = detectClusters(down);
    const upClusters   = detectClusters(up);

    const tagClusters = (items: DiffItem[], clusters: ClusterInfo[]) => {
      const clusterPcts = new Set(clusters.map(c => c.pct));
      return items.map(item => {
        const key = Math.round(item.pct);
        if (clusterPcts.has(key)) {
          const cl = clusters.find(c => c.pct === key)!;
          return { ...item, clusterPct: cl.pct, clusterHint: cl.hint };
        }
        return item;
      });
    };

    const taggedDown = tagClusters(down, downClusters);
    const taggedUp   = tagClusters(up, upClusters);

    // Sort: suspicious first, then by abs % desc
    const sortByImpact = (a: DiffItem, b: DiffItem) => {
      if (a.suspicious && !b.suspicious) return -1;
      if (!a.suspicious && b.suspicious) return 1;
      return Math.abs(b.pct) - Math.abs(a.pct);
    };

    taggedDown.sort(sortByImpact);
    taggedUp.sort(sortByImpact);

    // ── Stats ─────────────────────────────────────────────────────────────────
    const stats = {
      upCount:     up.length,
      downCount:   down.length,
      newCount:    isNew.length,        // unlinked items from new list
      discCount:   discontinued.length,
      unchangedCt: unchanged.length,
      suspiciousDown: down.filter(d => d.suspicious).length,
      linkedCount: linkedToSupplier.length,
      diag,
    };

    return NextResponse.json({
      ok: true,
      stats,
      up:           taggedUp,
      down:         taggedDown,
      new:          isNew,
      discontinued,
      unchanged,
      downClusters,
      upClusters,
    });

  } catch (e) {
    console.error('[compare-pricelists]', e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
