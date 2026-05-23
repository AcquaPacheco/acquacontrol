import { spawn } from 'child_process';

export const dynamic = 'force-dynamic';

export async function POST() {
  // Bloquear si corre en Vercel (serverless)
  if (process.env.VERCEL) {
    return Response.json(
      { error: 'El deploy solo puede iniciarse desde el servidor local.' },
      { status: 403 }
    );
  }

  const encoder = new TextEncoder();
  const cwd = process.cwd();

  const stream = new ReadableStream({
    start(controller) {
      const send = (msg: string, extra?: Record<string, unknown>) => {
        const payload = JSON.stringify({ msg, ...extra });
        controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
      };

      send(`📂 Directorio: ${cwd}`);
      send('🚀 Iniciando deploy a Vercel...');

      const proc = spawn('npx', ['vercel', '--prod', '--yes'], {
        cwd,
        shell: true,
        env: { ...process.env, FORCE_COLOR: '0' },
      });

      const parseLine = (line: string) => {
        const clean = line.replace(/\x1B\[[0-9;]*m/g, '').trim();
        if (!clean) return;

        // Detectar URL de producción
        const urlMatch = clean.match(/https:\/\/[a-z0-9-]+\.vercel\.app/);
        if (urlMatch) {
          send(clean, { url: urlMatch[0] });
        } else {
          send(clean);
        }
      };

      proc.stdout?.on('data', (data: Buffer) => {
        data.toString().split('\n').forEach(parseLine);
      });

      proc.stderr?.on('data', (data: Buffer) => {
        data.toString().split('\n').forEach(parseLine);
      });

      proc.on('close', (code: number | null) => {
        if (code === 0) {
          send('✅ Deploy completado exitosamente!', { done: true, success: true });
        } else {
          send(`❌ El deploy falló (código ${code ?? 'desconocido'})`, { done: true, success: false });
        }
        controller.close();
      });

      proc.on('error', (err: Error) => {
        send(`❌ Error al iniciar proceso: ${err.message}`, { done: true, success: false });
        controller.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
