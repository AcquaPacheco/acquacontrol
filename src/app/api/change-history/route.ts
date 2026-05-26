import { NextResponse } from 'next/server';
import { readFileSync, existsSync } from 'fs';
import { HISTORY_PATH } from '@/lib/data-paths';


export async function GET() {
  if (!existsSync(HISTORY_PATH)) return NextResponse.json([]);
  try {
    const data = JSON.parse(readFileSync(HISTORY_PATH, 'utf8'));
    return NextResponse.json(data);
  } catch {
    return NextResponse.json([]);
  }
}
