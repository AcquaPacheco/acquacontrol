import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { COMPETITOR_LINKS_PATH } from '@/lib/data-paths';

// ─────────────────────────────────────────────────────────────────────────────
// Storage
// ─────────────────────────────────────────────────────────────────────────────


export interface CompetitorLink {
  url:      string;
  name:     string;
  price?:   number;
  linkedAt: string;
}

/** Structure: { [productId]: { [store]: CompetitorLink } } */
type LinksFile = Record<string, Record<string, CompetitorLink>>;

function readLinks(): LinksFile {
  if (!existsSync(COMPETITOR_LINKS_PATH)) return {};
  try { return JSON.parse(readFileSync(COMPETITOR_LINKS_PATH, 'utf8')) as LinksFile; }
  catch { return {}; }
}

function writeLinks(data: LinksFile): void {
  writeFileSync(COMPETITOR_LINKS_PATH, JSON.stringify(data, null, 2), 'utf8');
}

// ─────────────────────────────────────────────────────────────────────────────
// GET  /api/competitor-links?productId=xxx   (optional filter)
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const links = readLinks();
    const pid   = new URL(req.url).searchParams.get('productId');
    if (pid) {
      return NextResponse.json(links[pid] ?? {});
    }
    return NextResponse.json(links);
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/competitor-links  — save / update a link
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      productId: string;
      store:     string;
      url:       string;
      name:      string;
      price?:    number;
    };

    const { productId, store, url, name, price } = body;
    if (!productId || !store || !url || !name) {
      return NextResponse.json({ ok: false, error: 'Faltan campos requeridos' }, { status: 400 });
    }

    const links = readLinks();
    if (!links[productId]) links[productId] = {};
    links[productId][store] = {
      url,
      name,
      ...(price !== undefined && { price }),
      linkedAt: new Date().toISOString(),
    };
    writeLinks(links);

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/competitor-links  — remove a link
// ─────────────────────────────────────────────────────────────────────────────

export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json() as { productId: string; store: string };
    const { productId, store } = body;
    if (!productId || !store) {
      return NextResponse.json({ ok: false, error: 'Faltan productId y store' }, { status: 400 });
    }

    const links = readLinks();
    if (links[productId]) {
      delete links[productId][store];
      if (Object.keys(links[productId]).length === 0) delete links[productId];
      writeLinks(links);
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
