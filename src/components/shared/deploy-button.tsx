'use client';

import { useState, useEffect, useRef } from 'react';
import { Upload, X, CheckCircle2, AlertCircle, Loader2, ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils';

interface LogEntry {
  msg: string;
  url?: string;
  done?: boolean;
  success?: boolean;
}

export function DeployButton() {
  const [isLocal, setIsLocal] = useState(false);
  const [open, setOpen] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [deployUrl, setDeployUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'running' | 'success' | 'error'>('idle');
  const logEndRef = useRef<HTMLDivElement>(null);

  // Solo mostrar en localhost
  useEffect(() => {
    setIsLocal(
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1'
    );
  }, []);

  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  const startDeploy = async () => {
    setLogs([]);
    setDeployUrl(null);
    setDeploying(true);
    setStatus('running');
    setOpen(true);

    try {
      const res = await fetch('/api/deploy', { method: 'POST' });

      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: 'Error desconocido' })) as { error?: string };
        setLogs([{ msg: `❌ ${err.error ?? 'Error al iniciar deploy'}`, done: true, success: false }]);
        setStatus('error');
        setDeploying(false);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const entry = JSON.parse(line.slice(6)) as LogEntry;
            setLogs(prev => [...prev, entry]);
            if (entry.url) setDeployUrl(entry.url);
            if (entry.done) {
              setStatus(entry.success ? 'success' : 'error');
              setDeploying(false);
            }
          } catch {
            // ignore parse errors
          }
        }
      }
    } catch (err) {
      setLogs(prev => [
        ...prev,
        { msg: `❌ Error de conexión: ${err instanceof Error ? err.message : 'desconocido'}`, done: true, success: false },
      ]);
      setStatus('error');
      setDeploying(false);
    }
  };

  if (!isLocal) return null;

  return (
    <>
      {/* ── Botón en el header ── */}
      <button
        onClick={() => (status === 'idle' ? startDeploy() : setOpen(true))}
        className={cn(
          'flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all duration-150 whitespace-nowrap shrink-0',
          status === 'success'
            ? 'bg-green-500/20 text-green-400 hover:bg-green-500/30'
            : status === 'error'
            ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
            : status === 'running'
            ? 'bg-acqua/20 text-acqua animate-pulse cursor-wait'
            : 'bg-white/10 text-white/70 hover:bg-white/20 hover:text-white'
        )}
        disabled={deploying && status === 'running'}
        title="Publicar cambios en Vercel"
      >
        {status === 'running' ? (
          <Loader2 className="w-3 h-3 animate-spin" />
        ) : status === 'success' ? (
          <CheckCircle2 className="w-3 h-3" />
        ) : status === 'error' ? (
          <AlertCircle className="w-3 h-3" />
        ) : (
          <Upload className="w-3 h-3" />
        )}
        <span className="hidden xl:inline">
          {status === 'running' ? 'Publicando...' : status === 'success' ? 'Publicado' : status === 'error' ? 'Error deploy' : 'Publicar'}
        </span>
      </button>

      {/* ── Modal con log ── */}
      {open && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-xl bg-[#0D1B2A] border border-white/10 rounded-2xl shadow-2xl flex flex-col overflow-hidden">

            {/* Header */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/10">
              <div className="flex items-center gap-2.5">
                {status === 'running' && <Loader2 className="w-4 h-4 text-acqua animate-spin" />}
                {status === 'success' && <CheckCircle2 className="w-4 h-4 text-green-400" />}
                {status === 'error' && <AlertCircle className="w-4 h-4 text-red-400" />}
                {status === 'idle' && <Upload className="w-4 h-4 text-white/60" />}
                <span className="text-white text-[13px] font-semibold">Deploy a Vercel</span>
              </div>
              <button onClick={() => setOpen(false)} className="text-white/40 hover:text-white transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Log output */}
            <div className="flex-1 overflow-y-auto h-72 p-4 font-mono text-[11px] leading-5 bg-[#060f18] space-y-0.5">
              {logs.length === 0 && (
                <p className="text-white/30 italic">Esperando output...</p>
              )}
              {logs.map((entry, i) => (
                <p
                  key={i}
                  className={cn(
                    'whitespace-pre-wrap break-all',
                    entry.msg.startsWith('✅') ? 'text-green-400' :
                    entry.msg.startsWith('❌') ? 'text-red-400' :
                    entry.msg.startsWith('🚀') || entry.msg.startsWith('📂') ? 'text-acqua' :
                    entry.url ? 'text-yellow-300 font-semibold' :
                    'text-white/70'
                  )}
                >
                  {entry.msg}
                </p>
              ))}
              <div ref={logEndRef} />
            </div>

            {/* Footer */}
            <div className="px-5 py-3 border-t border-white/10 flex items-center justify-between gap-3">
              {deployUrl ? (
                <a
                  href={deployUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-[12px] text-acqua hover:underline font-medium truncate"
                >
                  <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                  {deployUrl}
                </a>
              ) : (
                <span className="text-white/30 text-[11px]">
                  {status === 'running' ? 'Procesando...' : 'acqua-control-os.vercel.app'}
                </span>
              )}

              <div className="flex gap-2 shrink-0">
                {!deploying && (
                  <button
                    onClick={startDeploy}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-semibold rounded-lg bg-acqua text-white hover:bg-acqua/80 transition-colors"
                  >
                    <Upload className="w-3 h-3" />
                    {status === 'idle' ? 'Publicar' : 'Re-deploy'}
                  </button>
                )}
                <button
                  onClick={() => { setOpen(false); if (status !== 'running') setStatus('idle'); }}
                  className="px-3 py-1.5 text-[11px] font-medium rounded-lg bg-white/5 text-white/60 hover:bg-white/10 transition-colors"
                >
                  {deploying ? 'Cerrar' : 'OK'}
                </button>
              </div>
            </div>

          </div>
        </div>
      )}
    </>
  );
}
