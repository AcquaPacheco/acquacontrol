import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { HISTORY_PATH, PRODUCTS_PATH, SETTINGS_PATH } from '@/lib/data-paths';


interface Settings {
  odooServerUrl: string;
  odooUsername:  string;
  odooApiKey:    string;
  odooDbName:    string;
  [key: string]: unknown;
}

interface LocalProduct {
  id:          string;
  name:        string;
  sku:         string | null;
  barcode:     string | null;
  odooId:      number | null;
  cost:        number;
  price:       number;
  margin:      number | null;
  markup:      number | null;
  image:       string | null;
  [key: string]: unknown;
}

interface HistoryEntry {
  id: string; productId: string; productName: string;
  field: string; oldValue: unknown; newValue: unknown;
  source: string; timestamp: string;
}

type SyncField = 'cost' | 'price' | 'name';

// ── Helpers ──────────────────────────────────────────────────────────────────

function norm(s: string) {
  return s.toLowerCase().trim().replace(/\s+/g, ' ');
}

function round2(n: number) { return Math.round(n * 100) / 100; }

function calcMargin(cost: number, price: number) {
  if (!price || !cost) return null;
  return round2(((price - cost) / price) * 100);
}
function calcMarkup(cost: number, price: number) {
  if (!cost) return null;
  return round2(((price / cost) - 1) * 100);
}

function readHistory(): HistoryEntry[] {
  if (!existsSync(HISTORY_PATH)) return [];
  try { return JSON.parse(readFileSync(HISTORY_PATH, 'utf8')) as HistoryEntry[]; } catch { return []; }
}

function appendHistoryBatch(entries: Omit<HistoryEntry, 'id' | 'timestamp'>[]) {
  if (entries.length === 0) return;
  const history = readHistory();
  const now = new Date().toISOString();
  for (const e of entries) {
    history.unshift({
      ...e,
      id: `h_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      timestamp: now,
    });
  }
  if (history.length > 500) history.splice(500);
  writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2), 'utf8');
}

// ── XML-RPC (reuse from sync-stock-odoo) ────────────────────────────────────

function xmlVal(v: unknown): string {
  if (typeof v === 'string')
    return `<value><string>${v.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</string></value>`;
  if (typeof v === 'number' && Number.isInteger(v)) return `<value><int>${v}</int></value>`;
  if (typeof v === 'number')  return `<value><double>${v}</double></value>`;
  if (typeof v === 'boolean') return `<value><boolean>${v ? 1 : 0}</boolean></value>`;
  if (Array.isArray(v))
    return `<value><array><data>${v.map(xmlVal).join('')}</data></array></value>`;
  if (v === null || v === undefined) return `<value><nil/></value>`;
  const members = Object.entries(v as Record<string, unknown>)
    .map(([k, val]) => `<member><name>${k}</name>${xmlVal(val)}</member>`).join('');
  return `<value><struct>${members}</struct></value>`;
}

function xmlCall(method: string, params: unknown[]): string {
  return `<?xml version="1.0"?><methodCall><methodName>${method}</methodName><params>${
    params.map(p => `<param>${xmlVal(p)}</param>`).join('')
  }</params></methodCall>`;
}

function findClose(xml: string, fromPos: number, open: string, close: string): number {
  let depth = 1; let i = fromPos;
  while (i < xml.length && depth > 0) {
    const o = xml.indexOf(open, i); const c = xml.indexOf(close, i);
    if (c < 0) return -1;
    if (o >= 0 && o < c) { depth++; i = o + open.length; }
    else { depth--; i = c + close.length; }
  }
  return depth === 0 ? i : -1;
}

function parseContent(s: string): unknown {
  s = s.trim();
  if (!s || s === '<nil/>' || s === '<nil />') return null;
  if (/^<i(nt|4)>/.test(s)) { const m = s.match(/^<i(?:nt|4)>(-?\d+)<\/i(?:nt|4)>/); return m ? parseInt(m[1]) : 0; }
  if (s.startsWith('<double>')) { const m = s.match(/^<double>([^<]+)<\/double>/); return m ? parseFloat(m[1]) : 0; }
  if (s.startsWith('<boolean>')) { return s.startsWith('<boolean>1'); }
  if (s.startsWith('<string>')) {
    const close = s.lastIndexOf('</string>'); const inner = close >= 0 ? s.slice(8, close) : '';
    return inner.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&apos;/g,"'").replace(/&quot;/g,'"');
  }
  if (s.startsWith('<array>')) {
    const ds = s.indexOf('<data>'); const de = s.lastIndexOf('</data>');
    if (ds < 0 || de < 0) return [];
    return extractValues(s.slice(ds + 6, de));
  }
  if (s.startsWith('<struct>')) {
    const close = s.lastIndexOf('</struct>');
    return extractMembers(close >= 0 ? s.slice(8, close) : '');
  }
  return null;
}

function extractValues(data: string): unknown[] {
  const items: unknown[] = []; let pos = 0;
  while (true) {
    const vs = data.indexOf('<value>', pos); if (vs < 0) break;
    const end = findClose(data, vs + 7, '<value>', '</value>'); if (end < 0) break;
    items.push(parseContent(data.slice(vs + 7, end - 8))); pos = end;
  }
  return items;
}

function extractMembers(data: string): Record<string, unknown> {
  const obj: Record<string, unknown> = {}; let pos = 0;
  while (true) {
    const ms = data.indexOf('<member>', pos); if (ms < 0) break;
    const me = data.indexOf('</member>', ms); if (me < 0) break;
    const mc = data.slice(ms + 8, me);
    const nm = mc.match(/<name>([\s\S]*?)<\/name>/);
    if (nm) { const vals = extractValues(mc); obj[nm[1]] = vals.length > 0 ? vals[0] : null; }
    pos = me + 9;
  }
  return obj;
}

function parseXmlRpcResponse(text: string): unknown {
  if (text.includes('<fault>')) {
    const m = text.match(/<name>faultString<\/name>\s*<value><string>([\s\S]*?)<\/string><\/value>/);
    throw new Error(m ? m[1].replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>') : 'XML-RPC fault');
  }
  const vs = text.indexOf('<value>'); if (vs < 0) return null;
  const end = findClose(text, vs + 7, '<value>', '</value>'); if (end < 0) return null;
  return parseContent(text.slice(vs + 7, end - 8));
}

async function xmlRpc(url: string, method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml', Accept: 'text/xml' },
    body: xmlCall(method, params),
  });
  return parseXmlRpcResponse(await res.text());
}

// ── Main handler ─────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    // Parse sync options from body
    const body = await req.json().catch(() => ({})) as {
      syncCost?:    boolean;
      syncPrice?:   boolean;
      syncName?:    boolean;
      createNew?:   boolean;  // Import products that don't exist locally yet
    };
    const syncCost  = body.syncCost  !== false; // default true
    const syncPrice = body.syncPrice !== false; // default true
    const syncName  = body.syncName  === true;  // default false (names are often customized locally)
    const createNew = body.createNew !== false; // default true — import missing products

    if (!existsSync(SETTINGS_PATH))
      return NextResponse.json({ ok: false, error: 'settings.json no encontrado' }, { status: 500 });

    const settings: Settings = JSON.parse(readFileSync(SETTINGS_PATH, 'utf8'));
    const { odooServerUrl, odooUsername, odooApiKey, odooDbName } = settings;

    if (!odooServerUrl) return NextResponse.json({ ok: false, error: 'Falta la URL del servidor Odoo.' }, { status: 400 });
    if (!odooUsername)  return NextResponse.json({ ok: false, error: 'Falta el usuario de Odoo.' }, { status: 400 });
    if (!odooApiKey)    return NextResponse.json({ ok: false, error: 'Falta la API Key de Odoo.' }, { status: 400 });

    const baseUrl = odooServerUrl.replace(/\/$/, '');
    const db = odooDbName?.trim() || (() => {
      const m = baseUrl.match(/https?:\/\/([^.]+)\.odoo\.com/);
      return m ? m[1] : '';
    })();
    if (!db) return NextResponse.json({ ok: false, error: `No se pudo determinar la base de datos para: ${baseUrl}` }, { status: 400 });

    // ── 1. Authenticate ──
    let uid: number;
    try {
      const result = await xmlRpc(`${baseUrl}/xmlrpc/2/common`, 'authenticate', [db, odooUsername, odooApiKey, {}]);
      if (typeof result !== 'number' || result === 0)
        return NextResponse.json({ ok: false, error: `Credenciales incorrectas. (db: ${db})` }, { status: 401 });
      uid = result;
    } catch (e) {
      return NextResponse.json({ ok: false, error: `Error de autenticación: ${String(e)}` }, { status: 401 });
    }

    // ── 2. Fetch product.template ──
    let odooTemplates: Record<string, unknown>[];
    try {
      const result = await xmlRpc(
        `${baseUrl}/xmlrpc/2/object`,
        'execute_kw',
        [
          db, uid, odooApiKey,
          'product.template', 'search_read',
          [[['active', '=', true], ['sale_ok', '=', true]]],
          {
            fields: ['id', 'name', 'default_code', 'standard_price', 'list_price', 'categ_id', 'barcode'],
            limit: 5000,
          },
        ]
      );
      if (!Array.isArray(result))
        return NextResponse.json({ ok: false, error: `Odoo no devolvió lista (tipo: ${typeof result})` }, { status: 500 });
      odooTemplates = result as Record<string, unknown>[];
    } catch (e) {
      return NextResponse.json({ ok: false, error: `Error obteniendo productos: ${String(e)}` }, { status: 500 });
    }

    if (odooTemplates.length === 0)
      return NextResponse.json({ ok: false, error: 'Odoo devolvió 0 templates. Verificá permisos.' }, { status: 500 });

    // ── 2b. Fetch stock per template (via product.product variants) ───────────
    const tmplStock = new Map<number, number>();
    try {
      const varResult = await xmlRpc(
        `${baseUrl}/xmlrpc/2/object`,
        'execute_kw',
        [
          db, uid, odooApiKey,
          'product.product', 'search_read',
          [[['active', '=', true]]],
          { fields: ['product_tmpl_id', 'qty_available'], limit: 10000 },
        ]
      );
      if (Array.isArray(varResult)) {
        for (const v of varResult as Record<string, unknown>[]) {
          const tmplRaw = v.product_tmpl_id;
          const tmplId  = Array.isArray(tmplRaw) ? Number(tmplRaw[0]) : null;
          if (!tmplId) continue;
          tmplStock.set(tmplId, (tmplStock.get(tmplId) ?? 0) + Math.max(0, Number(v.qty_available) || 0));
        }
      }
    } catch { /* stock es opcional, continúa sin él */ }

    // ── 3. Load local products ──
    if (!existsSync(PRODUCTS_PATH))
      return NextResponse.json({ ok: false, error: 'products.json no encontrado.' }, { status: 500 });

    const localProducts: LocalProduct[] = JSON.parse(readFileSync(PRODUCTS_PATH, 'utf8'));

    // Build lookup maps
    const byOdooId = new Map<number, LocalProduct>();
    const bySku    = new Map<string, LocalProduct>();
    const byName   = new Map<string, LocalProduct>();

    for (const p of localProducts) {
      if (p.odooId) byOdooId.set(p.odooId, p);
      if (p.sku)    bySku.set(norm(p.sku), p);
      byName.set(norm(p.name), p);
    }

    // ── 4. Match & update ──
    let matched          = 0;
    let costChanged      = 0;
    let priceChanged     = 0;
    let nameChanged      = 0;
    let odooIdBackfilled = 0;
    let stockUpdated     = 0;
    const newProducts: LocalProduct[]                               = [];
    const historyEntries: Omit<HistoryEntry, 'id' | 'timestamp'>[] = [];

    for (const ot of odooTemplates) {
      const odooTmplId = typeof ot.id === 'number' ? ot.id : null;
      if (!odooTmplId) continue;

      const skuRaw    = ot.default_code ? String(ot.default_code).trim() : null;
      const sku       = skuRaw ? norm(skuRaw) : null;
      const odooCost  = typeof ot.standard_price === 'number' ? ot.standard_price : 0;
      const odooPrice = typeof ot.list_price      === 'number' ? ot.list_price      : 0;
      const odooName  = typeof ot.name === 'string' ? ot.name.trim() : '';
      const barcode   = ot.barcode ? String(ot.barcode).trim() : null;
      const stock     = Math.round((tmplStock.get(odooTmplId) ?? 0) * 100) / 100;
      const categRaw  = ot.categ_id;
      const category  = Array.isArray(categRaw) ? String(categRaw[1] ?? '') : null;

      // Match: odooId first → SKU → name
      let local = byOdooId.get(odooTmplId);
      if (!local && sku)      local = bySku.get(sku);
      if (!local && odooName) local = byName.get(norm(odooName));

      if (!local) {
        // ── CREATE new product (if enabled and has a price) ──────────────────
        if (createNew && odooPrice > 0) {
          const newProd: LocalProduct = {
            id:           `odoo_${odooTmplId}`,
            name:         odooName,
            sku:          skuRaw,
            barcode:      barcode,
            cost:         round2(odooCost),
            price:        round2(odooPrice),
            margin:       calcMargin(odooCost, odooPrice),
            markup:       calcMarkup(odooCost, odooPrice),
            category:     category || 'Sin categoría',
            supplierName: null,
            active:       true,
            hidden:       false,   // nuevos productos visibles por defecto
            stock:        stock,
            odooId:       odooTmplId,
            image:        null,
          };
          newProducts.push(newProd);
          byOdooId.set(odooTmplId, newProd);
          if (skuRaw) bySku.set(norm(skuRaw), newProd);
          byName.set(norm(odooName), newProd);
        }
        continue;
      }

      matched++;

      // Backfill odooId if missing
      if (!local.odooId) {
        local.odooId = odooTmplId;
        odooIdBackfilled++;
        byOdooId.set(odooTmplId, local);
      }

      const prodName = String(local.name);

      // Si el producto existe y activo en Odoo, activarlo también localmente
      if (local.active === false) {
        local.active = true;
      }

      // Update stock from Odoo
      if (tmplStock.has(odooTmplId)) {
        local.stock = stock;
        stockUpdated++;
      }

      // Sync cost
      if (syncCost && odooCost > 0 && round2(odooCost) !== round2(local.cost)) {
        historyEntries.push({ productId: local.id, productName: prodName, field: 'cost', oldValue: local.cost, newValue: round2(odooCost), source: 'sync_odoo' });
        local.cost = round2(odooCost);
        costChanged++;
      }

      // Sync price
      if (syncPrice && odooPrice > 1 && round2(odooPrice) !== round2(local.price)) {
        historyEntries.push({ productId: local.id, productName: prodName, field: 'price', oldValue: local.price, newValue: round2(odooPrice), source: 'sync_odoo' });
        local.price = round2(odooPrice);
        priceChanged++;
      }

      // Recalculate margin & markup
      if (local.cost > 0 && local.price > 1) {
        local.margin = calcMargin(local.cost, local.price);
        local.markup = calcMarkup(local.cost, local.price);
      }

      // Sync name (optional)
      if (syncName && odooName && norm(odooName) !== norm(local.name)) {
        historyEntries.push({ productId: local.id, productName: prodName, field: 'name', oldValue: local.name, newValue: odooName, source: 'sync_odoo' });
        local.name = odooName;
        nameChanged++;
      }
    }

    // ── 5. Save ──
    const finalProducts = [...localProducts, ...newProducts];
    writeFileSync(PRODUCTS_PATH, JSON.stringify(finalProducts, null, 2), 'utf8');
    appendHistoryBatch(historyEntries);

    const fields: SyncField[] = [];
    if (syncCost)  fields.push('cost');
    if (syncPrice) fields.push('price');
    if (syncName)  fields.push('name');

    const hiddenCount = finalProducts.filter(p => Boolean(p.hidden)).length;
    const withStock   = finalProducts.filter(p => Number(p.stock ?? 0) > 0).length;

    return NextResponse.json({
      ok:              true,
      total:           odooTemplates.length,
      matched,
      created:         newProducts.length,
      costChanged,
      priceChanged,
      nameChanged,
      stockUpdated,
      odooIdBackfilled,
      hidden:          hiddenCount,
      withStock,
      syncedFields:    fields,
      message: `✅ Sync completo: ${matched} actualizados, ${newProducts.length} nuevos importados desde Odoo. ${hiddenCount} ocultos preservados.`,
    });

  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
