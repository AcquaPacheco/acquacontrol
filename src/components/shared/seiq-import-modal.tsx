'use client';

import { useState, useEffect } from 'react';
import { X, RefreshCw, CheckCircle2, AlertTriangle, ChevronDown, Tag } from 'lucide-react';
import { cn } from '@/lib/utils';
import seiqCatalogRaw from '@/data/seiq-catalog.json';

// ─── Types ──────────────────────────────────────────────────────────────────

interface CatalogProduct {
  code: string;
  desc: string;
  priceUnit?: number;
  priceBox?: number;
}

interface CategoryConfig {
  discount: number;
  priceField: 'unit' | 'box';
  products: CatalogProduct[];
}

type SeiqCatalog = Record<string, CategoryConfig>;

const seiqCatalog = seiqCatalogRaw as unknown as SeiqCatalog;

// Categories in display order
const CATEGORIES = ['Bidones', 'Sobres', 'Masivo', 'Aerosoles', 'Alimenticia'] as const;
type SeiqCategory = typeof CATEGORIES[number];

// Default discounts
const DEFAULT_DISCOUNTS: Record<string, number> = {
  Bidones:     30,
  Sobres:      20,
  Masivo:      30,
  Aerosoles:    0,
  Alimenticia: 30,
};

// Category color scheme
const CAT_COLORS: Record<string, { bg: string; text: string; border: string; badge: string }> = {
  Bidones:     { bg: 'bg-blue-50',   text: 'text-blue-700',   border: 'border-blue-200',   badge: 'bg-blue-100 text-blue-700' },
  Sobres:      { bg: 'bg-green-50',  text: 'text-green-700',  border: 'border-green-200',  badge: 'bg-green-100 text-green-700' },
  Masivo:      { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200', badge: 'bg-orange-100 text-orange-700' },
  Aerosoles:   { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200', badge: 'bg-purple-100 text-purple-700' },
  Alimenticia: { bg: 'bg-red-50',    text: 'text-red-700',    border: 'border-red-200',    badge: 'bg-red-100 text-red-700' },
};

interface CurrentProduct {
  supplierCode: string | null;
  name: string;
  cost: number;
  seiqCategory?: string;
}

interface ApplyResult {
  matched: number;
  notFound: number;
  updated: Array<{ code: string; name: string; oldCost: number; newCost: number }>;
  notFoundCodes: string[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n);
}

function pctDiff(oldVal: number, newVal: number) {
  if (!oldVal) return null;
  return ((newVal - oldVal) / oldVal) * 100;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function SeiqImportModal({
  onClose,
  currentProducts,
}: {
  onClose: (refreshed?: boolean) => void;
  currentProducts: CurrentProduct[];
}) {
  const [activeTab, setActiveTab]     = useState<SeiqCategory>('Bidones');
  const [discounts, setDiscounts]     = useState<Record<string, number>>(DEFAULT_DISCOUNTS);
  const [priceFields, setPriceFields] = useState<Record<string, 'unit' | 'box'>>({
    Bidones: 'unit', Sobres: 'unit', Masivo: 'unit', Aerosoles: 'unit', Alimenticia: 'unit',
  });
  const [phase, setPhase]         = useState<'preview' | 'applying' | 'done' | 'error'>('preview');
  const [result, setResult]       = useState<ApplyResult | null>(null);
  const [errorMsg, setErrorMsg]   = useState<string | null>(null);

  // Build current cost map by normalized code
  const currentCostMap = new Map<string, { cost: number; name: string }>();
  for (const p of currentProducts) {
    if (p.supplierCode) {
      currentCostMap.set(p.supplierCode.trim().toUpperCase(), { cost: p.cost, name: p.name });
    }
  }

  const catData = seiqCatalog[activeTab];
  const discount = discounts[activeTab] ?? 0;
  const priceField = priceFields[activeTab] ?? 'unit';

  // Compute preview rows for current tab
  const rows = (catData?.products ?? []).map(prod => {
    const code = prod.code.trim().toUpperCase();
    const basePrice = priceField === 'unit' ? prod.priceUnit : prod.priceBox;
    const newCost = basePrice ? Math.round(basePrice * (1 - discount / 100) * 100) / 100 : null;
    const current = currentCostMap.get(code);
    const diff = current && newCost ? pctDiff(current.cost, newCost) : null;
    return { prod, code, basePrice, newCost, current, diff };
  });

  const matchedCount  = rows.filter(r => r.current).length;
  const unmatchedRows = rows.filter(r => !r.current);

  const handleApply = async () => {
    setPhase('applying');
    try {
      const entries = (catData?.products ?? []).map(p => ({
        code: p.code,
        priceUnit: p.priceUnit,
        priceBox:  p.priceBox,
      }));

      const res = await fetch('/api/seiq-prices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category:   activeTab,
          discount,
          priceField,
          entries,
          dryRun: false,
        }),
      });

      const data = await res.json() as {
        ok: boolean;
        updated?: Array<{ code: string; name: string; oldCost: number; newCost: number }>;
        notFound?: string[];
        summary?: { matched: number; notFound: number };
        error?: string;
      };

      if (!data.ok) throw new Error(data.error ?? 'Error desconocido');

      setResult({
        matched:       data.summary?.matched ?? 0,
        notFound:      data.summary?.notFound ?? 0,
        updated:       data.updated ?? [],
        notFoundCodes: data.notFound ?? [],
      });
      setPhase('done');
    } catch (e) {
      setErrorMsg(String(e));
      setPhase('error');
    }
  };

  const colors = CAT_COLORS[activeTab] ?? CAT_COLORS['Bidones'];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl max-h-[90vh] flex flex-col">

        {/* ── Header ── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-acqua/10 flex items-center justify-center">
              <Tag className="w-4.5 h-4.5 text-acqua" />
            </div>
            <div>
              <h3 className="font-bold text-gray-900 text-[14px]">Actualizar precios SEIQ</h3>
              <p className="text-[11px] text-gray-400 mt-0.5">Seleccioná la categoría y aplicá el descuento correspondiente</p>
            </div>
          </div>
          <button
            onClick={() => onClose(phase === 'done')}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ── Category tabs ── */}
        <div className="flex gap-1.5 px-6 pt-4 shrink-0 flex-wrap">
          {CATEGORIES.map(cat => {
            const catColors = CAT_COLORS[cat];
            const isActive  = activeTab === cat;
            const catProds  = seiqCatalog[cat]?.products ?? [];
            const matched   = catProds.filter(p => currentCostMap.has(p.code.trim().toUpperCase())).length;
            return (
              <button
                key={cat}
                onClick={() => { setActiveTab(cat); setPhase('preview'); setResult(null); }}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[12px] font-semibold border transition-all',
                  isActive
                    ? cn(catColors.bg, catColors.text, catColors.border, 'shadow-sm')
                    : 'bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100'
                )}
              >
                {cat}
                <span className={cn(
                  'text-[10px] px-1.5 py-0.5 rounded-full font-bold',
                  isActive ? catColors.badge : 'bg-gray-200 text-gray-500'
                )}>
                  {matched}/{catProds.length}
                </span>
              </button>
            );
          })}
        </div>

        {/* ── Controls (discount + price field) ── */}
        <div className={cn('mx-6 mt-3 p-3 rounded-xl border flex items-center gap-4 shrink-0', colors.bg, colors.border)}>
          <div>
            <label className="block text-[10px] font-semibold uppercase text-gray-500 tracking-wide mb-1">
              Descuento {activeTab}
            </label>
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                min={0}
                max={100}
                step={0.5}
                value={discounts[activeTab] ?? 0}
                onChange={e => setDiscounts(prev => ({ ...prev, [activeTab]: parseFloat(e.target.value) || 0 }))}
                className="w-20 px-2 py-1 text-[13px] font-bold border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-acqua/30"
              />
              <span className="text-[13px] font-bold text-gray-600">%</span>
            </div>
          </div>

          <div className="w-px h-10 bg-gray-200" />

          <div>
            <label className="block text-[10px] font-semibold uppercase text-gray-500 tracking-wide mb-1">
              Precio base
            </label>
            <div className="flex gap-1.5">
              {(['unit', 'box'] as const).map(field => {
                const label = field === 'unit' ? 'Unitario / Bidón' : 'Caja';
                return (
                  <button
                    key={field}
                    onClick={() => setPriceFields(prev => ({ ...prev, [activeTab]: field }))}
                    className={cn(
                      'px-2.5 py-1 rounded-lg text-[11px] font-semibold border transition-all',
                      priceFields[activeTab] === field
                        ? cn(colors.text, colors.border, colors.bg, 'shadow-sm')
                        : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
                    )}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="ml-auto text-right">
            <div className="text-[10px] text-gray-500 uppercase font-semibold tracking-wide">Coinciden</div>
            <div className={cn('text-[18px] font-black', colors.text)}>
              {matchedCount} <span className="text-[12px] font-normal text-gray-400">/ {rows.length}</span>
            </div>
          </div>
        </div>

        {/* ── Product list ── */}
        {phase === 'preview' && (
          <div className="flex-1 overflow-y-auto min-h-0 mx-6 my-3">
            <table className="w-full text-[11px]">
              <thead className="sticky top-0 bg-gray-50 z-10">
                <tr className="border-b border-gray-200">
                  <th className="text-left px-2 py-2 text-[10px] font-semibold text-gray-400 uppercase tracking-wide w-24">Código</th>
                  <th className="text-left px-2 py-2 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Descripción</th>
                  <th className="text-right px-2 py-2 text-[10px] font-semibold text-gray-400 uppercase tracking-wide w-28">Precio lista</th>
                  <th className="text-right px-2 py-2 text-[10px] font-semibold text-gray-400 uppercase tracking-wide w-24">Costo actual</th>
                  <th className="text-right px-2 py-2 text-[10px] font-semibold text-gray-400 uppercase tracking-wide w-24">Nuevo costo</th>
                  <th className="text-right px-2 py-2 text-[10px] font-semibold text-gray-400 uppercase tracking-wide w-16">Δ%</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ prod, basePrice, newCost, current, diff }) => (
                  <tr
                    key={prod.code}
                    className={cn(
                      'border-b border-gray-50 hover:bg-gray-50/50 transition-colors',
                      !current && 'opacity-40'
                    )}
                  >
                    <td className="px-2 py-2">
                      <span className="font-mono text-[10px] text-gray-500 bg-gray-100 px-1.5 py-0.5 rounded">
                        {prod.code}
                      </span>
                    </td>
                    <td className="px-2 py-2">
                      <span className="text-gray-700 line-clamp-1">{current?.name ?? prod.desc}</span>
                    </td>
                    <td className="px-2 py-2 text-right font-medium text-gray-600">
                      {basePrice ? fmt(basePrice) : '—'}
                    </td>
                    <td className="px-2 py-2 text-right text-gray-500">
                      {current ? fmt(current.cost) : <span className="text-gray-300">No encontrado</span>}
                    </td>
                    <td className="px-2 py-2 text-right font-semibold text-gray-800">
                      {newCost ? fmt(newCost) : '—'}
                    </td>
                    <td className="px-2 py-2 text-right">
                      {diff !== null ? (
                        <span className={cn(
                          'text-[10px] font-bold px-1.5 py-0.5 rounded',
                          diff > 0 ? 'bg-red-100 text-red-600' : diff < 0 ? 'bg-green-100 text-green-600' : 'bg-gray-100 text-gray-500'
                        )}>
                          {diff > 0 ? '+' : ''}{diff.toFixed(1)}%
                        </span>
                      ) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {unmatchedRows.length > 0 && (
              <div className="mt-3 p-3 bg-yellow-50 border border-yellow-200 rounded-xl">
                <p className="text-[11px] font-semibold text-yellow-700 flex items-center gap-1.5 mb-1.5">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  {unmatchedRows.length} productos no encontrados en el sistema (se ignorarán)
                </p>
                <div className="flex flex-wrap gap-1">
                  {unmatchedRows.map(r => (
                    <span key={r.prod.code} className="font-mono text-[10px] bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded">
                      {r.prod.code}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Applying ── */}
        {phase === 'applying' && (
          <div className="flex-1 flex flex-col items-center justify-center py-10 gap-3">
            <RefreshCw className="w-8 h-8 text-acqua animate-spin" />
            <p className="text-sm text-gray-600 font-medium">Aplicando precios {activeTab}…</p>
            <p className="text-[12px] text-gray-400">Descuento: {discount}%</p>
          </div>
        )}

        {/* ── Done ── */}
        {phase === 'done' && result && (
          <div className="flex-1 overflow-y-auto min-h-0 mx-6 my-3 space-y-4">
            <div className="flex items-center gap-3 p-4 bg-success/5 border border-success/30 rounded-xl">
              <CheckCircle2 className="w-8 h-8 text-success shrink-0" />
              <div>
                <p className="font-bold text-gray-900">¡Precios actualizados!</p>
                <p className="text-[12px] text-gray-500 mt-0.5">
                  {result.matched} productos actualizados · {result.notFound} sin coincidencia
                </p>
              </div>
            </div>

            <div className="space-y-1">
              <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2">Cambios aplicados</p>
              {result.updated.map(u => {
                const diff = pctDiff(u.oldCost, u.newCost);
                return (
                  <div key={u.code} className="flex items-center justify-between py-1.5 border-b border-gray-50 text-[12px]">
                    <div>
                      <span className="font-mono text-[10px] bg-gray-100 px-1 rounded text-gray-500 mr-2">{u.code}</span>
                      <span className="text-gray-700">{u.name}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-gray-400">{fmt(u.oldCost)}</span>
                      <span className="text-gray-300">→</span>
                      <span className="font-semibold text-gray-800">{fmt(u.newCost)}</span>
                      {diff !== null && (
                        <span className={cn(
                          'text-[10px] font-bold px-1.5 py-0.5 rounded',
                          diff > 0 ? 'bg-red-100 text-red-600' : 'bg-green-100 text-green-600'
                        )}>
                          {diff > 0 ? '+' : ''}{diff.toFixed(1)}%
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Error ── */}
        {phase === 'error' && (
          <div className="flex-1 flex flex-col items-center justify-center py-10 gap-3 mx-6">
            <AlertTriangle className="w-8 h-8 text-danger" />
            <p className="text-sm font-semibold text-gray-700">Error al aplicar precios</p>
            <p className="text-[12px] text-gray-400 text-center">{errorMsg}</p>
          </div>
        )}

        {/* ── Footer ── */}
        <div className="px-6 py-4 border-t border-gray-100 shrink-0 flex items-center justify-between gap-3">
          <div className="text-[11px] text-gray-400">
            {phase === 'preview' && `Fecha lista: 27/03/26 · ${matchedCount} de ${rows.length} productos coinciden`}
            {phase === 'done' && 'Cambios guardados en products.json'}
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => onClose(phase === 'done')}
              className="px-4 py-2 text-[12px] font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
            >
              {phase === 'done' ? 'Cerrar' : 'Cancelar'}
            </button>
            {phase === 'preview' && matchedCount > 0 && (
              <button
                onClick={handleApply}
                className="flex items-center gap-2 px-4 py-2 text-[12px] font-semibold rounded-lg bg-acqua text-white hover:bg-acqua-dark transition-colors"
              >
                Aplicar {activeTab} ({matchedCount} prods, -{discount}%)
              </button>
            )}
            {phase === 'error' && (
              <button
                onClick={() => setPhase('preview')}
                className="px-4 py-2 text-[12px] font-semibold rounded-lg bg-acqua text-white hover:bg-acqua-dark transition-colors"
              >
                Reintentar
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── SEIQ Category Badge (for product lists) ─────────────────────────────────

export function SeiqBadge({ category }: { category: string }) {
  const colors = CAT_COLORS[category];
  if (!colors) return null;
  return (
    <span className={cn(
      'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold',
      colors.badge
    )}>
      <Tag className="w-2.5 h-2.5" />
      {category}
    </span>
  );
}

// ─── Export category colors for use elsewhere ─────────────────────────────────

export { CAT_COLORS, CATEGORIES, DEFAULT_DISCOUNTS };
export type { SeiqCategory };
