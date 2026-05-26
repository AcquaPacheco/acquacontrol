import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, existsSync, writeFileSync } from 'fs';
import { ACTION_LOG_PATH } from '@/lib/data-paths';


export interface LogEntry {
  ts:      string;
  action:  string;
  section: string;
  detail?: unknown;
}

function readLog(): LogEntry[] {
  try {
    if (!existsSync(ACTION_LOG_PATH)) return [];
    return readFileSync(ACTION_LOG_PATH, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map(l => JSON.parse(l) as LogEntry)
      .reverse(); // más reciente primero
  } catch {
    return [];
  }
}

/** GET /api/action-log?limit=100 */
export async function GET(req: NextRequest) {
  const limit = Math.min(Number(req.nextUrl.searchParams.get('limit') ?? '200'), 500);
  const entries = readLog().slice(0, limit);
  return NextResponse.json({ ok: true, entries, total: entries.length });
}

/** DELETE /api/action-log — borra todo el log */
export async function DELETE(req: NextRequest) {
  const confirm = req.headers.get('X-Confirm');
  if (confirm !== 'CLEAR_LOG') {
    return NextResponse.json({ ok: false, error: 'Falta header X-Confirm: CLEAR_LOG' }, { status: 400 });
  }
  try {
    writeFileSync(ACTION_LOG_PATH, '', 'utf8');
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
