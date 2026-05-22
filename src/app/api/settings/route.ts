import { NextRequest, NextResponse } from 'next/server';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const SETTINGS_PATH = resolve(process.cwd(), 'src/data/settings.json');

interface Settings {
  odooServerUrl: string;
  mlAppId:       string;
  mlAppSecret:   string;
  mlSite:        string;
  geminiKey:     string;
}

const DEFAULT_SETTINGS: Settings = {
  odooServerUrl: '',
  mlAppId:       '',
  mlAppSecret:   '',
  mlSite:        'MLA',
  geminiKey:     '',
};

function readSettings(): Settings {
  try {
    if (!existsSync(SETTINGS_PATH)) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...JSON.parse(readFileSync(SETTINGS_PATH, 'utf8')) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** GET /api/settings — devuelve la configuración actual */
export async function GET() {
  return NextResponse.json(readSettings());
}

/** POST /api/settings — actualiza la configuración */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as Partial<Settings>;
    const current = readSettings();
    const updated: Settings = { ...current, ...body };
    writeFileSync(SETTINGS_PATH, JSON.stringify(updated, null, 2), 'utf8');
    return NextResponse.json({ ok: true, settings: updated });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
