import { NextRequest, NextResponse } from 'next/server';
import { writeFileSync, unlinkSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

// ─── POST /api/extract-pdf-photos ────────────────────────────────────────────
// Body: { pdfBase64: string }
// Returns: { ok: true, images: PdfImage[], count: number }
//
// Writes the PDF to a temp file with ASCII name (avoids Windows encoding issues
// with accented chars in original filenames), then calls the Python script.

export async function POST(req: NextRequest) {
  let tempPath: string | null = null;
  try {
    const body = await req.json() as { pdfBase64?: string };
    const { pdfBase64 } = body;
    if (!pdfBase64) {
      return NextResponse.json({ ok: false, error: 'Missing pdfBase64' }, { status: 400 });
    }

    // Write PDF to temp file with ASCII-safe name
    const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    tempPath = join(tmpdir(), `pdf_extract_${stamp}.pdf`);
    const pdfBuffer = Buffer.from(pdfBase64, 'base64');
    writeFileSync(tempPath, pdfBuffer);

    // Resolve the Python script path
    const scriptPath = resolve(process.cwd(), 'scripts', 'extract-pdf-photos.py');
    if (!existsSync(scriptPath)) {
      return NextResponse.json({ ok: false, error: `Script not found: ${scriptPath}` }, { status: 500 });
    }

    // Use 'python' on Windows, 'python3' on Unix
    const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';

    const { stdout, stderr } = await execFileAsync(pythonCmd, [scriptPath, tempPath], {
      maxBuffer: 350 * 1024 * 1024, // 350 MB — large PDFs with many images
      timeout: 180_000,             // 3 minutes
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });

    if (stderr) {
      console.warn('[extract-pdf-photos] stderr:', stderr.slice(0, 500));
    }

    const parsed = JSON.parse(stdout) as unknown;
    if (Array.isArray(parsed)) {
      return NextResponse.json({ ok: true, images: parsed, count: parsed.length });
    }

    // Script returned an error object
    const errObj = parsed as { error?: string };
    return NextResponse.json({ ok: false, error: errObj.error ?? 'Unknown script error' }, { status: 500 });

  } catch (e) {
    console.error('[extract-pdf-photos] error:', e);
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  } finally {
    if (tempPath && existsSync(tempPath)) {
      try { unlinkSync(tempPath); } catch { /* ignore cleanup errors */ }
    }
  }
}
