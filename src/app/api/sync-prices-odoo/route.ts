import { NextResponse } from 'next/server';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { PRODUCTS_PATH, SETTINGS_PATH } from '@/lib/data-paths';


interface Settings {
  odooServerUrl: string;
  odooUsername:  string;
  odooApiKey:    string;
  odooDbName:    string;
  [key: string]: unknown;
}

interface LocalProduct {
  id:      string;
  name:    string;
  sku:     string | null;
  barcode: string | null;
  cost:    number;
  price:   number;
  odooId:  number | null;
  [key: string]: unknown;
}

function norm(s: string) {
  return s.toLowerCase().trim().replace(/\s+/g, ' ');
}

// ── XML-RPC helpers (same as sync-stock-odoo) ─────────────────────────────────

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
  let depth = 1;
  let i = fromPos;
  while (i < xml.length && depth > 0) {
    const o = xml.indexOf(open, i);
    const c = xml.indexOf(close, i);
    if (c < 0) return -1;
    if (o >= 0 && o < c) { depth++; i = o + open.length; }
    else                  { depth--; i = c + close.length; }
  }
  return depth === 0 ? i : -1;
}

function parseContent(s: string): unknown {
  s = s.trim();
  if (!s || s === '<nil/>' || s === '<nil />') return null;
  if (/^<i(nt|4)>/.test(s)) {
    const m = s.match(/^<i(?:nt|4)>(-?\d+)<\/i(?:nt|4)>/);
    return m ? parseInt(m[1]) : 0;
  }
  if (s.startsWith('<double>')) {
    const m = s.match(/^<double>([^<]+)<\/double>/);
    return m ? parseFloat(m[1]) : 0;
  }
  if (s.startsWith('<boolean>')) return s.startsWith('<boolean>1');
  if (s.startsWith('<string>')) {
    const close = s.lastIndexOf('</string>');
    const inner = close >= 0 ? s.slice(8, close) : '';
    return inner
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&apos;/g, "'").replace(/&quot;/g, '"');
  }
  if (s.startsWith('<array>')) {
    const ds = s.indexOf('<data>');
    const de = s.lastIndexOf('</data>');
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
  const items: unknown[] = [];
  let pos = 0;
  while (true) {
    const vs = data.indexOf('<value>', pos);
    if (vs < 0) break;
    const end = findClose(data, vs + 7, '<value>', '</value>');
    if (end < 0) break;
    items.push(parseContent(data.slice(vs + 7, end - 8)));
    pos = end;
  }
  return items;
}

function extractMembers(data: string): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  let pos = 0;
  while (true) {
    const ms = data.indexOf('<member>', pos);
    if (ms < 0) break;
    const me = data.indexOf('</member>', ms);
    if (me < 0) break;
    const mc = data.slice(ms + 8, me);
    const nm = mc.match(/<name>([\s\S]*?)<\/name>/);
    if (nm) {
      const vals = extractValues(mc);
      obj[nm[1]] = vals.length > 0 ? vals[0] : null;
    }
    pos = me + 9;
  }
  return obj;
}

function parseXmlRpcResponse(text: string): unknown {
  if (text.includes('<fault>')) {
    const m = text.match(/<name>faultString<\/name>\s*<value><string>([\s\S]*?)<\/string><\/value>/);
    const msg = m
      ? m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      : 'XML-RPC fault';
    throw new Error(msg);
  }
  const vs = text.indexOf('<value>');
  if (vs < 0) return null;
  const end = findClose(text, vs + 7, '<value>', '</value>');
  if (end < 0) return null;
  return parseContent(text.slice(vs + 7, end - 8));
}

async function xmlRpc(url: string, method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'text/xml', 'Accept': 'text/xml' },
    body:    xmlCall(method, params),
  });
  const text = await res.text();
  return parseXmlRpcResponse(text);
}

// ── Rounding helper ───────────────────────────────────────────────────────────

/** Round price to nearest $100 if ≥ $1000, else nearest $10 */
function roundPrice(raw: number): number {
  if (raw <= 0) return 0;
  const step = raw >= 1000 ? 100 : 10;
  return Math.round(raw / step) * step;
}

// ── Main handler ─────────────────────────────────────────────────────────────

export async function POST() {
  try {
    if (!existsSync(SETTINGS_PATH))
      return NextResponse.json({ ok: false, error: 'settings.json no encontrado' }, { status: 500 });

    const settings: Settings = JSON.parse(readFileSync(SETTINGS_PATH, 'utf8'));
    const { odooServerUrl, odooUsername, odooApiKey, odooDbName } = settings;

    if (!odooServerUrl) return NextResponse.json({ ok: false, error: 'Falta la URL del servidor Odoo.' }, { status: 400 });
    if (!odooUsername)  return NextResponse.json({ ok: false, error: 'Falta el usuario (email) de Odoo.' }, { status: 400 });
    if (!odooApiKey)    return NextResponse.json({ ok: false, error: 'Falta la API Key de Odoo.' }, { status: 400 });

    const baseUrl = odooServerUrl.replace(/\/$/, '');
    const db = odooDbName?.trim() || (() => {
      const m = baseUrl.match(/https?:\/\/([^.]+)\.odoo\.com/);
      return m ? m[1] : '';
    })();

    if (!db)
      return NextResponse.json({ ok: false, error: `No se pudo determinar la base de datos para: ${baseUrl}` }, { status: 400 });

    // ── 1. Authenticate ──
    let uid: number;
    try {
      const result = await xmlRpc(`${baseUrl}/xmlrpc/2/common`, 'authenticate', [db, odooUsername, odooApiKey, {}]);
      if (typeof result !== 'number' || result === 0)
        return NextResponse.json({ ok: false, error: `Credenciales incorrectas. Verificá el email y la API Key. (db: ${db})` }, { status: 401 });
      uid = result;
    } catch (e) {
      return NextResponse.json({ ok: false, error: `Error de autenticación: ${String(e)}` }, { status: 401 });
    }

    // ── 2. Fetch product.template with cost and price ──
    let odooTemplates: Record<string, unknown>[];
    try {
      const result = await xmlRpc(
        `${baseUrl}/xmlrpc/2/object`,
        'execute_kw',
        [
          db, uid, odooApiKey,
          'product.template', 'search_read',
          [[['active', '=', true]]],
          {
            fields: ['id', 'name', 'default_code', 'standard_price', 'list_price'],
            limit:  3000,
          },
        ]
      );
      if (!Array.isArray(result))
        return NextResponse.json({ ok: false, error: `Odoo no devolvió una lista de plantillas (recibido: ${typeof result}).` }, { status: 500 });
      odooTemplates = result as Record<string, unknown>[];
    } catch (e) {
      return NextResponse.json({ ok: false, error: `Error obteniendo productos de Odoo: ${String(e)}` }, { status: 500 });
    }

    if (odooTemplates.length === 0)
      return NextResponse.json({ ok: false, error: 'Odoo devolvió 0 plantillas de producto. Verificá permisos.' }, { status: 500 });

    // ── 3. Load local products ──
    if (!existsSync(PRODUCTS_PATH))
      return NextResponse.json({ ok: false, error: 'products.json no encontrado.' }, { status: 500 });

    const localProducts: LocalProduct[] = JSON.parse(readFileSync(PRODUCTS_PATH, 'utf8'));

    const byTmplId = new Map<number, LocalProduct>();
    const bySku    = new Map<string, LocalProduct>();
    const byName   = new Map<string, LocalProduct>();

    for (const p of localProducts) {
      if (p.odooId) byTmplId.set(p.odooId, p);
      if (p.sku)    bySku.set(norm(p.sku), p);
      byName.set(norm(p.name), p);
    }

    // ── 4. Match and update ──
    let updated = 0;
    let skipped = 0;
    const missed: string[] = [];

    for (const ot of odooTemplates) {
      const tmplId        = typeof ot.id === 'number' ? ot.id : null;
      const standardPrice = typeof ot.standard_price === 'number' ? ot.standard_price : 0;
      const listPrice     = typeof ot.list_price === 'number' ? ot.list_price : 0;

      // Match priority: odooId → SKU → name
      let local = tmplId ? byTmplId.get(tmplId) : undefined;
      if (!local && ot.default_code) local = bySku.get(norm(String(ot.default_code)));
      if (!local) local = byName.get(norm(String(ot.name ?? '')));

      if (!local) {
        if (!missed.includes(String(ot.name))) missed.push(String(ot.name));
        continue;
      }

      let changed = false;

      // Update odooId for future fast-matching
      if (tmplId && !local.odooId) {
        local.odooId = tmplId;
        changed = true;
      }

      // Update cost (standard_price) — skip if 0 to avoid wiping known costs
      if (standardPrice > 0) {
        local.cost = Math.round(standardPrice * 100) / 100; // keep 2 decimals for cost
        changed = true;
      }

      // Update price (list_price) — round to nearest $100 for prices ≥ $1000
      if (listPrice > 0) {
        local.price = roundPrice(listPrice);
        changed = true;
      }

      if (changed) updated++;
      else skipped++;
    }

    // ── 5. Save ──
    writeFileSync(PRODUCTS_PATH, JSON.stringify(localProducts, null, 2), 'utf8');

    return NextResponse.json({
      ok:              true,
      total:           odooTemplates.length,
      updated,
      skipped,
      unmatched:       missed.length,
      unmatchedSample: missed.slice(0, 8),
      message: `✅ ${updated} productos actualizados con costos y precios de Odoo.`,
    });

  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
