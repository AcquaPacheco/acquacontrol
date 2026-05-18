'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { MessageSquare, X, Send, ArrowUpRight, Sparkles, ChevronRight, Loader2, AlertCircle } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { loadGeminiKey } from '@/lib/gemini-key';
import productsData from '@/data/products.json';
import suppliersData from '@/data/suppliers.json';

// ── Cómputo de stats reales ─────────────────────────────────────────────────
type ProdRow = { cost: number; price: number; margin: number | null; active: boolean; supplierName: string | null; name: string; category: string | null };
const allProducts   = productsData as unknown as ProdRow[];
const activeProducts = allProducts.filter(p => p.active !== false);
const sinCosto       = activeProducts.filter(p => !p.cost || p.cost === 0);
const sinPrecio      = activeProducts.filter(p => !p.price || p.price <= 1);
const criticos       = activeProducts.filter(p => p.margin !== null && p.margin < 35 && p.price > 1 && p.cost > 0);
const buenos         = activeProducts.filter(p => p.margin !== null && p.margin >= 50 && p.price > 1 && p.cost > 0);
const withMargin     = activeProducts.filter(p => p.margin !== null && p.price > 1 && p.cost > 0);
const avgMargin      = withMargin.length
  ? Math.round(withMargin.reduce((s, p) => s + p.margin!, 0) / withMargin.length * 10) / 10
  : 0;
const supplierCount  = (suppliersData as unknown[]).length;

const catMargins = activeProducts
  .filter(p => p.margin !== null && p.price > 1 && p.cost > 0 && p.category)
  .reduce<Record<string, number[]>>((acc, p) => {
    const cat = (p.category || 'Sin cat.').split(' / ')[0];
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(p.margin!);
    return acc;
  }, {});
const catAvgs = Object.entries(catMargins)
  .filter(([, v]) => v.length >= 3)
  .map(([cat, vals]) => ({ cat, avg: Math.round(vals.reduce((s, v) => s + v, 0) / vals.length) }))
  .sort((a, b) => b.avg - a.avg);
const bestCat  = catAvgs[0]  ? `${catAvgs[0].cat} (${catAvgs[0].avg}%)` : '—';
const worstCat = catAvgs[catAvgs.length - 1] && catAvgs.length > 1
  ? `${catAvgs[catAvgs.length - 1].cat} (${catAvgs[catAvgs.length - 1].avg}%)` : '—';
// ────────────────────────────────────────────────────────────────────────────

const quickChips = [
  { label: '¿Qué hago primero hoy?' },
  { label: 'Productos sin costo' },
  { label: 'Estado del portfolio' },
  { label: 'Cómo importar datos' },
  { label: 'Dónde pongo la clave Gemini' },
];

interface Message {
  role: 'user' | 'assistant';
  text: string;
  streaming?: boolean;
}

function renderText(text: string) {
  return text.split('\n').map((line, i) => {
    // Bold **text**
    const parts = line.split(/(\*\*[^*]+\*\*)/g);
    return (
      <p key={i} className={cn('leading-relaxed', line.startsWith('•') || line.startsWith('-') ? 'ml-2' : '', line.startsWith('━') ? 'text-gray-400 text-[10px] my-0.5' : '')}>
        {parts.map((part, j) =>
          /^\*\*[^*]+\*\*$/.test(part)
            ? <strong key={j}>{part.slice(2, -2)}</strong>
            : part
        )}
      </p>
    );
  });
}

export function FloatingConsultor() {
  const pathname = usePathname();
  const [open, setOpen]       = useState(false);
  const [input, setInput]     = useState('');
  const [loading, setLoading] = useState(false);
  const [geminiKey, setGeminiKey] = useState('');
  const [noKey, setNoKey]     = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLInputElement>(null);

  const greeting = sinCosto.length > 0
    ? `Hola Enrico 👋 Tenés **${sinCosto.length} productos sin costo** y **${criticos.length}** con margen crítico. ¿En qué te ayudo?`
    : `Hola Enrico 👋 El portfolio está bien — **${avgMargin}% de margen promedio**. ¿En qué te ayudo?`;

  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', text: greeting },
  ]);

  useEffect(() => { setGeminiKey(loadGeminiKey()); }, []);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);
  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 150); }, [open]);

  const appContext = {
    totalActive: activeProducts.length,
    sinCosto: sinCosto.length,
    sinPrecio: sinPrecio.length,
    avgMargin,
    criticos: criticos.length,
    buenos: buenos.length,
    proveedores: supplierCount,
    bestCat,
    worstCat,
    currentPage: pathname,
  };

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || loading) return;
    setNoKey(false);

    const userMsg: Message = { role: 'user', text };
    const newHistory = [...messages, userMsg];
    setMessages([...newHistory, { role: 'assistant', text: '', streaming: true }]);
    setInput('');
    setLoading(true);

    // Si no hay clave Gemini, respuesta offline básica
    if (!geminiKey) {
      setNoKey(true);
      const offlineReply = getOfflineReply(text);
      setTimeout(() => {
        setMessages([...newHistory, { role: 'assistant', text: offlineReply }]);
        setLoading(false);
      }, 400);
      return;
    }

    try {
      const res = await fetch('/api/consultor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Gemini-Key': geminiKey },
        body: JSON.stringify({
          messages: newHistory.map(m => ({ role: m.role, text: m.text })),
          context: appContext,
        }),
      });

      if (!res.ok || !res.body) {
        throw new Error(`Error ${res.status}`);
      }

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        accumulated += decoder.decode(value, { stream: true });
        setMessages([...newHistory, { role: 'assistant', text: accumulated, streaming: true }]);
      }

      setMessages([...newHistory, { role: 'assistant', text: accumulated }]);
    } catch (e) {
      const errMsg = `No pude conectarme a la IA. Verificá tu clave Gemini o intentá de nuevo. (${String(e).slice(0, 60)})`;
      setMessages([...newHistory, { role: 'assistant', text: errMsg }]);
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, loading, geminiKey, pathname]);

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen(v => !v)}
        className={cn(
          'fixed right-4 bottom-20 lg:bottom-6 z-50 rounded-full shadow-2xl flex items-center justify-center transition-all duration-200',
          open ? 'bg-gray-900 rotate-90' : 'bg-acqua hover:bg-acqua-dark hover:scale-105',
        )}
        style={{ width: 52, height: 52 }}
        title="Consultor Acqua"
      >
        {open
          ? <X className="w-5 h-5 text-white" />
          : <MessageSquare className="w-5 h-5 text-white" />}
      </button>

      {/* Panel */}
      {open && (
        <div
          className="fixed right-4 bottom-[84px] lg:bottom-24 z-50 w-[340px] sm:w-[390px] bg-white rounded-2xl shadow-2xl border border-gray-100 flex flex-col overflow-hidden"
          style={{ maxHeight: 'calc(100dvh - 140px)' }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 bg-[#07111F] shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-acqua/20 border border-acqua/40 flex items-center justify-center">
                <Sparkles className="w-4 h-4 text-acqua" />
              </div>
              <div>
                <p className="text-white text-[12px] font-bold leading-none">Socio Acqua</p>
                <p className="text-white/40 text-[10px] mt-0.5">
                  {geminiKey ? 'Consultor IA activo' : 'Modo básico — configurá clave IA'}
                </p>
              </div>
            </div>
            <Link
              href="/consultor"
              onClick={() => setOpen(false)}
              className="flex items-center gap-1 text-[10px] text-white/50 hover:text-white transition-colors"
            >
              Abrir completo <ArrowUpRight className="w-3 h-3" />
            </Link>
          </div>

          {/* No key warning */}
          {noKey && (
            <div className="flex items-start gap-2 bg-amber-50 border-b border-amber-100 px-3 py-2 shrink-0">
              <AlertCircle className="w-3.5 h-3.5 text-amber-500 mt-0.5 shrink-0" />
              <p className="text-[10px] text-amber-700">
                Sin clave Gemini — respuestas básicas. Configurala en{' '}
                <Link href="/mercadolibre" onClick={() => setOpen(false)} className="underline font-medium">
                  ML Lab → Clave IA
                </Link>
              </p>
            </div>
          )}

          {/* Stats chips */}
          <div className="flex gap-2 px-3 pt-2.5 pb-1.5 shrink-0 border-b border-gray-50 overflow-x-auto">
            {[
              { label: `${sinCosto.length} sin costo`, color: sinCosto.length > 0 ? 'text-amber-600 bg-amber-50' : 'text-green-600 bg-green-50' },
              { label: `${criticos.length} críticos`,  color: criticos.length > 0  ? 'text-red-600 bg-red-50'    : 'text-green-600 bg-green-50' },
              { label: `${avgMargin}% margen`,         color: 'text-acqua bg-acqua/5' },
            ].map(s => (
              <span key={s.label} className={cn('px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap shrink-0', s.color)}>
                {s.label}
              </span>
            ))}
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-0">
            {messages.map((m, i) => (
              <div key={i} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
                {m.role === 'assistant' && (
                  <div className="w-6 h-6 rounded-full bg-acqua/10 border border-acqua/20 flex items-center justify-center shrink-0 mr-2 mt-0.5">
                    {m.streaming && loading
                      ? <Loader2 className="w-3 h-3 text-acqua animate-spin" />
                      : <Sparkles className="w-3 h-3 text-acqua" />}
                  </div>
                )}
                <div className={cn(
                  'max-w-[85%] rounded-xl px-3 py-2.5 text-[12px]',
                  m.role === 'user'
                    ? 'bg-acqua text-white rounded-br-sm'
                    : 'bg-gray-50 text-gray-800 rounded-bl-sm border border-gray-100',
                )}>
                  {m.role === 'assistant' ? renderText(m.text || '…') : <p>{m.text}</p>}
                  {m.streaming && loading && (
                    <span className="inline-block w-1.5 h-3.5 bg-acqua/60 animate-pulse ml-0.5 align-middle rounded-sm" />
                  )}
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          {/* Quick chips — solo si hay pocos mensajes */}
          {messages.length <= 2 && !loading && (
            <div className="px-3 pb-2 flex gap-1.5 flex-wrap shrink-0">
              {quickChips.map(c => (
                <button
                  key={c.label}
                  onClick={() => sendMessage(c.label)}
                  className="flex items-center gap-1 px-2.5 py-1 bg-gray-50 border border-gray-200 rounded-full text-[11px] font-medium text-gray-600 hover:bg-acqua/5 hover:border-acqua/30 hover:text-acqua transition-colors"
                >
                  {c.label} <ChevronRight className="w-3 h-3" />
                </button>
              ))}
            </div>
          )}

          {/* Input */}
          <div className="px-3 pb-3 pt-1.5 shrink-0 border-t border-gray-100">
            <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 focus-within:ring-2 focus-within:ring-acqua/20 focus-within:border-acqua transition-all">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !loading && sendMessage(input)}
                placeholder={loading ? 'Procesando…' : 'Preguntá algo…'}
                disabled={loading}
                className="flex-1 bg-transparent text-[12px] text-gray-700 placeholder-gray-400 focus:outline-none disabled:opacity-50"
              />
              <button
                onClick={() => sendMessage(input)}
                disabled={!input.trim() || loading}
                className="w-7 h-7 flex items-center justify-center rounded-lg bg-acqua disabled:opacity-30 hover:bg-acqua-dark transition-colors"
              >
                {loading
                  ? <Loader2 className="w-3.5 h-3.5 text-white animate-spin" />
                  : <Send className="w-3.5 h-3.5 text-white" />}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Respuestas offline básicas (sin clave IA) ────────────────────────────────
function getOfflineReply(text: string): string {
  const t = text.toLowerCase();

  if (t.includes('gemini') || t.includes('clave') || t.includes('ia')) {
    return `La clave Gemini la configurás en **ML Lab** (ícono de MercadoLibre en el menú) → sección "Clave IA" al pie del panel derecho.\n\nLa podés obtener gratis en **aistudio.google.com/app/apikey** → "Create API key".`;
  }
  if (t.includes('import') || t.includes('datos') || t.includes('cargar') || t.includes('localhost')) {
    return `Para importar datos:\n1. Corré **npm run dev** en la carpeta del proyecto\n2. Entrá a **localhost:3000/parametros**\n3. Importá en orden: Productos → Proveedor info → Contactos → Stock\n\nEn Vercel no funciona porque el filesystem es de solo lectura.`;
  }
  if (t.includes('sin costo') || t.includes('costo')) {
    return `Tenés **${sinCosto.length} productos sin costo**. Para cargarlos: andá a la ficha del proveedor → "Catálogo completo" → cargá la lista de precios (Excel, PDF o imagen). El sistema interpreta cualquier formato.`;
  }
  if (t.includes('hoy') || t.includes('primero')) {
    return sinCosto.length > 0
      ? `Arrancá por cargar los **${sinCosto.length} costos faltantes** — sin costo no podés exportar a Odoo ni calcular márgenes. Después revisá los **${criticos.length} productos críticos** en Rentabilidad.`
      : `El portfolio está sano. Revisá los **${criticos.length} productos con margen crítico** en Rentabilidad y actualizá precios en ML si corresponde.`;
  }
  if (t.includes('portfolio') || t.includes('estado') || t.includes('margen')) {
    return `Portfolio al ${new Date().toLocaleDateString('es-AR')}:\n• **${activeProducts.length}** productos activos\n• Margen promedio: **${avgMargin}%**\n• Sin costo: **${sinCosto.length}**\n• Críticos (<35%): **${criticos.length}**\n• Estrellas (≥50%): **${buenos.length}**`;
  }
  return `Sin clave IA solo puedo darte respuestas básicas. Configurá la clave Gemini en ML Lab para que pueda ayudarte con cualquier pregunta.\n\nMientras tanto, usá los chips de arriba para las preguntas más comunes.`;
}
