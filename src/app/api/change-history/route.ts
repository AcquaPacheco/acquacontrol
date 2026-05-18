import { NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const HISTORY_PATH = resolve(process.cwd(), 'src/data/change-history.json');

export async function GET() {
  if (!existsSync(HISTORY_PATH)) return NextResponse.json([]);
  try {
    const data = JSON.parse(readFileSync(HISTORY_PATH, 'utf8'));
    return NextResponse.json(data);
  } catch {
    return NextResponse.json([]);
  }
}
