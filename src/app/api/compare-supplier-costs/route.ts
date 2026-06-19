import { NextRequest, NextResponse } from 'next/server';
import { read, utils } from 'xlsx';
import { readFileSync, existsSync } from 'fs';
import { PRODUCTS_PATH } from '@/lib/data-paths';

interface LocalProduct {
  id: string; name: string; sku: string | null; barcode: string | null;
  cost: number; price: number; markup: number | null; margin: number | null;
  category: string | null; odooId: number | null; image: string | null;
  active: boolean; hidden: boolean;
}

export interface CompareRow {
  localId:      string;
  localName:    string;
  localSku:     string | null;
  odooId:       number | null;
  category:     string | null;
  currentCost:  number;
  newCost:      number;
  costDiff:     number;
  costDiffPct:  number;
  currentPrice: number;
  newPrice:     number;
  markup:       number;
  direction:    'up' | 'down' | 'same';
  matchMethod:  'sku' | 'barcode' | 'name';
  supplierCode: string | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function norm(s: unknown): string {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseNum(val: unknown): number {
  if (typeof val === 'number') return val;
  const s = String(val ?? '').replace(/[$%\s]/g, '').replace(',', '.').trim();
  return parseFloat(s) || 0;
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

function roundPrice(n: number, mult = 10): number {
  if (mult <= 1) return Math.round(n);
  return Math.ceil(n / mult) * mult;
}

// ── Column detection aliases ──────────────────────────────────────────────────

const COL_CODE    = ['codigo', 'code', 'cod', 'articulo', 'ref', 'item', 'sku', 'referencia', 'cod art', 'cod. art'];
const COL_NAME    = ['nombre', 'descripcion', 'articulo', 'name', 'producto', 'detalle', 'denominacion', 'desc'];
const COL_PRICE   = ['precio lista', 'precio bruto', 'precio base', 'p lista', 'pvp', 'lista', 'precio unit',
                     'precio', 'price', 'costo', 'coste', 'importe'];
const COL_NET     = ['precio neto', 'p neto', 'neto', 'net price', 'costo neto', 'precio final', 'final', 'precio c/dto'];
const COL_DISC    = ['descuento', 'dto', 'bonif', 'bonificacion', 'dto %', '% dto', 'desc %', 'disc', 'discount'];
const COL_BARCODE = ['barcode', 'ean', 'codigo de barra', 'codigo barra', 'barra', 'cod barra'];

function autoDetectCols(headers: string[]) {
  // Net price takes priority over gross+discount
  const colNet  = detectCol(headers, COL_NET);
  const colCost = colNet !== -1 ? colNet : detectCol(headers, COL_PRICE);
  return {
    colCode:    detectCol(headers, COL_CODE),
    colName:    detectCol(headers, COL_NAME),
    colCost,
    colDisc:    colNet !== -1 ? -1 : detectCol(headers, COL_DISC),
    colBarcode: detectCol(headers, COL_BARCODE),
    hasNet:     colNet !== -1,
  };
}

// ── Main handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get('content-type') ?? '';
    let rawRows: unknown[][] = [];
    let supplierName = '';
    let previewOnly  = false;
    let colOverrides: Record<string, number> = {};
    let matchBy = 'name';

    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      const file = formData.get('file') as File | null;
      if (!file) return NextResponse.json({ ok: false, error: 'No se recibió archivo' }, { status: 400 });
      supplierName = (formData.get('supplierName') as string | null)?.trim() ?? '';
      previewOnly  = formData.get('previewOnly') === 'true';
      const overridesRaw = formData.get('colOverrides') as string | null;
      if (overridesRaw) { try { colOverrides = JSON.parse(overridesRaw); } catch { /* ignore */ } }
      matchBy = (formData.get('matchBy') as string | null) ?? 'name';
      const buffer = Buffer.from(await file.arrayBuffer());
      const wb = read(buffer, { type: 'buffer', cellDates: true });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      rawRows = utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', blankrows: false });
    } else {
      const body = await req.json() as {
        rows: unknown[][];
        supplierName?: string;
        previewOnly?: boolean;
        colOverrides?: Record<string, number>;
        matchBy?: string;
      };
      rawRows       = body.rows ?? [];
      supplierName  = body.supplierName?.trim() ?? '';
      previewOnly   = body.previewOnly ?? false;
      colOverrides  = body.colOverrides ?? {};
      matchBy       = body.matchBy ?? 'name';
    }

    if (rawRows.length < 2)
      return NextResponse.json({ ok: false, error: 'El archivo está vacío o no tiene datos.' }, { status: 400 });

    // ── Detect header row ─────────────────────────────────────────────────────
    let headerIdx = 0;
    for (let i = 0; i < Math.min(10, rawRows.length); i++) {
      const nonEmpty = (rawRows[i] as unknown[]).filter(c => String(c ?? '').trim().length > 1).length;
      if (nonEmpty >= 3) { headerIdx = i; break; }
    }

    const rawHeaders   = (rawRows[headerIdx] as unknown[]).map(h => String(h ?? '').trim());
    const normHeaders  = rawHeaders.map(norm);
    const auto         = autoDetectCols(normHeaders);

    // Apply user overrides
    const colCode    = colOverrides.colCode    !== undefined ? colOverrides.colCode    : auto.colCode;
    const colName    = colOverrides.colName    !== undefined ? colOverrides.colName    : auto.colName;
    const colCost    = colOverrides.colCost    !== undefined ? colOverrides.colCost    : auto.colCost;
    const colDisc    = colOverrides.colDisc    !== undefined ? colOverrides.colDisc    : auto.colDisc;
    const colBarcode = colOverrides.colBarcode !== undefined ? colOverrides.colBarcode : auto.colBarcode;

    // Sample rows (first 5 data rows after header)
    const sampleRows = rawRows.slice(headerIdx + 1, headerIdx + 6)
      .map(r => (r as unknown[]).map(c => String(c ?? '').trim()));

    // ── Preview only: return headers + detected cols + sample ─────────────────
    if (previewOnly) {
      return NextResponse.json({
        ok: true,
        previewOnly: true,
        headers: rawHeaders,
        headerIdx,
        detected: { colCode, colName, colCost, colDisc, colBarcode, hasNet: auto.hasNet },
        sample:   sampleRows,
      });
    }

    if (colCost === -1)
      return NextResponse.json({
        ok: false,
        error: 'No se detectó columna de precio/costo.',
        headers: rawHeaders,
        detected: { colCode, colName, colCost, colDisc, colBarcode },
      }, { status: 400 });

    // ── Load local products ───────────────────────────────────────────────────
    if (!existsSync(PRODUCTS_PATH))
      return NextResponse.json({ ok: false, error: 'products.json no encontrado' }, { status: 500 });

    const locals: LocalProduct[] = JSON.parse(readFileSync(PRODUCTS_PATH, 'utf8'));
    const active = locals.filter(p => p.active !== false);

    const bySkuMap     = new Map<string, LocalProduct>();
    const byBarcodeMap = new Map<string, LocalProduct>();
    const byNameMap    = new Map<string, LocalProduct>();

    for (const p of active) {
      if (p.sku)     bySkuMap.set(norm(p.sku), p);
      if (p.barcode) byBarcodeMap.set(norm(p.barcode), p);
      byNameMap.set(norm(p.name), p);
    }

    // ── Compare ───────────────────────────────────────────────────────────────
    const matches:   CompareRow[] = [];
    const unmatched: string[]     = [];
    const seen = new Set<string>();

    for (let i = headerIdx + 1; i < rawRows.length; i++) {
      const row = rawRows[i] as unknown[];

      const excelCode    = colCode    >= 0 ? String(row[colCode]    ?? '').trim() : '';
      const excelName    = colName    >= 0 ? String(row[colName]    ?? '').trim() : '';
      const excelBarcode = colBarcode >= 0 ? String(row[colBarcode] ?? '').trim() : '';
      const grossPrice   = parseNum(row[colCost]);
      const discount     = colDisc >= 0 ? parseNum(row[colDisc]) : 0;

      // Net cost: if discount column exists, apply it; otherwise gross IS the net
      const newCost = discount > 0
        ? Math.round(grossPrice * (1 - discount / 100) * 100) / 100
        : grossPrice;

      if (!excelName && !excelCode) continue;
      if (newCost <= 0) continue;

      let local: LocalProduct | undefined;
      let matchMethod: CompareRow['matchMethod'] = 'name';

      // Try in priority order based on matchBy setting
      const attempts: Array<[string, Map<string, LocalProduct>, CompareRow['matchMethod']]> = [];

      if (matchBy === 'sku' || matchBy === 'supplier_code') {
        attempts.push([norm(excelCode), bySkuMap, 'sku']);
        attempts.push([norm(excelBarcode), byBarcodeMap, 'barcode']);
        attempts.push([norm(excelName), byNameMap, 'name']);
      } else {
        // default: name first, then code fallback
        attempts.push([norm(excelName), byNameMap, 'name']);
        attempts.push([norm(excelCode), bySkuMap, 'sku']);
        attempts.push([norm(excelBarcode), byBarcodeMap, 'barcode']);
      }

      for (const [key, map, method] of attempts) {
        if (key && map.has(key)) { local = map.get(key); matchMethod = method; break; }
      }

      if (!local) { unmatched.push(excelName || excelCode); continue; }
      if (seen.has(local.id)) continue;
      seen.add(local.id);

      const currentCost  = local.cost ?? 0;
      const currentPrice = local.price ?? 0;
      const markup       = local.markup ?? (currentCost > 0 ? Math.round(((currentPrice / currentCost) - 1) * 100) : 0);
      const costDiff     = newCost - currentCost;
      const costDiffPct  = currentCost > 0 ? Math.round((costDiff / currentCost) * 1000) / 10 : 0;
      const newPrice     = roundPrice(markup > 0 ? newCost * (1 + markup / 100) : newCost);
      const direction: CompareRow['direction'] =
        Math.abs(costDiffPct) < 0.5 ? 'same' : costDiff > 0 ? 'up' : 'down';

      matches.push({
        localId: local.id, localName: local.name, localSku: local.sku,
        odooId: local.odooId ?? null, category: local.category ?? null,
        currentCost, newCost: Math.round(newCost * 100) / 100,
        costDiff: Math.round(costDiff * 100) / 100, costDiffPct,
        currentPrice, newPrice, markup, direction, matchMethod,
        supplierCode: excelCode || null,
      });
    }

    matches.sort((a, b) => {
      const order = { up: 0, down: 1, same: 2 };
      return order[a.direction] - order[b.direction] || Math.abs(b.costDiffPct) - Math.abs(a.costDiffPct);
    });

    const stats = {
      total: matches.length + unmatched.length, matched: matches.length,
      unmatched: unmatched.length,
      increases: matches.filter(m => m.direction === 'up').length,
      decreases: matches.filter(m => m.direction === 'down').length,
      same: matches.filter(m => m.direction === 'same').length,
    };

    return NextResponse.json({ ok: true, matches, unmatched, stats, supplierName,
      detectedCols: { colCode, colName, colCost, colDisc, colBarcode } });

  } catch (e) {
    console.error('[compare-supplier-costs]', e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
