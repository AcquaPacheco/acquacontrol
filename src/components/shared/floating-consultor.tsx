'use client';

import { useState, useRef, useEffect } from 'react';
import { MessageSquare, X, Send, ArrowUpRight, Sparkles, ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import productsData from '@/data/products.json';
import suppliersData from '@/data/suppliers.json';

// ── Cómputo de stats reales ─────────────────────────────────────────────────
type ProdRow = { cost: number; price: number; margin: number | null; active: boolean; supplierName: string | null; name: string; category: string | null };
const allProducts = productsData as unknown as ProdRow[];
const activeProducts = allProducts.filter(p => p.active !== false);
const sinCosto   = activeProducts.filter(p => !p.cost || p.cost === 0);
const revisar    = activeProducts.filter(p => p.price <= 1 && p.cost > 0);
const criticos   = activeProducts.filter(p => p.margin !== null && p.margin < 35 && p.price > 1 && p.cost > 0);
const buenos     = activeProducts.filter(p => p.margin !== null && p.margin >= 50 && p.price > 1 && p.cost > 0);
const withMargin = activeProducts.filter(p => p.margin !== null && p.price > 1 && p.cost > 0);
const avgMargin  = withMargin.length
  ? Math.round(withMargin.reduce((s, p) => s + p.margin!, 0) / withMargin.length * 10) / 10
  : 0;

// Top proveedor con más productos sin costo
const sinCostoBySupplier = sinCosto.reduce<Record<string, number>>((acc, p) => {
  const s = p.supplierName || 'Sin proveedor';
  acc[s] = (acc[s] || 0) + 1;
  return acc;
}, {});
const topSinCosto = Object.entries(sinCostoBySupplier).sort((a, b) => b[1] - a[1]).slice(0, 3);

// Mejor y peor categoría por margen
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
const bestCat  = catAvgs[0];
const worstCat = catAvgs[catAvgs.length - 1];

const supplierCount = (suppliersData as unknown[]).length;
// ────────────────────────────────────────────────────────────────────────────

const quickChips = [
  { label: '¿Qué hago primero hoy?', key: 'hoy'      },
  { label: 'Productos críticos',     key: 'criticos' },
  { label: 'Costos sin cargar',      key: 'costos'   },
  { label: 'Margen del portfolio',   key: 'margen'   },
  { label: 'Estado general',         key: 'estado'   },
];

function buildChipResponses() {
  const topSinCostoText = topSinCosto.length
    ? topSinCosto.map(([s, n]) => `• ${s}: ${n} productos`).join('\n')
    : '• Sin datos de proveedor disponibles';

  return {
    hoy: sinCosto.length > 0
      ? `Arrancá por **Costos** — ${sinCosto.length} productos sin costo cargado no se pueden exportar a Odoo correctamente.\n\n${topSinCostoText}\n\nDespués revisá Rentabilidad para los ${criticos.length} productos con margen bajo 35%.`
      : `El portfolio está bien cargado. ${criticos.length > 0 ? `Revisá los ${criticos.length} productos con margen crítico en Rentabilidad.` : 'Podés ir directamente a Export Odoo.'}`,

    criticos: criticos.length > 0
      ? `Hay **${criticos.length} productos** con margen menor al 35%:\n${criticos.slice(0,4).map(p => `• ${p.name.slice(0,35)} (${p.margin}%)`).join('\n')}${criticos.length > 4 ? `\n• ...y ${criticos.length - 4} más` : ''}\n\nAbrí Rentabilidad → Vigilar o Crítico para verlos todos.`
      : `¡Excelente! Todos tus productos activos tienen margen ≥ 35%. El portfolio está saludable.`,

    costos: sinCosto.length > 0
      ? `**${sinCosto.length} productos sin costo** cargado:\n${topSinCostoText}\n\nIn Costos → Sin costo encontrás la lista completa para cargar las listas faltantes.`
      : `Todos tus productos activos tienen costo cargado 🎉. Los ${revisar.length} con precio $1 en Odoo pueden ser placeholders — revisalos.`,

    margen: `El margen promedio del portfolio activo es **${avgMargin}%**${avgMargin >= 50 ? ' — excelente ✓' : avgMargin >= 40 ? ' — saludable' : ' — necesita atención'}.\n\n${bestCat ? `Mejor categoría: **${bestCat.cat}** con ${bestCat.avg}%` : ''}\n${worstCat && worstCat !== bestCat ? `Peor categoría: **${worstCat.cat}** con ${worstCat.avg}%` : ''}\n\n${buenos.length} productos con margen ≥ 50% son tus estrellas — potencialos en ML.`,

    estado: `**Portfolio al ${new Date().toLocaleDateString('es-AR')}**\n• ${activeProducts.length} productos activos de ${allProducts.length} totales\n• ${supplierCount} proveedores en sistema\n• Margen promedio: ${avgMargin}%\n• Sin costo: ${sinCosto.length}\n• Críticos (margen <35%): ${criticos.length}\n• Estrellas (margen ≥50%): ${buenos.length}`,
  };
}

interface Message {
  role: 'user' | 'assistant';
  text: string;
}

export function FloatingConsultor() {
  const [open, setOpen]     = useState(false);
  const [input, setInput]   = useState('');
  const greeting = sinCosto.length > 0
    ? `Hola Enrico 👋 Tenés **${sinCosto.length} productos sin costo** y **${criticos.length} con margen crítico**. ¿Arrancamos?`
    : `Hola Enrico 👋 El portfolio está bien cargado — **${avgMargin}% de margen promedio**. ¿En qué te ayudo?`;

  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', text: greeting }
  ]);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = (text: string) => {
    if (!text.trim()) return;
    const userMsg: Message = { role: 'user', text };
    const responses = buildChipResponses();
    const key = quickChips.find(c => c.label === text)?.key || '';
    const reply = (responses as Record<string, string>)[key]
      || `Podés consultarme sobre costos, márgenes, rentabilidad o export. Tengo datos de ${activeProducts.length} productos y ${supplierCount} proveedores cargados.`;
    setMessages(prev => [...prev, userMsg, { role: 'assistant', text: reply }]);
    setInput('');
  };

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen(v => !v)}
        className={cn(
          'fixed right-4 bottom-20 lg:bottom-6 z-50 w-13 h-13 rounded-full shadow-2xl flex items-center justify-center transition-all duration-200',
          open
            ? 'bg-gray-900 rotate-90'
            : 'bg-acqua hover:bg-acqua-dark hover:scale-105',
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
        <div className="fixed right-4 bottom-[84px] lg:bottom-24 z-50 w-[340px] sm:w-[380px] bg-white rounded-2xl shadow-2xl border border-gray-100 flex flex-col overflow-hidden"
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
                <p className="text-white/40 text-[10px] mt-0.5">Consultor de negocio</p>
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

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
            {messages.map((m, i) => (
              <div key={i} className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
                {m.role === 'assistant' && (
                  <div className="w-6 h-6 rounded-full bg-acqua/10 border border-acqua/20 flex items-center justify-center shrink-0 mr-2 mt-0.5">
                    <Sparkles className="w-3 h-3 text-acqua" />
                  </div>
                )}
                <div className={cn(
                  'max-w-[85%] rounded-xl px-3 py-2.5 text-[12px] leading-relaxed',
                  m.role === 'user'
                    ? 'bg-acqua text-white rounded-br-sm'
                    : 'bg-gray-50 text-gray-800 rounded-bl-sm border border-gray-100',
                )}>
                  {m.text.split('\n').map((line, j) => (
                    <p key={j} className={line.startsWith('•') ? 'ml-2' : ''}>
                      {line.replace(/\*\*(.*?)\*\*/g, '$1')}
                    </p>
                  ))}
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          {/* Quick chips */}
          {messages.length <= 2 && (
            <div className="px-3 pb-2 flex gap-1.5 flex-wrap shrink-0">
              {quickChips.map(c => (
                <button
                  key={c.key}
                  onClick={() => sendMessage(c.label)}
                  className="flex items-center gap-1 px-2.5 py-1 bg-gray-50 border border-gray-200 rounded-full text-[11px] font-medium text-gray-600 hover:bg-acqua/5 hover:border-acqua/30 hover:text-acqua transition-colors"
                >
                  {c.label} <ChevronRight className="w-3 h-3" />
                </button>
              ))}
            </div>
          )}

          {/* Input */}
          <div className="px-3 pb-3 pt-1 shrink-0 border-t border-gray-100">
            <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 focus-within:ring-2 focus-within:ring-acqua/20 focus-within:border-acqua transition-all">
              <input
                type="text"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && sendMessage(input)}
                placeholder="Preguntá algo…"
                className="flex-1 bg-transparent text-[12px] text-gray-700 placeholder-gray-400 focus:outline-none"
              />
              <button
                onClick={() => sendMessage(input)}
                disabled={!input.trim()}
                className="w-7 h-7 flex items-center justify-center rounded-lg bg-acqua disabled:opacity-30 hover:bg-acqua-dark transition-colors"
              >
                <Send className="w-3.5 h-3.5 text-white" />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
