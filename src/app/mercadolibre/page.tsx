'use client';

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import Image from 'next/image';
import * as XLSX from 'xlsx';
import productsData from '@/data/products.json';
import { cn } from '@/lib/utils';
import { useMLLabStore } from '@/lib/use-ml-lab-store';
import { loadGeminiKey, saveGeminiKey, clearGeminiKey } from '@/lib/gemini-key';
import {
  parseOdooRows, parseMLRows, matchAndBuild, calcProfitability,
  calcIdealPrice, generateScenarios, generateConsultantReport, generateAlerts,
  buildOdooExportRows, parseNum,
} from '@/lib/ml-lab-engine';
import type { MLLabProduct, MLProductParams, MLSyncStatus, ScenarioKey } from '@/lib/ml-lab-types';
import { DEFAULT_ML_PARAMS } from '@/lib/ml-lab-types';
import {
  ShoppingCart, Upload, Search, Package, BarChart3, AlertTriangle,
  CheckCircle2, Info, TrendingUp, TrendingDown, X, Zap, ExternalLink,
  Download, RefreshCw, Truck, CreditCard, DollarSign, Star, Eye,
  ChevronDown, ChevronRight, ArrowUpRight, Settings, Filter,
  Target, Layers, Sparkles, Clock, AlertCircle, LayoutGrid, List,
} from 'lucide-react';

// ─────────────────────────────────────────────────────────────────────────────
// SYSTEM PRODUCTS (from products.json)
// ─────────────────────────────────────────────────────────────────────────────

const systemProducts = productsData as unknown as Array<{
  id: string; sku: string | null; barcode: string | null;
  name: string; cost: number; price: number;
  supplierName: string | null; category: string | null;
  image: string | null; odooId: number | null;
}>;

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function ars(n: number) {
  return new Intl.NumberFormat('es-AR', {
    style: 'currency', currency: 'ARS', maximumFractionDigits: 0,
  }).format(n);
}

function pctFmt(n: number, decimals = 1) {
  return `${n >= 0 ? '' : ''}${n.toFixed(decimals)}%`;
}

const SYNC_META: Record<MLSyncStatus, { label: string; bg: string; text: string; dot: string; border: string }> = {
  sincronizado:      { label: 'Sincronizado',   bg: 'bg-[#16A34A]/10', text: 'text-[#16A34A]', dot: 'bg-[#16A34A]', border: 'border-[#16A34A]/20' },
  match_dudoso:      { label: 'Match dudoso',   bg: 'bg-[#F97316]/10', text: 'text-[#F97316]', dot: 'bg-[#F97316]', border: 'border-[#F97316]/20' },
  sin_publicacion:   { label: 'Sin publicación',bg: 'bg-[#0784F2]/10', text: 'text-[#0784F2]', dot: 'bg-[#0784F2]', border: 'border-[#0784F2]/20' },
  sin_regla_odoo:    { label: 'Sin regla Odoo', bg: 'bg-[#714B67]/10', text: 'text-[#714B67]', dot: 'bg-[#714B67]', border: 'border-[#714B67]/20' },
  duplicado:         { label: 'Duplicado',       bg: 'bg-red-100',      text: 'text-red-600',   dot: 'bg-red-500',   border: 'border-red-200' },
  sin_costo:         { label: 'Sin costo',       bg: 'bg-gray-100',     text: 'text-gray-500',  dot: 'bg-gray-400',  border: 'border-gray-200' },
  sin_stock:         { label: 'Sin stock',       bg: 'bg-[#F97316]/10', text: 'text-[#F97316]', dot: 'bg-[#F97316]', border: 'border-[#F97316]/20' },
  precio_desalineado:{ label: 'Precio desalin.', bg: 'bg-yellow-50',    text: 'text-yellow-700',dot: 'bg-yellow-500', border: 'border-yellow-200' },
  error_datos:       { label: 'Error datos',     bg: 'bg-red-100',      text: 'text-red-600',   dot: 'bg-red-500',   border: 'border-red-200' },
};

const PROFIT_META = {
  rentable:   { label: 'Rentable',    bg: 'bg-[#16A34A]/10', text: 'text-[#16A34A]', badgeBg: 'bg-[#16A34A]' },
  bajo_margen:{ label: 'Bajo margen', bg: 'bg-[#F97316]/10', text: 'text-[#F97316]', badgeBg: 'bg-[#F97316]' },
  pierde:     { label: 'Pierde',      bg: 'bg-[#EF4444]/10', text: 'text-[#EF4444]', badgeBg: 'bg-[#EF4444]' },
};

function SyncBadge({ status }: { status: MLSyncStatus }) {
  const m = SYNC_META[status] ?? { label: status, bg: 'bg-gray-100', text: 'text-gray-500', dot: 'bg-gray-400', border: 'border-gray-200' };
  return (
    <span className={cn('inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold border whitespace-nowrap', m.bg, m.text, m.border)}>
      <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', m.dot)} />
      {m.label}
    </span>
  );
}

function MarginBadge({ value, minMargin }: { value: number; minMargin: number }) {
  const color = value >= minMargin ? 'bg-[#16A34A] text-white'
              : value >= 0         ? 'bg-[#F97316] text-white'
              :                      'bg-[#EF4444] text-white';
  return (
    <span className={cn('inline-flex px-2 py-0.5 rounded-full text-[11px] font-black', color)}>
      {value.toFixed(1)}%
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// FILE DROP ZONE
// ─────────────────────────────────────────────────────────────────────────────

function DropZone({
  label, hint, fileName, onFile, accept = '.csv,.xlsx,.xls',
}: {
  label: string; hint: string; fileName?: string;
  onFile: (rows: unknown[][], name: string) => void;
  accept?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [parsing, setParsing] = useState(false);

  const processFile = async (file: File) => {
    setParsing(true);
    try {
      const ab = await file.arrayBuffer();
      const wb = XLSX.read(ab, { type: 'array', cellDates: false });
      // Prefer "Publicaciones" sheet (ML Seller Center export); fall back to first sheet
      const sheetName = wb.SheetNames.find(n => n === 'Publicaciones') ?? wb.SheetNames[0];
      const ws = wb.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' });
      onFile(rows, file.name);
    } catch (e) {
      console.error('Error parsing file:', e);
    } finally {
      setParsing(false);
    }
  };

  return (
    <div
      onDragOver={e => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) processFile(f); }}
      onClick={() => inputRef.current?.click()}
      className={cn(
        'border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all',
        dragging ? 'border-[#FFE600] bg-[#FFE600]/5 scale-[1.01]' :
        fileName ? 'border-[#16A34A]/40 bg-[#16A34A]/5' :
        'border-gray-300 hover:border-[#FFE600]/60 hover:bg-[#FFE600]/3',
      )}
    >
      <input ref={inputRef} type="file" accept={accept} className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) processFile(f); }} />
      {parsing ? (
        <div className="flex flex-col items-center gap-3">
          <RefreshCw className="w-8 h-8 text-[#0784F2] animate-spin" />
          <p className="text-sm font-semibold text-gray-600">Procesando archivo…</p>
        </div>
      ) : fileName ? (
        <div className="flex flex-col items-center gap-2">
          <CheckCircle2 className="w-8 h-8 text-[#16A34A]" />
          <p className="text-sm font-bold text-[#16A34A]">{fileName}</p>
          <p className="text-[11px] text-gray-400">Click para reemplazar</p>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3">
          <Upload className="w-8 h-8 text-gray-400" />
          <div>
            <p className="text-sm font-bold text-gray-700">{label}</p>
            <p className="text-[12px] text-gray-400 mt-0.5">{hint}</p>
          </div>
          <p className="text-[10px] text-gray-300 uppercase tracking-wider">CSV · XLSX · XLS</p>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// IMPORT TAB
// ─────────────────────────────────────────────────────────────────────────────

function ImportTab({ store }: { store: ReturnType<typeof useMLLabStore> }) {
  const [odooRows,    setOdooRows]    = useState<unknown[][]>([]);
  const [mlRows,      setMlRows]      = useState<unknown[][]>([]);
  const [odooName,    setOdooName]    = useState('');
  const [mlName,      setMlName]      = useState('');
  const [processing,  setProcessing]  = useState(false);
  const [result,      setResult]      = useState<{ matched: number; total: number; orphans: number } | null>(null);

  const hasOdoo = odooRows.length > 1;
  const hasML   = mlRows.length > 1;
  const canRun  = hasOdoo || hasML;

  const runMatch = useCallback(() => {
    if (!canRun) return;
    setProcessing(true);
    try {
      const odooRules = hasOdoo ? parseOdooRows(odooRows) : [];
      const mlPubs    = hasML   ? parseMLRows(mlRows)     : [];
      const products  = matchAndBuild(odooRules, mlPubs, systemProducts, store.globalParams);

      const matched  = products.filter(p => p.mlItemId && p.odooId).length;
      const orphans  = products.filter(p => p.syncStatus === 'sin_regla_odoo').length;

      store.setProducts(products, { odooFileName: odooName, mlFileName: mlName });
      setResult({ matched, total: products.length, orphans });
    } catch (e) {
      console.error('Match error:', e);
    } finally {
      setProcessing(false);
    }
  }, [canRun, odooRows, mlRows, odooName, mlName, store, hasOdoo, hasML]);

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">

      {/* Intro */}
      <div className="bg-[#FFE600]/10 border border-[#FFE600]/30 rounded-2xl p-5">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-[#FFE600] flex items-center justify-center shrink-0 mt-0.5">
            <Zap className="w-4 h-4 text-gray-900" />
          </div>
          <div>
            <p className="text-[13px] font-bold text-gray-900 mb-1">Carga inicial — Espejo Maestro</p>
            <p className="text-[12px] text-gray-600 leading-relaxed">
              Subí el archivo de <strong>reglas de precio Odoo</strong> (lista MercadoLibre) y el archivo de <strong>publicaciones exportado desde ML</strong>. El sistema los cruza automáticamente con el inventario interno.
            </p>
          </div>
        </div>
      </div>

      {/* Step 1 */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <span className="w-6 h-6 rounded-full bg-[#714B67] text-white text-[11px] font-black flex items-center justify-center shrink-0">1</span>
          <p className="text-[13px] font-bold text-gray-900">Regla de precio Odoo (lista MercadoLibre)</p>
        </div>
        <DropZone
          label="Exportar desde Odoo — Lista de precios ML"
          hint="Columnas esperadas: Producto, Referencia interna, Markup % (o Factor de precio)"
          fileName={odooName}
          onFile={(rows, name) => { setOdooRows(rows); setOdooName(name); setResult(null); }}
        />
        {hasOdoo && (
          <p className="text-[11px] text-[#16A34A] mt-2 font-semibold">
            ✓ {odooRows.length - 1} reglas detectadas — columnas: {(odooRows[0] as string[]).slice(0, 5).join(', ')}…
          </p>
        )}
      </div>

      {/* Step 2 */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <span className="w-6 h-6 rounded-full bg-[#0784F2] text-white text-[11px] font-black flex items-center justify-center shrink-0">2</span>
          <p className="text-[13px] font-bold text-gray-900">Publicaciones activas de MercadoLibre</p>
        </div>
        <DropZone
          label="Exportar desde ML Seller Center"
          hint="Columnas esperadas: ID ítem, Título, Precio, Estado, Stock, Vendidos, Visitas…"
          fileName={mlName}
          onFile={(rows, name) => { setMlRows(rows); setMlName(name); setResult(null); }}
        />
        {hasML && (
          <p className="text-[11px] text-[#16A34A] mt-2 font-semibold">
            {(() => {
              // ML Seller Center format has 6 header rows before data
              const first = (mlRows[0] as string[]).map(h => String(h).toUpperCase());
              const isMLFormat = first.includes('ITEM_ID') && first.includes('PRICE');
              const dataCount = isMLFormat ? mlRows.length - 6 : mlRows.length - 1;
              const cols = first.slice(0, 5).filter(Boolean).join(', ');
              return `✓ ${dataCount} publicaciones detectadas${isMLFormat ? ' (Seller Center)' : ''} — ${cols}…`;
            })()}
          </p>
        )}
      </div>

      {/* Note about system products */}
      <div className="flex items-center gap-2 p-3 bg-gray-50 rounded-xl border border-gray-200">
        <Package className="w-4 h-4 text-gray-400 shrink-0" />
        <p className="text-[11px] text-gray-500">
          <span className="font-semibold">Inventario interno:</span> {systemProducts.length} productos cargados automáticamente desde Odoo sync. Se usan para enriquecer costo, stock e imagen.
        </p>
      </div>

      {/* Run button */}
      <button
        onClick={runMatch}
        disabled={!canRun || processing}
        className={cn(
          'w-full py-3.5 rounded-2xl text-[14px] font-black transition-all flex items-center justify-center gap-2',
          canRun && !processing
            ? 'bg-[#07111F] text-[#FFE600] hover:opacity-90'
            : 'bg-gray-200 text-gray-400 cursor-not-allowed',
        )}
      >
        {processing ? <><RefreshCw className="w-5 h-5 animate-spin" /> Cruzando datos…</> : <><Zap className="w-5 h-5" /> Procesar y crear Espejo Maestro</>}
      </button>

      {/* Result */}
      {result && (
        <div className="bg-[#16A34A]/10 border border-[#16A34A]/20 rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle2 className="w-5 h-5 text-[#16A34A]" />
            <p className="text-[14px] font-bold text-[#16A34A]">Espejo maestro generado</p>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="text-center bg-white rounded-xl p-3">
              <div className="text-2xl font-black text-gray-900">{result.total}</div>
              <div className="text-[10px] text-gray-500 uppercase tracking-wide">Productos totales</div>
            </div>
            <div className="text-center bg-white rounded-xl p-3">
              <div className="text-2xl font-black text-[#16A34A]">{result.matched}</div>
              <div className="text-[10px] text-gray-500 uppercase tracking-wide">Cruzados</div>
            </div>
            <div className="text-center bg-white rounded-xl p-3">
              <div className="text-2xl font-black text-[#F97316]">{result.orphans}</div>
              <div className="text-[10px] text-gray-500 uppercase tracking-wide">Sin regla Odoo</div>
            </div>
          </div>
          <p className="text-[11px] text-[#16A34A] mt-3 text-center">
            Andá a la pestaña <strong>Tabla</strong> para ver todos los productos.
          </p>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DASHBOARD TAB
// ─────────────────────────────────────────────────────────────────────────────

function DashboardTab({
  store,
  onSelectProduct,
  onGoToImport,
}: {
  store: ReturnType<typeof useMLLabStore>;
  onSelectProduct: (id: string) => void;
  onGoToImport: () => void;
}) {
  const { stats, products, globalParams } = store;

  if (products.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 px-8 text-center">
        <div className="w-20 h-20 rounded-3xl bg-[#FFE600]/20 flex items-center justify-center mb-6">
          <ShoppingCart className="w-10 h-10 text-gray-600" />
        </div>
        <h2 className="text-2xl font-bold text-gray-900 mb-3">Espejo maestro vacío</h2>
        <p className="text-gray-500 text-[14px] max-w-md leading-relaxed mb-6">
          Todavía no hay datos. Importá la regla de precio de Odoo y las publicaciones de MercadoLibre para generar el espejo maestro.
        </p>
        <button
          onClick={onGoToImport}
          className="flex items-center gap-2 px-6 py-3 bg-[#07111F] text-[#FFE600] rounded-xl font-bold text-[13px] hover:opacity-90 transition-opacity"
        >
          <Upload className="w-4 h-4" /> Importar archivos
        </button>
      </div>
    );
  }

  // Priority: products needing urgent attention (sorted by alert priority)
  const urgent = [...products]
    .filter(p => p.alerts.length > 0 && p.alerts[0].type === 'danger')
    .sort((a, b) => (a.alerts[0]?.priority ?? 9) - (b.alerts[0]?.priority ?? 9))
    .slice(0, 5);

  // Opportunities: rentable + high sales or good margin
  const opportunities = [...products]
    .filter(p => p.calc?.status === 'rentable' && p.mlPrice && p.cost > 0)
    .sort((a, b) => (b.mlSold ?? 0) - (a.mlSold ?? 0))
    .slice(0, 4);

  // Products that need review (bajo_margen + has ML pub)
  const needReview = [...products]
    .filter(p => (p.calc?.status === 'bajo_margen' || p.syncStatus === 'precio_desalineado') && p.mlItemId)
    .slice(0, 5);

  return (
    <div className="p-5 lg:p-6 space-y-6">

      {/* ── Stats cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: 'Total',       value: stats.total,         color: 'text-gray-900', bg: 'bg-white' },
          { label: 'Sincronizados',value: stats.sincronizados, color: 'text-[#16A34A]', bg: 'bg-[#16A34A]/5' },
          { label: 'Rentables',   value: stats.rentables,     color: 'text-[#16A34A]', bg: 'bg-[#16A34A]/5' },
          { label: 'Bajo margen', value: stats.bajoMargen,    color: 'text-[#F97316]', bg: 'bg-[#F97316]/5' },
          { label: 'Pierden',     value: stats.pierde,        color: 'text-[#EF4444]', bg: 'bg-[#EF4444]/5' },
          { label: 'Sin costo',   value: stats.sinCosto,      color: 'text-gray-400',  bg: 'bg-gray-50' },
        ].map(s => (
          <div key={s.label} className={cn('rounded-2xl border border-gray-100 p-4 shadow-sm', s.bg)}>
            <div className={cn('text-3xl font-black', s.color)}>{s.value}</div>
            <div className="text-[10px] text-gray-400 uppercase tracking-wide mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-3 gap-5">

        {/* ── URGENTE ── */}
        <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <AlertCircle className="w-4 h-4 text-[#EF4444]" />
            <h3 className="text-[13px] font-bold text-gray-900">Urgente — revisar hoy</h3>
          </div>
          {urgent.length === 0 ? (
            <div className="text-center py-4 text-[12px] text-gray-400">
              <CheckCircle2 className="w-6 h-6 mx-auto mb-2 text-[#16A34A]" />
              Sin alertas críticas
            </div>
          ) : (
            <div className="space-y-2">
              {urgent.map(p => (
                <button
                  key={p.id}
                  onClick={() => onSelectProduct(p.id)}
                  className="w-full text-left p-3 rounded-xl bg-[#EF4444]/5 border border-[#EF4444]/15 hover:bg-[#EF4444]/10 transition-colors group"
                >
                  <p className="text-[12px] font-semibold text-gray-900 line-clamp-1 group-hover:text-[#EF4444]">{p.name}</p>
                  <p className="text-[10px] text-[#EF4444] mt-0.5">{p.alerts[0]?.message}</p>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ── OPORTUNIDADES ── */}
        <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="w-4 h-4 text-[#16A34A]" />
            <h3 className="text-[13px] font-bold text-gray-900">¿Dónde puedo hacer plata hoy?</h3>
          </div>
          {opportunities.length === 0 ? (
            <p className="text-[12px] text-gray-400 text-center py-4">Sin oportunidades detectadas aún.</p>
          ) : (
            <div className="space-y-2">
              {opportunities.map(p => (
                <button
                  key={p.id}
                  onClick={() => onSelectProduct(p.id)}
                  className="w-full text-left p-3 rounded-xl bg-[#16A34A]/5 border border-[#16A34A]/15 hover:bg-[#16A34A]/10 transition-colors group"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-[12px] font-semibold text-gray-900 line-clamp-1 group-hover:text-[#16A34A]">{p.name}</p>
                    <MarginBadge value={p.calc!.netMargin} minMargin={globalParams.minMargin} />
                  </div>
                  <p className="text-[10px] text-gray-400 mt-0.5">
                    {p.mlSold ? `${p.mlSold} vendidos · ` : ''}{ars(p.mlPrice!)} en ML
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ── REVISAR PRECIO ── */}
        <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <Target className="w-4 h-4 text-[#F97316]" />
            <h3 className="text-[13px] font-bold text-gray-900">Precios a corregir</h3>
          </div>
          {needReview.length === 0 ? (
            <p className="text-[12px] text-gray-400 text-center py-4">Todos los precios están en orden.</p>
          ) : (
            <div className="space-y-2">
              {needReview.map(p => {
                const ideal = p.cost > 0 ? calcIdealPrice(p.cost, globalParams.idealMargin, globalParams) : 0;
                return (
                  <button
                    key={p.id}
                    onClick={() => onSelectProduct(p.id)}
                    className="w-full text-left p-3 rounded-xl bg-[#F97316]/5 border border-[#F97316]/15 hover:bg-[#F97316]/10 transition-colors group"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-[12px] font-semibold text-gray-900 line-clamp-1 group-hover:text-[#F97316]">{p.name}</p>
                      {p.calc && <MarginBadge value={p.calc.netMargin} minMargin={globalParams.minMargin} />}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 text-[10px] text-gray-400">
                      <span>Actual: {p.mlPrice ? ars(p.mlPrice) : '—'}</span>
                      {ideal > 0 && <><span>→</span><span className="text-[#16A34A] font-semibold">{ars(ideal)}</span></>}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── Sync status summary ── */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
        <h3 className="text-[13px] font-bold text-gray-900 mb-4 flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-[#0784F2]" />
          Estado de sincronización
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {([
            'sincronizado', 'match_dudoso', 'sin_publicacion',
            'sin_regla_odoo', 'sin_costo', 'sin_stock', 'precio_desalineado', 'duplicado',
          ] as MLSyncStatus[]).map(s => {
            const m = SYNC_META[s];
            const count = products.filter(p => p.syncStatus === s).length;
            if (count === 0) return null;
            return (
              <div key={s} className={cn('rounded-xl p-3 border', m.bg, m.border)}>
                <div className={cn('text-xl font-black', m.text)}>{count}</div>
                <div className={cn('text-[10px] font-semibold mt-0.5', m.text)}>{m.label}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TABLE TAB
// ─────────────────────────────────────────────────────────────────────────────

function TableTab({
  store,
  onSelectProduct,
  selectedId,
}: {
  store: ReturnType<typeof useMLLabStore>;
  onSelectProduct: (id: string) => void;
  selectedId: string | null;
}) {
  const [search,       setSearch]       = useState('');
  const [syncFilter,   setSyncFilter]   = useState<MLSyncStatus | 'todos'>('todos');
  const [profitFilter, setProfitFilter] = useState<string>('todos');
  const [sortBy,       setSortBy]       = useState<'name' | 'margin' | 'sold' | 'alert'>('alert');
  const [page,         setPage]         = useState(1);
  const [viewMode,     setViewMode]     = useState<'table' | 'grid'>('table');
  const PER_PAGE = 40;

  const filtered = useMemo(() => {
    let prods = store.products;

    if (search) {
      const q = search.toLowerCase();
      prods = prods.filter(p =>
        p.name.toLowerCase().includes(q) ||
        (p.sku ?? '').toLowerCase().includes(q) ||
        (p.mlItemId ?? '').toLowerCase().includes(q) ||
        (p.mlTitle ?? '').toLowerCase().includes(q)
      );
    }
    if (syncFilter !== 'todos') prods = prods.filter(p => p.syncStatus === syncFilter);
    if (profitFilter === 'rentable')    prods = prods.filter(p => p.calc?.status === 'rentable');
    if (profitFilter === 'bajo_margen') prods = prods.filter(p => p.calc?.status === 'bajo_margen');
    if (profitFilter === 'pierde')      prods = prods.filter(p => p.calc?.status === 'pierde');
    if (profitFilter === 'sin_calc')    prods = prods.filter(p => !p.calc);

    prods = [...prods].sort((a, b) => {
      if (sortBy === 'margin')
        return (b.calc?.netMargin ?? -999) - (a.calc?.netMargin ?? -999);
      if (sortBy === 'sold')
        return (b.mlSold ?? 0) - (a.mlSold ?? 0);
      if (sortBy === 'alert')
        return (a.alerts[0]?.priority ?? 9) - (b.alerts[0]?.priority ?? 9);
      return a.name.localeCompare(b.name);
    });

    return prods;
  }, [store.products, search, syncFilter, profitFilter, sortBy]);

  const totalPages = Math.ceil(filtered.length / PER_PAGE);
  const paginated  = filtered.slice((page - 1) * PER_PAGE, page * PER_PAGE);

  if (store.products.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center p-8">
        <Package className="w-10 h-10 text-gray-300 mb-3" />
        <p className="font-semibold text-gray-500">Sin datos aún</p>
        <p className="text-[12px] text-gray-400 mt-1">Importá archivos desde la pestaña Importar</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="px-5 py-3 border-b border-gray-100 flex flex-wrap gap-2 items-center bg-gray-50/50">
        <div className="relative flex-1 min-w-[180px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
          <input
            type="text" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
            placeholder="Buscar producto, SKU, MLA…"
            className="w-full pl-8 pr-3 py-2 bg-white border border-gray-200 rounded-xl text-[12px] focus:outline-none focus:ring-2 focus:ring-[#FFE600]/40"
          />
        </div>

        <select value={syncFilter} onChange={e => { setSyncFilter(e.target.value as MLSyncStatus | 'todos'); setPage(1); }}
          className="px-3 py-2 bg-white border border-gray-200 rounded-xl text-[12px] focus:outline-none cursor-pointer">
          <option value="todos">Todos los estados</option>
          {(Object.keys(SYNC_META) as MLSyncStatus[]).map(s => (
            <option key={s} value={s}>{SYNC_META[s].label}</option>
          ))}
        </select>

        <select value={profitFilter} onChange={e => { setProfitFilter(e.target.value); setPage(1); }}
          className="px-3 py-2 bg-white border border-gray-200 rounded-xl text-[12px] focus:outline-none cursor-pointer">
          <option value="todos">Toda rentabilidad</option>
          <option value="rentable">Rentable</option>
          <option value="bajo_margen">Bajo margen</option>
          <option value="pierde">Pierde</option>
          <option value="sin_calc">Sin cálculo</option>
        </select>

        <select value={sortBy} onChange={e => setSortBy(e.target.value as typeof sortBy)}
          className="px-3 py-2 bg-white border border-gray-200 rounded-xl text-[12px] focus:outline-none cursor-pointer">
          <option value="alert">Por urgencia</option>
          <option value="margin">Por margen</option>
          <option value="sold">Por ventas</option>
          <option value="name">Por nombre</option>
        </select>

        <span className="text-[11px] text-gray-400 ml-auto">
          {filtered.length} de {store.products.length}
        </span>

        {/* View toggle */}
        <div className="flex items-center gap-0.5 bg-white border border-gray-200 rounded-xl p-0.5 shrink-0">
          <button
            onClick={() => setViewMode('table')}
            title="Vista tabla"
            className={cn(
              'p-1.5 rounded-lg transition-colors',
              viewMode === 'table' ? 'bg-[#07111F] text-white' : 'text-gray-400 hover:text-gray-600',
            )}
          >
            <List className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setViewMode('grid')}
            title="Vista grilla"
            className={cn(
              'p-1.5 rounded-lg transition-colors',
              viewMode === 'grid' ? 'bg-[#07111F] text-white' : 'text-gray-400 hover:text-gray-600',
            )}
          >
            <LayoutGrid className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Grid view */}
      {viewMode === 'grid' && (
        <div className="flex-1 overflow-y-auto p-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
            {paginated.map(p => {
              const isSelected = selectedId === p.id;
              const idealPrice = p.cost > 0 ? calcIdealPrice(p.cost, store.globalParams.idealMargin, store.globalParams) : 0;
              const topAlert = p.alerts[0];
              const alertColor =
                topAlert?.type === 'danger'  ? 'bg-[#EF4444] text-white' :
                topAlert?.type === 'warning' ? 'bg-[#F97316] text-white' :
                topAlert?.type === 'info'    ? 'bg-[#0784F2] text-white' : '';
              return (
                <button
                  key={p.id}
                  onClick={() => onSelectProduct(p.id)}
                  className={cn(
                    'relative flex flex-col bg-white rounded-2xl border overflow-hidden text-left transition-all shadow-sm hover:shadow-md',
                    isSelected
                      ? 'border-[#FFE600] ring-2 ring-[#FFE600]/40 shadow-md'
                      : 'border-gray-100 hover:border-[#FFE600]/50',
                  )}
                >
                  {/* Thumbnail */}
                  <div className="relative w-full aspect-square bg-gray-50 border-b border-gray-100">
                    {(p.mlThumbnail || p.image) ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={p.mlThumbnail ?? p.image ?? ''}
                        alt=""
                        className="w-full h-full object-contain p-2"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Package className="w-8 h-8 text-gray-200" />
                      </div>
                    )}
                    {/* Sync dot */}
                    <span
                      className={cn('absolute top-2 right-2 w-2.5 h-2.5 rounded-full border-2 border-white', (SYNC_META[p.syncStatus] ?? SYNC_META['error_datos']).dot)}
                      title={(SYNC_META[p.syncStatus] ?? SYNC_META['error_datos']).label}
                    />
                    {/* Margin badge */}
                    {p.calc && (
                      <span className={cn(
                        'absolute bottom-2 left-2 text-white text-[10px] font-black px-1.5 py-0.5 rounded-full',
                        p.calc.netMargin >= store.globalParams.minMargin ? 'bg-[#16A34A]' :
                        p.calc.netMargin >= 0 ? 'bg-[#F97316]' : 'bg-[#EF4444]',
                      )}>
                        {p.calc.netMargin.toFixed(1)}%
                      </span>
                    )}
                  </div>

                  {/* Body */}
                  <div className="p-2.5 flex flex-col gap-1 flex-1">
                    <p className="text-[11px] font-semibold text-gray-900 line-clamp-2 leading-tight">{p.name}</p>

                    {/* Price row */}
                    <div className="flex items-center justify-between gap-1 mt-auto">
                      <span className="text-[12px] font-black text-gray-900">
                        {p.mlPrice ? ars(p.mlPrice) : p.odooListML > 0 ? ars(p.odooListML) : '—'}
                      </span>
                      {idealPrice > 0 && p.mlPrice && Math.abs(idealPrice - p.mlPrice) > 1 && (
                        <span className={cn(
                          'text-[9px] font-semibold',
                          idealPrice > p.mlPrice ? 'text-[#16A34A]' : 'text-[#F97316]',
                        )}>
                          {idealPrice > p.mlPrice ? '↑' : '↓'}{ars(idealPrice)}
                        </span>
                      )}
                    </div>

                    {/* Stats row */}
                    <div className="flex items-center gap-2 text-[9px] text-gray-400 font-medium">
                      {p.mlSold !== undefined && (
                        <span title="Vendidos">{p.mlSold} vend.</span>
                      )}
                      {p.stock > 0 && (
                        <span title="Stock">{p.stock} stk</span>
                      )}
                      {p.sku && (
                        <span className="font-mono truncate">{p.sku}</span>
                      )}
                    </div>
                  </div>

                  {/* Alert strip */}
                  {topAlert && alertColor && (
                    <div className={cn('px-2.5 py-1 text-[9px] font-semibold line-clamp-1', alertColor)}>
                      {topAlert.message}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Table view */}
      {viewMode === 'table' && (
      <div className="overflow-x-auto flex-1">
        <table className="w-full">
          <thead>
            <tr className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider bg-gray-50/80 border-b border-gray-100 sticky top-0">
              <th className="text-left px-4 py-2.5 w-8" />
              <th className="text-left px-4 py-2.5">Producto</th>
              <th className="text-center px-3 py-2.5">Sync</th>
              <th className="text-right px-3 py-2.5 hidden sm:table-cell">Costo</th>
              <th className="text-right px-3 py-2.5 hidden md:table-cell">Markup</th>
              <th className="text-right px-3 py-2.5">Precio ML</th>
              <th className="text-right px-3 py-2.5 hidden md:table-cell">Calc. ideal</th>
              <th className="text-center px-3 py-2.5">Margen</th>
              <th className="text-right px-3 py-2.5 hidden lg:table-cell">Vendidos</th>
              <th className="text-left px-3 py-2.5 hidden xl:table-cell">Alerta</th>
              <th className="w-10 px-3 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {paginated.map(p => {
              const isSelected = selectedId === p.id;
              const idealPrice = p.cost > 0 ? calcIdealPrice(p.cost, store.globalParams.idealMargin, store.globalParams) : 0;
              return (
                <tr
                  key={p.id}
                  onClick={() => onSelectProduct(p.id)}
                  className={cn(
                    'transition-colors cursor-pointer group',
                    isSelected
                      ? 'bg-[#FFE600]/10 ring-1 ring-inset ring-[#FFE600]/30'
                      : 'hover:bg-[#FFE600]/5',
                  )}
                >
                  {/* Thumbnail */}
                  <td className="px-4 py-2.5">
                    <div className="w-8 h-8 rounded-lg bg-gray-100 border border-gray-200 overflow-hidden flex items-center justify-center">
                      {(p.mlThumbnail || p.image)
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={p.mlThumbnail ?? p.image ?? ''} alt="" className="w-full h-full object-contain" />
                        : <Package className="w-4 h-4 text-gray-400" />}
                    </div>
                  </td>

                  {/* Name + SKU */}
                  <td className="px-4 py-2.5">
                    <p className={cn('text-[12px] font-semibold line-clamp-1', isSelected ? 'text-[#07111F]' : 'text-gray-900')}>{p.name}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {p.sku && <span className="text-[9px] font-mono text-gray-400">{p.sku}</span>}
                      {p.mlItemId && <span className="text-[9px] font-mono text-[#0784F2]">{p.mlItemId}</span>}
                    </div>
                  </td>

                  {/* Sync */}
                  <td className="px-3 py-2.5 text-center"><SyncBadge status={p.syncStatus} /></td>

                  {/* Costo */}
                  <td className="px-3 py-2.5 text-right hidden sm:table-cell">
                    <span className="text-[11px] text-gray-600">
                      {p.cost > 0 ? ars(p.cost) : <span className="text-gray-400">—</span>}
                    </span>
                  </td>

                  {/* Markup */}
                  <td className="px-3 py-2.5 text-right hidden md:table-cell">
                    <span className="text-[11px] text-gray-600">
                      {p.markup > 0 ? `${p.markup.toFixed(0)}%` : <span className="text-gray-400">—</span>}
                    </span>
                  </td>

                  {/* Precio ML */}
                  <td className="px-3 py-2.5 text-right">
                    <span className="text-[13px] font-bold text-gray-900">
                      {p.mlPrice ? ars(p.mlPrice) : p.odooListML > 0 ? <span className="text-gray-400 text-[11px]">{ars(p.odooListML)} calc.</span> : <span className="text-gray-400">—</span>}
                    </span>
                  </td>

                  {/* Calc ideal */}
                  <td className="px-3 py-2.5 text-right hidden md:table-cell">
                    <span className="text-[11px] text-[#16A34A] font-semibold">
                      {idealPrice > 0 ? ars(idealPrice) : '—'}
                    </span>
                  </td>

                  {/* Margen */}
                  <td className="px-3 py-2.5 text-center">
                    {p.calc
                      ? <MarginBadge value={p.calc.netMargin} minMargin={store.globalParams.minMargin} />
                      : <span className="text-gray-400 text-[11px]">—</span>}
                  </td>

                  {/* Vendidos */}
                  <td className="px-3 py-2.5 text-right hidden lg:table-cell">
                    <span className="text-[11px] text-gray-600">
                      {p.mlSold !== undefined ? p.mlSold : '—'}
                    </span>
                  </td>

                  {/* Alerta */}
                  <td className="px-3 py-2.5 hidden xl:table-cell">
                    {p.alerts[0] && (
                      <span className={cn(
                        'text-[10px] font-semibold line-clamp-1',
                        p.alerts[0].type === 'danger'  ? 'text-[#EF4444]' :
                        p.alerts[0].type === 'warning' ? 'text-[#F97316]' : 'text-gray-400',
                      )}>
                        {p.alerts[0].message}
                      </span>
                    )}
                  </td>

                  {/* Open lab */}
                  <td className="px-3 py-2.5">
                    <ChevronRight className={cn(
                      'w-4 h-4 transition-colors',
                      isSelected ? 'text-[#07111F]' : 'text-gray-300 group-hover:text-gray-500',
                    )} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      )}

      {/* Pagination (shared between table and grid) */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 bg-gray-50/50 shrink-0">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
            className="px-3 py-1.5 text-[12px] border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-white">← Anterior</button>
          <span className="text-[12px] text-gray-500">
            Pág. {page}/{totalPages} · {filtered.length} producto{filtered.length !== 1 ? 's' : ''}
          </span>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
            className="px-3 py-1.5 text-[12px] border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-white">Siguiente →</button>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORT ODOO TAB
// ─────────────────────────────────────────────────────────────────────────────

function ExportTab({ store }: { store: ReturnType<typeof useMLLabStore> }) {
  const handleDownload = () => {
    const rows = buildOdooExportRows(store.products, store.globalParams);
    const ws   = XLSX.utils.aoa_to_sheet(rows);
    const wb   = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'ML Lab Export');
    XLSX.writeFile(wb, `acqua_ml_lab_${new Date().toISOString().split('T')[0]}.xlsx`);
  };

  if (store.products.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center p-8">
        <Download className="w-10 h-10 text-gray-300 mb-3" />
        <p className="font-semibold text-gray-500">Sin datos para exportar</p>
        <p className="text-[12px] text-gray-400 mt-1">Importá archivos primero.</p>
      </div>
    );
  }

  const rows = buildOdooExportRows(store.products, store.globalParams);
  const preview = rows.slice(0, 6);

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div className="bg-[#714B67]/10 border border-[#714B67]/20 rounded-2xl p-5">
        <div className="flex items-start gap-3">
          <Download className="w-5 h-5 text-[#714B67] shrink-0 mt-0.5" />
          <div>
            <p className="text-[13px] font-bold text-gray-900 mb-1">Export para Odoo — Lista de precios ML</p>
            <p className="text-[12px] text-gray-600 leading-relaxed">
              Descargá el XLSX con el markup recomendado para cada producto. Importalo en Odoo para actualizar la lista de precios MercadoLibre.
            </p>
          </div>
        </div>
      </div>

      {/* Preview table */}
      <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                {preview[0]?.map((h, i) => (
                  <th key={i} className="px-3 py-2 text-left font-bold text-gray-500 uppercase tracking-wider whitespace-nowrap">
                    {String(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {preview.slice(1).map((row, ri) => (
                <tr key={ri} className="hover:bg-gray-50/50">
                  {row.map((cell, ci) => (
                    <td key={ci} className="px-3 py-2 text-gray-700 whitespace-nowrap">{String(cell)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-2 bg-gray-50 border-t border-gray-100">
          <p className="text-[11px] text-gray-400">{store.products.length} productos · mostrando primeros 5</p>
        </div>
      </div>

      <button
        onClick={handleDownload}
        className="flex items-center gap-2 px-6 py-3.5 bg-[#714B67] text-white rounded-xl font-bold text-[13px] hover:opacity-90 transition-opacity"
      >
        <Download className="w-4 h-4" />
        Descargar XLSX para Odoo ({store.products.length} productos)
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// GLOBAL PARAMS EDITOR
// ─────────────────────────────────────────────────────────────────────────────

function GlobalParamsPanel({ params, onChange }: {
  params: MLProductParams;
  onChange: (p: Partial<MLProductParams>) => void;
}) {
  const F = ({ label, field, min, max, step, suffix }: {
    label: string; field: keyof MLProductParams; min: number; max: number; step: number; suffix?: string;
  }) => {
    const val = params[field] as number;
    return (
      <div className="flex items-center justify-between gap-2">
        <label className="text-[12px] text-gray-600 shrink-0">{label}</label>
        <div className="flex items-center gap-1.5">
          <input
            type="number" value={val} min={min} max={max} step={step}
            onChange={e => onChange({ [field]: parseNum(e.target.value) })}
            className="w-20 text-right px-2 py-1.5 border border-gray-200 rounded-lg text-[12px] font-bold focus:outline-none focus:ring-2 focus:ring-[#FFE600]/40"
          />
          {suffix && <span className="text-[11px] text-gray-400 shrink-0">{suffix}</span>}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-3">
      <F label="Comisión ML"     field="commission"      min={0}   max={30}  step={0.5} suffix="%" />
      <F label="Cargo fijo"      field="fixedFee"        min={0}   max={5000} step={100} suffix="$" />
      <F label="Costo envío"     field="shippingCost"    min={0}   max={5000} step={100} suffix="$" />
      <F label="IIBB"            field="iibb"            min={0}   max={10}  step={0.5} suffix="%" />
      <F label="Cuotas sin int." field="installmentsCost" min={0}  max={25}  step={0.5} suffix="%" />
      <F label="Publicidad ML"   field="advertising"     min={0}   max={20}  step={0.5} suffix="%" />
      <F label="Otros costos"    field="otherCosts"      min={0}   max={5000} step={100} suffix="$" />
      <F label="Margen mínimo"   field="minMargin"       min={5}   max={60}  step={1}   suffix="%" />
      <F label="Margen ideal"    field="idealMargin"     min={5}   max={80}  step={1}   suffix="%" />
      <F label="Redondeo"        field="roundTo"         min={0}   max={100} step={10}  suffix="$" />
      <div className="flex items-center justify-between gap-2">
        <label className="text-[12px] text-gray-600">Condición fiscal</label>
        <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
          {['RI', 'Mono'].map(v => (
            <button key={v} onClick={() => onChange({ isRI: v === 'RI' })}
              className={cn('px-3 py-1 rounded-md text-[11px] font-semibold transition-colors',
                (v === 'RI') === params.isRI ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500')}>
              {v}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PRODUCT FICHA / LABORATORIO
// ─────────────────────────────────────────────────────────────────────────────

type FichaTab = 'datos' | 'ml' | 'rentabilidad' | 'escenarios' | 'consultor';

interface ChatMessage { role: 'user' | 'assistant'; content: string }
interface ScoutItem { id: string; title: string; price: number; condition: string; permalink: string; thumbnail: string | null; freeShipping: boolean; soldQty: number; stock: number; seller: string | null; installments: { qty: number; amount: number; rate: number } | null }
interface ScoutMarket { avgPrice: number; minPrice: number; maxPrice: number; medPrice: number; freeShipPct: number; installmentsPct: number }

function ProductFicha({
  product, store, onClose, geminiKey = '',
}: {
  product: MLLabProduct;
  store: ReturnType<typeof useMLLabStore>;
  onClose: () => void;
  geminiKey?: string;
}) {
  const [fichaTab,  setFichaTab]  = useState<FichaTab>('rentabilidad');
  const [showParams, setShowParams] = useState(false);
  const [scout,      setScout]     = useState<{ items: ScoutItem[]; market: ScoutMarket | null }>({ items: [], market: null });
  const [scouting,   setScouting]  = useState(false);
  // Description generation state
  const [descText,   setDescText]  = useState('');
  const [descLoading,setDescLoading] = useState(false);

  // Chat state
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput,    setChatInput]    = useState('');
  const [chatLoading,  setChatLoading]  = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const chatInitialized = useRef(false);

  // Escape key handler
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const params = { ...store.globalParams, ...product.params };
  const calc   = product.calc ?? (product.mlPrice ? calcProfitability(product.mlPrice, product.cost, params) : null);
  const idealPrice = product.cost > 0 ? calcIdealPrice(product.cost, params.idealMargin, params) : 0;
  const idealCalc  = idealPrice > 0 ? calcProfitability(idealPrice, product.cost, params) : null;
  const scenarios  = generateScenarios(product, params);
  const consultant = useMemo(
    () => generateConsultantReport(product, params, scout.market?.avgPrice),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [product, params, scout.market]
  );

  const updateParams = (updates: Partial<MLProductParams>) => {
    store.updateProduct(product.id, {
      params: { ...product.params, ...updates },
    });
  };

  const [scoutError, setScoutError] = useState<string | null>(null);

  const runScout = async () => {
    // Clean name for search: remove brand suffix, special chars
    const q = product.name
      .replace(/[""'']/g, '')
      .replace(/[^\w\sáéíóúüñÁÉÍÓÚÜÑ-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 60);
    setScouting(true);
    setScoutError(null);
    try {
      const res  = await fetch(`/api/ml-search?q=${encodeURIComponent(q)}&limit=8&exclude=apacheco,apacheco.tienda`);
      const data = await res.json() as { ok: boolean; items?: ScoutItem[]; market?: ScoutMarket; needsCredentials?: boolean; error?: string };
      if (data.ok) {
        setScout({ items: data.items ?? [], market: data.market ?? null });
      } else if (data.needsCredentials) {
        setScoutError('credentials');
      } else {
        setScoutError(data.error ?? 'Error al buscar en ML');
      }
    } catch {
      setScoutError('No se pudo conectar con ML');
    } finally {
      setScouting(false);
    }
  };

  const generateDescription = async () => {
    setDescLoading(true);
    setDescText('');
    try {
      const res = await fetch('/api/ml-description', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(geminiKey ? { 'X-Gemini-Key': geminiKey } : {}) },
        body: JSON.stringify({
          productName: product.name,
          sku: product.sku,
          category: product.category,
          cost: product.cost,
          mlPrice: product.mlPrice,
          mlTitle: product.mlTitle,
          mlCondition: product.mlCondition,
          mlFreeShipping: product.mlFreeShipping,
          mlHasInstallments: product.mlHasInstallments,
          recommendedPrice: consultant.recommendedPrice,
          competitors: scout.items.slice(0, 5).map(i => ({
            title: i.title, price: i.price,
            freeShipping: i.freeShipping, soldQty: i.soldQty, seller: i.seller,
          })),
        }),
      });
      if (!res.ok || !res.body) { setDescText('Error al generar. Revisá la API key.'); return; }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let text = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        text += dec.decode(value, { stream: true });
        setDescText(text);
      }
    } catch {
      setDescText('No se pudo conectar con el generador.');
    } finally {
      setDescLoading(false);
    }
  };

  // Build initial consultant message from static analysis
  const buildInitialMessage = useCallback((): string => {
    const scoreEmoji = consultant.overallScore >= 70 ? '🟢' : consultant.overallScore >= 40 ? '🟡' : '🔴';
    const parts: string[] = [
      `${scoreEmoji} Score ${consultant.overallScore}/100 — ${consultant.strategyLabel}.`,
    ];
    parts.push(consultant.diagnosis);
    if (consultant.recommendedPrice > 0 && product.cost > 0) {
      parts.push(`Te recomiendo publicar a ${new Intl.NumberFormat('es-AR',{style:'currency',currency:'ARS',maximumFractionDigits:0}).format(consultant.recommendedPrice)} con markup ${consultant.recommendedMarkup.toFixed(1)}% en Odoo — margen estimado ${consultant.estimatedMargin.toFixed(1)}%.`);
    }
    parts.push('¿Tenés alguna duda sobre los números, o querés explorar otras opciones?');
    return parts.join(' ');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product.id]);

  // Initialize chat when opening Consultor tab
  useEffect(() => {
    if (fichaTab === 'consultor' && !chatInitialized.current) {
      chatInitialized.current = true;
      setChatMessages([{ role: 'assistant', content: buildInitialMessage() }]);
    }
  }, [fichaTab, buildInitialMessage]);

  // Reset chat when product changes
  useEffect(() => {
    chatInitialized.current = false;
    setChatMessages([]);
    setChatInput('');
  }, [product.id]);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const sendChatMessage = async () => {
    const text = chatInput.trim();
    if (!text || chatLoading) return;

    const userMsg: ChatMessage = { role: 'user', content: text };
    const nextMessages = [...chatMessages, userMsg];
    setChatMessages(nextMessages);
    setChatInput('');
    setChatLoading(true);

    try {
      const res = await fetch('/api/ml-consult', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(geminiKey ? { 'X-Gemini-Key': geminiKey } : {}) },
        body: JSON.stringify({
          messages: nextMessages,
          product: {
            name: product.name, sku: product.sku, mlItemId: product.mlItemId,
            cost: product.cost, mlPrice: product.mlPrice, mlStatus: product.mlStatus,
            mlSold: product.mlSold, mlVisits: product.mlVisits,
            mlFreeShipping: product.mlFreeShipping, mlHasInstallments: product.mlHasInstallments,
            stock: product.stock, syncStatus: product.syncStatus,
            markup: product.markup, alerts: product.alerts,
          },
          params,
          calc: product.calc,
          idealPrice: product.cost > 0 ? calcIdealPrice(product.cost, params.idealMargin, params) : 0,
          idealMarkup: product.calcIdeal?.markup ?? 0,
          consultantScore: consultant.overallScore,
          consultantStrategy: consultant.strategy,
          consultantStrategyLabel: consultant.strategyLabel,
        }),
      });

      if (!res.ok) {
        const err = await res.json() as { error?: string };
        setChatMessages(prev => [...prev, {
          role: 'assistant',
          content: `Error: ${err.error ?? 'No se pudo conectar con el consultor.'}`,
        }]);
        return;
      }

      // Stream the response
      const reader = res.body?.getReader();
      if (!reader) return;
      const decoder = new TextDecoder();
      let assistantText = '';
      setChatMessages(prev => [...prev, { role: 'assistant', content: '' }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        assistantText += decoder.decode(value, { stream: true });
        setChatMessages(prev => {
          const updated = [...prev];
          updated[updated.length - 1] = { role: 'assistant', content: assistantText };
          return updated;
        });
      }
    } catch {
      setChatMessages(prev => [...prev, {
        role: 'assistant',
        content: 'No pude conectarme. Revisá la API key en .env.local.',
      }]);
    } finally {
      setChatLoading(false);
    }
  };

  const BRow = ({ label, value, sub, neg, pos, big }: {
    label: string; value: string; sub?: string; neg?: boolean; pos?: boolean; big?: boolean;
  }) => (
    <div className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
      <div className="min-w-0">
        <span className="text-[12px] text-gray-600">{label}</span>
        {sub && <span className="text-[10px] text-gray-400 ml-1">({sub})</span>}
      </div>
      <span className={cn(
        'font-bold tabular-nums shrink-0 ml-2',
        big ? 'text-[16px]' : 'text-[13px]',
        pos ? 'text-[#16A34A]' : neg ? 'text-[#EF4444]' : 'text-gray-900',
      )}>{value}</span>
    </div>
  );

  return (
    <div className="flex flex-col h-full bg-white">

      {/* ── MODAL HEADER ── */}
      <div className="shrink-0 px-5 py-3 border-b border-gray-100 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <h2 className="text-[14px] font-black text-gray-900 line-clamp-1">{product.name}</h2>
          <SyncBadge status={product.syncStatus} />
          {calc && (
            <span className={cn(
              'px-2 py-0.5 rounded-full text-[10px] font-bold',
              PROFIT_META[calc.status].bg, PROFIT_META[calc.status].text,
            )}>
              {PROFIT_META[calc.status].label}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={() => setShowParams(v => !v)}
            title="Parámetros" className={cn(
              'w-8 h-8 flex items-center justify-center rounded-lg transition-colors',
              showParams ? 'bg-gray-200 text-gray-700' : 'hover:bg-gray-100 text-gray-400',
            )}>
            <Settings className="w-4 h-4" />
          </button>
          <button onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* ── 2-COLUMN BODY ── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* LEFT COLUMN */}
        <div className="w-64 shrink-0 border-r border-gray-100 p-4 flex flex-col gap-3 overflow-y-auto bg-gray-50/50">

          {/* Thumbnail + name */}
          <div className="flex items-center gap-3">
            <div className="w-20 h-20 rounded-xl bg-white border border-gray-200 flex items-center justify-center overflow-hidden shrink-0 shadow-sm">
              {(product.mlThumbnail || product.image)
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={product.mlThumbnail ?? product.image ?? ''} alt="" className="w-full h-full object-contain p-1" />
                : <Package className="w-8 h-8 text-gray-300" />}
            </div>
            <div className="min-w-0">
              <p className="text-[12px] font-bold text-gray-900 line-clamp-2 leading-tight">{product.name}</p>
              <div className="flex flex-col gap-0.5 mt-1">
                {product.sku && <span className="text-[10px] font-mono text-gray-400">{product.sku}</span>}
                {product.mlItemId && <span className="text-[10px] font-mono text-[#0784F2]">{product.mlItemId}</span>}
              </div>
            </div>
          </div>

          {/* COSTO | ML | IDEAL grid */}
          <div className="grid grid-cols-3 gap-1.5">
            <div className="bg-white rounded-xl px-2 py-2 text-center border border-gray-100">
              <div className="text-[9px] text-gray-400 font-semibold uppercase tracking-wide leading-tight mb-1">Costo</div>
              <div className="text-[12px] font-black text-gray-900">{product.cost > 0 ? ars(product.cost) : '—'}</div>
            </div>
            <div className="bg-[#FFE600]/10 rounded-xl px-2 py-2 text-center border border-[#FFE600]/20">
              <div className="text-[9px] text-gray-400 font-semibold uppercase tracking-wide leading-tight mb-1">ML</div>
              <div className="text-[12px] font-black text-gray-900">{product.mlPrice ? ars(product.mlPrice) : '—'}</div>
            </div>
            <div className="bg-[#16A34A]/5 rounded-xl px-2 py-2 text-center border border-[#16A34A]/15">
              <div className="text-[9px] text-gray-400 font-semibold uppercase tracking-wide leading-tight mb-1">Ideal</div>
              <div className="text-[12px] font-black text-[#16A34A]">{idealPrice > 0 ? ars(idealPrice) : '—'}</div>
            </div>
          </div>

          {/* Alerts */}
          {product.alerts.slice(0, 3).map((a, i) => (
            <div key={i} className={cn(
              'flex items-start gap-2 px-3 py-2 rounded-xl text-[11px]',
              a.type === 'danger'  ? 'bg-[#EF4444]/8 text-[#EF4444]' :
              a.type === 'warning' ? 'bg-[#F97316]/8 text-[#F97316]' : 'bg-[#0784F2]/8 text-[#0784F2]',
            )}>
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span className="leading-snug">{a.message}</span>
            </div>
          ))}

          {/* Params collapse */}
          <div>
            <button
              onClick={() => setShowParams(v => !v)}
              className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-500 hover:text-gray-700 transition-colors w-full"
            >
              <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', showParams && 'rotate-180')} />
              Parámetros del producto
            </button>
            {showParams && (
              <div className="mt-2 bg-white rounded-xl p-3 border border-gray-200">
                <GlobalParamsPanel params={params} onChange={updateParams} />
              </div>
            )}
          </div>
        </div>

        {/* RIGHT COLUMN */}
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">

          {/* Tab bar */}
          <div className="flex border-b border-gray-100 shrink-0 overflow-x-auto">
            {([
              { key: 'rentabilidad', label: 'Rentabilidad' },
              { key: 'escenarios',   label: 'Escenarios' },
              { key: 'consultor',    label: 'Consultor' },
              { key: 'datos',        label: 'Datos' },
              { key: 'ml',           label: 'Publicación' },
            ] as { key: FichaTab; label: string }[]).map(t => (
              <button key={t.key} onClick={() => setFichaTab(t.key)}
                className={cn(
                  'px-4 py-3 text-[12px] font-semibold border-b-2 shrink-0 transition-colors whitespace-nowrap',
                  fichaTab === t.key ? 'border-[#07111F] text-[#07111F]' : 'border-transparent text-gray-400 hover:text-gray-600',
                )}>
                {t.label}
              </button>
            ))}
          </div>

          {/* Tab content (scrollable) */}
          <div className="flex-1 overflow-y-auto">

            {/* ── RENTABILIDAD ── */}
            {fichaTab === 'rentabilidad' && (
              <div className="p-5 space-y-4">
                {calc ? (
                  <>
                    {/* Hero */}
                    <div className={cn(
                      'rounded-2xl p-4 text-center border',
                      calc.status === 'rentable'   ? 'bg-[#16A34A]/5 border-[#16A34A]/20' :
                      calc.status === 'bajo_margen' ? 'bg-[#F97316]/5 border-[#F97316]/20' :
                      'bg-[#EF4444]/5 border-[#EF4444]/20',
                    )}>
                      <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-1">Precio publicado</p>
                      <p className="text-3xl font-black text-gray-900">{ars(calc.price)}</p>
                      <div className="flex items-center justify-center gap-2 mt-2 flex-wrap">
                        <MarginBadge value={calc.netMargin} minMargin={params.minMargin} />
                        <span className="text-[11px] text-gray-500">margen neto</span>
                        <span className="text-[11px] text-gray-400">·</span>
                        <span className="text-[11px] text-gray-500">{ars(calc.netProfit)} utilidad</span>
                      </div>
                    </div>

                    {/* Waterfall */}
                    <div className="bg-white border border-gray-100 rounded-2xl p-4 space-y-0">
                      <BRow label="Precio ML (con IVA)"          value={ars(calc.price)}                         big />
                      <BRow label="Comisión ML"                  value={`-${ars(calc.commission)}`}              neg  sub={`${params.commission}%`} />
                      {calc.fixedFee > 0       && <BRow label="Cargo fijo"          value={`-${ars(calc.fixedFee)}`}           neg  sub="por unidad" />}
                      {calc.shippingCost > 0   && <BRow label="Envío gratis"         value={`-${ars(calc.shippingCost)}`}       neg />}
                      {calc.installmentsCost > 0 && <BRow label="Cuotas sin interés" value={`-${ars(calc.installmentsCost)}`}   neg  sub={`${params.installmentsCost}%`} />}
                      <BRow label="Depósito ML"                  value={ars(calc.depositML)}                     pos />
                      {params.isRI             && <BRow label="IVA (21%)"            value={`-${ars(calc.ivaDiscounted)}`}      neg />}
                      {calc.iibbCost > 0       && <BRow label="IIBB"                 value={`-${ars(calc.iibbCost)}`}           neg  sub={`${params.iibb}%`} />}
                      {calc.advertisingCost > 0 && <BRow label="Publicidad ML"       value={`-${ars(calc.advertisingCost)}`}    neg  sub={`${params.advertising}%`} />}
                      {calc.otherCosts > 0     && <BRow label="Otros costos"          value={`-${ars(calc.otherCosts)}`}        neg />}
                      <BRow label="Ingreso neto limpio"          value={ars(calc.netRevenue)}                    pos />
                      <BRow label="Costo del producto"           value={`-${ars(calc.cost)}`}                   neg />
                      <BRow label="Utilidad neta"                value={ars(calc.netProfit)}                     pos={calc.netProfit > 0} neg={calc.netProfit <= 0} big />
                    </div>

                    {/* Odoo data */}
                    <div className="bg-[#714B67]/5 border border-[#714B67]/15 rounded-2xl p-4">
                      <p className="text-[10px] font-bold text-[#714B67] uppercase tracking-wide mb-3">Para Odoo</p>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="text-center">
                          <div className="text-[10px] text-gray-400 mb-1">Markup actual</div>
                          <div className="text-[16px] font-black text-gray-900">{product.markup.toFixed(1)}%</div>
                        </div>
                        <div className="text-center">
                          <div className="text-[10px] text-gray-400 mb-1">Lista Markup (sin IVA)</div>
                          <div className="text-[16px] font-black text-gray-900">{ars(calc.odooListMarkup)}</div>
                        </div>
                        <div className="text-center">
                          <div className="text-[10px] text-gray-400 mb-1">Markup ideal ({params.idealMargin}% margen)</div>
                          <div className="text-[16px] font-black text-[#16A34A]">
                            {idealCalc ? `${idealCalc.markup.toFixed(1)}%` : '—'}
                          </div>
                        </div>
                        <div className="text-center">
                          <div className="text-[10px] text-gray-400 mb-1">Lista ML ideal</div>
                          <div className="text-[16px] font-black text-[#16A34A]">{idealPrice > 0 ? ars(idealPrice) : '—'}</div>
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="text-center py-12">
                    <DollarSign className="w-10 h-10 text-gray-300 mx-auto mb-3" />
                    <p className="font-semibold text-gray-500">Sin datos para calcular</p>
                    <p className="text-[12px] text-gray-400 mt-1">Necesitás costo + precio ML publicado.</p>
                  </div>
                )}
              </div>
            )}

            {/* ── ESCENARIOS ── */}
            {fichaTab === 'escenarios' && (() => {
              // Determine the single best scenario key
              const strategyMap: Record<string, ScenarioKey> = {
                activar_envio_gratis: 'envio_gratis',
                activar_cuotas:       'cuotas_6x',
                pack:                 'pack_x2',
                subir_markup:         'precio_rentable',
                bajar_markup:         'precio_agresivo',
                mantener:             'actual',
                pausar:               'actual',
                mejorar_publicacion:  'precio_rentable',
              };
              const bestKey: ScenarioKey =
                strategyMap[consultant.strategy] ??
                scenarios.find(s => s.recommended)?.key ??
                'actual';
              const bestSc = scenarios.find(s => s.key === bestKey);

              return (
                <div className="p-5 space-y-2">
                  {/* Best scenario — prominent hero card */}
                  {bestSc && (
                    <div className="rounded-2xl bg-[#07111F] p-4 mb-4 shadow-lg">
                      <div className="flex items-center gap-2 mb-3">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#FFE600] text-[#07111F] text-[10px] font-black tracking-wide uppercase">
                          <Zap className="w-3 h-3" />
                          Mejor opción
                        </span>
                        <span className={cn(
                          'px-2 py-0.5 rounded text-[9px] font-bold uppercase',
                          bestSc.risk === 'bajo'  ? 'bg-white/10 text-white/60' :
                          bestSc.risk === 'medio' ? 'bg-[#F97316]/20 text-[#F97316]' : 'bg-[#EF4444]/20 text-[#EF4444]',
                        )}>Riesgo {bestSc.risk}</span>
                      </div>
                      <p className="text-[15px] font-black text-white mb-1">{bestSc.label}</p>
                      <p className="text-[12px] text-white/60 mb-3">{bestSc.description}</p>
                      {bestSc.calc && (
                        <div className="grid grid-cols-3 gap-2">
                          <div className="bg-white/8 rounded-xl p-2.5 text-center">
                            <div className="text-[9px] text-white/40 uppercase tracking-wide mb-1">Precio</div>
                            <div className="text-[14px] font-black text-[#FFE600]">{ars(bestSc.calc.price)}</div>
                          </div>
                          <div className="bg-white/8 rounded-xl p-2.5 text-center">
                            <div className="text-[9px] text-white/40 uppercase tracking-wide mb-1">Margen</div>
                            <div className={cn('text-[14px] font-black',
                              bestSc.calc.netMargin >= params.minMargin ? 'text-[#4ADE80]' : 'text-[#F97316]',
                            )}>{pctFmt(bestSc.calc.netMargin)}</div>
                          </div>
                          <div className="bg-white/8 rounded-xl p-2.5 text-center">
                            <div className="text-[9px] text-white/40 uppercase tracking-wide mb-1">Utilidad</div>
                            <div className="text-[14px] font-black text-white">{ars(bestSc.calc.netProfit)}</div>
                          </div>
                        </div>
                      )}
                      {bestSc.recommendedMarkup !== null && (
                        <p className="text-[11px] text-[#A78BFA] font-semibold mt-2.5">
                          Markup Odoo: {bestSc.recommendedMarkup.toFixed(1)}%
                          {bestSc.vsActualMargin !== null && (
                            <span className={cn('ml-2', bestSc.vsActualMargin >= 0 ? 'text-[#4ADE80]' : 'text-[#F87171]')}>
                              ({bestSc.vsActualMargin >= 0 ? '+' : ''}{bestSc.vsActualMargin.toFixed(1)}% vs actual)
                            </span>
                          )}
                        </p>
                      )}
                    </div>
                  )}

                  {/* Sub-header for rest */}
                  <p className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider px-1 pb-1">
                    Otros escenarios — Precio base: {product.mlPrice ? ars(product.mlPrice) : product.odooListML > 0 ? ars(product.odooListML) : '—'} · Mín: {params.minMargin}% · Ideal: {params.idealMargin}%
                  </p>

                  {/* Remaining scenarios */}
                  {scenarios.filter(sc => sc.key !== bestKey).map(sc => (
                    <div key={sc.key} className={cn(
                      'rounded-xl border p-3 transition-all',
                      sc.recommended ? 'border-[#16A34A]/25 bg-[#16A34A]/4' :
                      (sc.calc && sc.calc.status === 'pierde') ? 'border-[#EF4444]/20 bg-[#EF4444]/3' :
                      'border-gray-100 bg-gray-50',
                    )}>
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <div className="flex items-center gap-1.5">
                          {sc.recommended && <Star className="w-3 h-3 text-[#16A34A] shrink-0" />}
                          <p className="text-[12px] font-bold text-gray-900">{sc.label}</p>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {sc.calc && <MarginBadge value={sc.calc.netMargin} minMargin={params.minMargin} />}
                          <span className={cn(
                            'px-1.5 py-0.5 rounded text-[9px] font-bold uppercase',
                            sc.risk === 'bajo'  ? 'bg-gray-100 text-gray-400' :
                            sc.risk === 'medio' ? 'bg-[#F97316]/10 text-[#F97316]' : 'bg-[#EF4444]/10 text-[#EF4444]',
                          )}>Riesgo {sc.risk}</span>
                        </div>
                      </div>
                      <p className="text-[10px] text-gray-400 mb-1.5">{sc.description}</p>
                      <div className="flex items-center gap-2 flex-wrap text-[11px]">
                        {sc.calc && (
                          <>
                            <span className="font-semibold text-gray-800">Precio: {ars(sc.calc.price)}</span>
                            <span className="text-gray-300">·</span>
                            <span className="text-gray-500">Utilidad: {ars(sc.calc.netProfit)}</span>
                            {sc.recommendedMarkup !== null && (
                              <>
                                <span className="text-gray-300">·</span>
                                <span className="text-[#714B67]">Markup: {sc.recommendedMarkup.toFixed(1)}%</span>
                              </>
                            )}
                            {sc.vsActualMargin !== null && (
                              <span className={cn('font-semibold', sc.vsActualMargin >= 0 ? 'text-[#16A34A]' : 'text-[#EF4444]')}>
                                ({sc.vsActualMargin >= 0 ? '+' : ''}{sc.vsActualMargin.toFixed(1)}% vs actual)
                              </span>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              );
            })()}

            {/* ── CONSULTOR (Chat) ── */}
            {fichaTab === 'consultor' && (
              <div className="flex flex-col h-full min-h-0">

                {/* Quick context strip */}
                <div className="shrink-0 flex items-center gap-3 px-4 py-2 bg-gray-50 border-b border-gray-100">
                  <div className={cn(
                    'text-[11px] font-black tabular-nums px-2 py-0.5 rounded-lg',
                    consultant.overallScore >= 70 ? 'bg-[#16A34A]/15 text-[#16A34A]' :
                    consultant.overallScore >= 40 ? 'bg-[#F97316]/15 text-[#F97316]' : 'bg-[#EF4444]/15 text-[#EF4444]',
                  )}>
                    {consultant.overallScore}
                  </div>
                  <span className="text-[11px] font-semibold text-gray-700 flex-1 truncate">{consultant.strategyLabel}</span>
                  {consultant.recommendedPrice > 0 && (
                    <span className="text-[11px] font-bold text-[#16A34A] shrink-0">
                      Sugerido: {ars(consultant.recommendedPrice)}
                    </span>
                  )}
                  <button onClick={runScout} disabled={scouting} title="Escanear competencia ML"
                    className="flex items-center gap-1 px-2 py-1 bg-[#FFE600] text-gray-900 text-[10px] font-bold rounded-lg hover:opacity-90 disabled:opacity-60 transition-opacity shrink-0">
                    {scouting ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
                    {scouting ? '…' : 'Scout'}
                  </button>
                </div>

                {/* Chat messages */}
                <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
                  {chatMessages.map((msg, i) => (
                    <div key={i} className={cn('flex gap-2', msg.role === 'user' ? 'justify-end' : 'justify-start')}>
                      {msg.role === 'assistant' && (
                        <div className="w-7 h-7 rounded-full bg-[#FFE600] flex items-center justify-center shrink-0 mt-0.5 text-[11px] font-black text-[#07111F]">
                          C
                        </div>
                      )}
                      <div className={cn(
                        'max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed',
                        msg.role === 'user'
                          ? 'bg-[#07111F] text-white rounded-tr-sm'
                          : 'bg-white border border-gray-200 text-gray-800 rounded-tl-sm shadow-sm',
                      )}>
                        {msg.content || (
                          <span className="flex gap-1 items-center text-gray-400">
                            <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '0ms' }} />
                            <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '150ms' }} />
                            <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '300ms' }} />
                          </span>
                        )}
                      </div>
                      {msg.role === 'user' && (
                        <div className="w-7 h-7 rounded-full bg-[#07111F] flex items-center justify-center shrink-0 mt-0.5 text-[10px] font-bold text-white">
                          Vos
                        </div>
                      )}
                    </div>
                  ))}
                  <div ref={chatEndRef} />
                </div>

                {/* Quick suggestion chips */}
                {chatMessages.length <= 1 && (
                  <div className="shrink-0 px-4 pb-2 flex gap-1.5 flex-wrap">
                    {[
                      '¿Por qué pierde plata?',
                      '¿Qué precio pongo?',
                      '¿Conviene envío gratis?',
                      'Explicame el cargo fijo',
                    ].map(suggestion => (
                      <button key={suggestion}
                        onClick={() => { setChatInput(suggestion); }}
                        className="px-2.5 py-1 rounded-full border border-gray-200 bg-white text-[11px] text-gray-600 hover:border-[#FFE600] hover:bg-[#FFE600]/10 transition-colors">
                        {suggestion}
                      </button>
                    ))}
                  </div>
                )}

                {/* Input area */}
                <div className="shrink-0 border-t border-gray-100 px-3 py-2.5 flex items-end gap-2 bg-white">
                  <textarea
                    value={chatInput}
                    onChange={e => setChatInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        void sendChatMessage();
                      }
                    }}
                    placeholder="Preguntá lo que quieras sobre este producto…"
                    rows={1}
                    className="flex-1 resize-none rounded-xl border border-gray-200 px-3 py-2 text-[13px] text-gray-900 placeholder-gray-400 focus:outline-none focus:border-[#07111F] transition-colors min-h-[36px] max-h-[120px]"
                    style={{ height: 'auto' }}
                    disabled={chatLoading}
                  />
                  <button
                    onClick={() => void sendChatMessage()}
                    disabled={chatLoading || !chatInput.trim()}
                    className="w-9 h-9 rounded-xl bg-[#07111F] text-white flex items-center justify-center disabled:opacity-40 hover:bg-[#1a2b40] transition-colors shrink-0"
                  >
                    {chatLoading
                      ? <RefreshCw className="w-4 h-4 animate-spin" />
                      : <ArrowUpRight className="w-4 h-4" />}
                  </button>
                </div>

              </div>
            )}

            {/* ── DATOS INTERNOS ── */}
            {fichaTab === 'datos' && (
              <div className="p-5 space-y-4">
                <div>
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-3">Datos Odoo / Inventario</p>
                  <div className="space-y-1">
                    {[
                      ['Nombre',     product.name],
                      ['SKU',        product.sku ?? '—'],
                      ['Cód. barras',product.barcode ?? '—'],
                      ['Costo',      product.cost > 0 ? ars(product.cost) : '—'],
                      ['Stock',      String(product.stock)],
                      ['Markup Odoo',`${product.markup.toFixed(1)}%`],
                      ['Lista Markup (sin IVA)', product.odooPrice > 0 ? ars(product.odooPrice) : '—'],
                      ['Lista ML (con IVA)',     product.odooListML > 0 ? ars(product.odooListML) : '—'],
                      ['Categoría',  product.category ?? '—'],
                      ['Proveedor',  product.supplier ?? '—'],
                      ['ID Odoo',    product.odooId ? `#${product.odooId}` : '—'],
                    ].map(([label, value]) => (
                      <div key={label} className="flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0">
                        <span className="text-[11px] text-gray-400">{label}</span>
                        <span className="text-[12px] font-semibold text-gray-900 text-right ml-4">{value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* ── PUBLICACIÓN ML ── */}
            {fichaTab === 'ml' && (
              <div className="p-5 space-y-5">

                {/* ─ Datos actuales ─ */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Publicación actual</p>
                    {product.mlPermalink && (
                      <a href={product.mlPermalink} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-1 text-[11px] font-semibold text-[#3483FA] hover:underline">
                        <ExternalLink className="w-3 h-3" />
                        Ver en ML
                      </a>
                    )}
                  </div>
                  {product.mlItemId ? (
                    <div className="bg-gray-50 rounded-xl border border-gray-100 p-3 space-y-0">
                      {[
                        ['Título',         product.mlTitle ?? '—'],
                        ['ID',             product.mlItemId],
                        ['Precio',         product.mlPrice ? ars(product.mlPrice) : '—'],
                        ['Estado',         product.mlStatus ?? '—'],
                        ['Vendidos',       product.mlSold !== undefined ? String(product.mlSold) : '—'],
                        ['Visitas',        product.mlVisits !== undefined ? String(product.mlVisits) : '—'],
                        ['Conversión',     product.mlVisits && product.mlSold ? `${((product.mlSold / product.mlVisits) * 100).toFixed(1)}%` : '—'],
                        ['Envío gratis',   product.mlFreeShipping ? 'Sí' : 'No'],
                        ['Cuotas s/int.',  product.mlHasInstallments ? 'Sí' : 'No'],
                        ['Condición',      product.mlCondition ?? '—'],
                      ].map(([label, value]) => (
                        <div key={label} className="flex items-start justify-between py-1.5 border-b border-gray-100 last:border-0 gap-3">
                          <span className="text-[11px] text-gray-400 shrink-0">{label}</span>
                          <span className="text-[11px] font-semibold text-gray-800 text-right">{value}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-xl border border-dashed border-gray-200 py-6 text-center text-gray-400">
                      <ShoppingCart className="w-8 h-8 mx-auto mb-2 opacity-30" />
                      <p className="text-[12px]">Sin publicación vinculada en ML</p>
                    </div>
                  )}
                </div>

                {/* ─ Competencia en ML ─ */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                      Competencia en ML
                      {scout.items.length > 0 && <span className="ml-1 text-gray-300">({scout.items.length})</span>}
                    </p>
                    <button onClick={() => void runScout()} disabled={scouting}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 bg-[#FFE600] text-gray-900 text-[11px] font-bold rounded-lg hover:opacity-90 disabled:opacity-60 transition-opacity">
                      {scouting ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
                      {scouting ? 'Escaneando…' : scout.items.length > 0 ? 'Actualizar' : 'Escanear ML'}
                    </button>
                  </div>

                  {scout.market && (
                    <div className="grid grid-cols-3 gap-2 mb-3">
                      {[
                        { label: 'Promedio', value: ars(scout.market.avgPrice) },
                        { label: 'Mínimo',   value: ars(scout.market.minPrice) },
                        { label: 'Máximo',   value: ars(scout.market.maxPrice) },
                      ].map(s => (
                        <div key={s.label} className="bg-[#3483FA]/5 border border-[#3483FA]/15 rounded-xl p-2 text-center">
                          <div className="text-[9px] text-gray-400 uppercase tracking-wide mb-0.5">{s.label}</div>
                          <div className="text-[13px] font-black text-gray-900">{s.value}</div>
                        </div>
                      ))}
                    </div>
                  )}

                  {scoutError === 'credentials' ? (
                    <div className="rounded-xl border border-[#F97316]/30 bg-[#F97316]/5 p-4">
                      <p className="text-[12px] font-bold text-[#F97316] mb-1">Necesitás credenciales de MercadoLibre</p>
                      <p className="text-[11px] text-gray-600 mb-3">ML cerró su API pública. Para escanear competencia necesitás crear una app gratuita en su portal de desarrolladores.</p>
                      <ol className="text-[11px] text-gray-600 space-y-1 list-decimal list-inside mb-3">
                        <li>Ingresá a <span className="font-mono text-[#3483FA]">developers.mercadolibre.com.ar</span></li>
                        <li>Creá una nueva app (tipo Marketplace)</li>
                        <li>Copiá el <strong>App ID</strong> y <strong>Secret Key</strong></li>
                        <li>Pegálos en <span className="font-mono bg-gray-100 px-1 rounded">.env.local</span> como <span className="font-mono">ML_APP_ID</span> y <span className="font-mono">ML_APP_SECRET</span></li>
                        <li>Reiniciá el servidor</li>
                      </ol>
                      <a href="https://developers.mercadolibre.com.ar/devcenter" target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#3483FA] text-white text-[11px] font-bold rounded-lg hover:opacity-90 transition-opacity">
                        <ExternalLink className="w-3 h-3" />
                        Ir al Dev Center de ML
                      </a>
                    </div>
                  ) : scoutError ? (
                    <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[12px] text-red-700">
                      Error: {scoutError}
                    </div>
                  ) : scout.items.length > 0 ? (
                    <div className="space-y-2">
                      {scout.items.map(item => (
                        <a key={item.id} href={item.permalink} target="_blank" rel="noopener noreferrer"
                          className="flex items-center gap-3 p-2.5 rounded-xl border border-gray-100 bg-white hover:border-[#3483FA]/30 hover:bg-[#3483FA]/3 transition-colors group">
                          {item.thumbnail
                            // eslint-disable-next-line @next/next/no-img-element
                            ? <img src={item.thumbnail} alt="" className="w-10 h-10 rounded-lg object-contain bg-gray-50 shrink-0" />
                            : <div className="w-10 h-10 rounded-lg bg-gray-100 shrink-0" />}
                          <div className="flex-1 min-w-0">
                            <p className="text-[11px] font-semibold text-gray-800 line-clamp-2 leading-snug">{item.title}</p>
                            <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                              {item.freeShipping && <span className="text-[9px] text-[#16A34A] font-semibold">Envío gratis</span>}
                              {item.soldQty > 0 && <span className="text-[9px] text-gray-400">{item.soldQty} vendidos</span>}
                              {item.seller && <span className="text-[9px] text-gray-300">{item.seller}</span>}
                            </div>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="text-[13px] font-black text-gray-900">{ars(item.price)}</p>
                            <ExternalLink className="w-3 h-3 text-gray-300 group-hover:text-[#3483FA] ml-auto transition-colors" />
                          </div>
                        </a>
                      ))}
                    </div>
                  ) : !scouting && (
                    <div className="rounded-xl border border-dashed border-gray-200 py-5 text-center text-gray-400">
                      <p className="text-[12px]">Presioná "Escanear ML" para ver precios de competidores</p>
                      <p className="text-[10px] mt-1 text-gray-300">Tu tienda (apacheco.tienda) queda excluida</p>
                    </div>
                  )}
                </div>

                {/* ─ Descripción recomendada por IA ─ */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Descripción recomendada por IA</p>
                    <button onClick={() => void generateDescription()} disabled={descLoading}
                      className="flex items-center gap-1.5 px-2.5 py-1.5 bg-[#07111F] text-white text-[11px] font-bold rounded-lg hover:bg-[#1a2b40] disabled:opacity-60 transition-colors">
                      {descLoading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                      {descLoading ? 'Generando…' : descText ? 'Regenerar' : 'Generar con IA'}
                    </button>
                  </div>

                  {descText ? (
                    <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
                      <pre className="text-[12px] text-gray-800 whitespace-pre-wrap font-sans leading-relaxed">
                        {descText}
                      </pre>
                    </div>
                  ) : !descLoading && (
                    <div className="rounded-xl border border-dashed border-gray-200 py-5 text-center">
                      <Sparkles className="w-6 h-6 mx-auto mb-2 text-gray-300" />
                      <p className="text-[12px] text-gray-400">
                        Generá un título optimizado, palabras clave y descripción<br/>
                        <span className="text-[10px] text-gray-300">Usará los datos del producto y la competencia escaneada</span>
                      </p>
                    </div>
                  )}
                </div>

              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN PAGE
// ─────────────────────────────────────────────────────────────────────────────

type MainTab = 'dashboard' | 'importar' | 'tabla' | 'export';

export default function MLLabPage() {
  const store = useMLLabStore();
  const [activeTab,    setActiveTab]    = useState<MainTab>('dashboard');
  const [selectedId,   setSelectedId]   = useState<string | null>(null);
  const [showParamsPanel, setShowParamsPanel] = useState(false);
  const [geminiKey,    setGeminiKey]    = useState('');
  const [geminiInput,  setGeminiInput]  = useState('');
  const [showGeminiKey, setShowGeminiKey] = useState(false);

  // Load Gemini key from localStorage on mount
  useEffect(() => {
    const k = loadGeminiKey();
    setGeminiKey(k);
    setGeminiInput(k);
  }, []);

  const selectedProduct = useMemo(
    () => store.products.find(p => p.id === selectedId) ?? null,
    [store.products, selectedId],
  );

  const handleSelectProduct = useCallback((id: string) => {
    setSelectedId(prev => prev === id ? null : id);
  }, []);

  const { stats } = store;

  return (
    <div className="min-h-screen bg-[#F4F7FA] flex flex-col">

      {/* ── HEADER ── */}
      <div className="bg-[#FFE600] shrink-0">
        <div className="max-w-[1920px] mx-auto px-5 lg:px-8 py-4">
          <div className="flex items-center justify-between gap-4">

            <div className="flex items-center gap-3">
              {/* MercadoLibre official logo */}
              <Image
                src="/ml-logo.png"
                alt="Mercado Libre"
                width={134}
                height={34}
                priority
                className="h-8 w-auto"
              />
              {/* Lab badge */}
              <span className="inline-flex items-center px-2.5 py-1 rounded-lg bg-[#3483FA] text-white text-[11px] font-black tracking-wide leading-none shadow-sm">
                LAB
              </span>
              <div className="hidden sm:block ml-1">
                <p className="text-[11px] text-[#07111F]/60 font-medium">
                  {store.lastImportAt
                    ? `Espejo actualizado ${new Date(store.lastImportAt).toLocaleDateString('es-AR')}`
                    : 'Espejo maestro — Odoo + Inventario + MercadoLibre'}
                </p>
              </div>
            </div>

            {stats.total > 0 && (
              <div className="hidden md:flex items-center gap-5">
                {[
                  { label: 'Total',       value: stats.total,       color: 'text-[#07111F]' },
                  { label: 'Rentables',   value: stats.rentables,   color: 'text-[#16A34A]' },
                  { label: 'Bajo margen', value: stats.bajoMargen,  color: 'text-[#D97706]' },
                  { label: 'Pierden',     value: stats.pierde,      color: 'text-[#DC2626]' },
                  { label: 'Activas ML',  value: stats.activas,     color: 'text-[#07111F]' },
                ].map((s, i) => (
                  <div key={s.label} className="text-center">
                    {i > 0 && <div className="w-px h-8 bg-[#07111F]/10 absolute -ml-2.5 mt-0" />}
                    <div className={cn('text-xl font-black', s.color)}>{s.value}</div>
                    <div className="text-[9px] text-[#07111F]/50 uppercase tracking-wide font-semibold">{s.label}</div>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowParamsPanel(v => !v)}
                className="flex items-center gap-1.5 px-3 py-2 bg-[#07111F]/10 hover:bg-[#07111F]/20 text-[#07111F] rounded-lg text-[11px] font-bold transition-colors"
              >
                <Settings className="w-3.5 h-3.5" /> Parámetros globales
              </button>
              {stats.total > 0 && (
                <button
                  onClick={() => store.clearAll()}
                  className="px-3 py-2 bg-[#07111F]/10 hover:bg-[#07111F]/20 text-[#07111F] rounded-lg text-[11px] font-semibold transition-colors"
                  title="Limpiar todos los datos"
                >
                  Limpiar
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Global params slide-down */}
      {showParamsPanel && (
        <div className="bg-white border-b border-gray-200 shadow-sm shrink-0">
          <div className="max-w-[1920px] mx-auto px-5 lg:px-8 py-4 space-y-4">
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-x-8 gap-y-2 max-w-4xl">
              <GlobalParamsPanel params={store.globalParams} onChange={store.setGlobalParams} />
            </div>

            {/* ─── Clave IA Gemini ─── */}
            <div className="border-t border-gray-100 pt-4 max-w-lg">
              <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wide mb-2">Clave IA (Consultor y Descripciones)</p>
              <div className="flex items-center gap-2">
                <div className="relative flex-1">
                  <input
                    type={showGeminiKey ? 'text' : 'password'}
                    value={geminiInput}
                    onChange={e => setGeminiInput(e.target.value)}
                    placeholder="AIza... (gratis en aistudio.google.com)"
                    className="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-[12px] font-mono focus:outline-none focus:ring-2 focus:ring-[#FFE600]/40 pr-8"
                  />
                  <button
                    onClick={() => setShowGeminiKey(v => !v)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 text-[10px]"
                  >
                    {showGeminiKey ? '🙈' : '👁'}
                  </button>
                </div>
                <button
                  onClick={() => {
                    if (geminiInput.trim()) {
                      saveGeminiKey(geminiInput.trim());
                      setGeminiKey(geminiInput.trim());
                    } else {
                      clearGeminiKey();
                      setGeminiKey('');
                    }
                  }}
                  className="px-3 py-1.5 bg-[#FFE600] text-[#07111F] rounded-lg text-[11px] font-bold hover:bg-[#FFC400] transition-colors whitespace-nowrap"
                >
                  Guardar
                </button>
                {geminiKey && (
                  <span className="text-[10px] text-green-600 font-semibold whitespace-nowrap">✓ Activa</span>
                )}
              </div>
              {!geminiKey && (
                <p className="text-[10px] text-gray-400 mt-1">
                  Sin clave, el Consultor y las descripciones IA no funcionan. Gratis en{' '}
                  <a href="https://aistudio.google.com" target="_blank" rel="noreferrer" className="underline text-[#3483FA]">aistudio.google.com</a>
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── TAB BAR ── */}
      <div className="bg-white border-b border-gray-200 shrink-0">
        <div className="max-w-[1920px] mx-auto px-5 lg:px-8">
          <div className="flex gap-0">
            {([
              { key: 'dashboard', label: '🏠 Dashboard',  badge: stats.pierde > 0 ? stats.pierde : undefined },
              { key: 'importar',  label: '📥 Importar' },
              { key: 'tabla',     label: `📋 Tabla`,      badge: stats.total || undefined },
              { key: 'export',    label: '📤 Export Odoo' },
            ] as { key: MainTab; label: string; badge?: number }[]).map(t => (
              <button key={t.key} onClick={() => setActiveTab(t.key)}
                className={cn(
                  'flex items-center gap-2 px-4 py-3.5 text-[13px] font-semibold border-b-2 transition-colors whitespace-nowrap',
                  activeTab === t.key
                    ? 'border-[#07111F] text-[#07111F]'
                    : 'border-transparent text-gray-500 hover:text-gray-700',
                )}>
                {t.label}
                {t.badge !== undefined && t.badge > 0 && (
                  <span className={cn('px-1.5 py-0.5 rounded-full text-[10px] font-bold',
                    activeTab === t.key ? 'bg-[#07111F] text-[#FFE600]' : 'bg-gray-200 text-gray-600')}>
                    {t.badge}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── CONTENT ── */}
      <div className="flex-1 flex overflow-hidden max-w-[1920px] mx-auto w-full">

        {/* Main area */}
        <div className="flex-1 overflow-y-auto">
          {activeTab === 'dashboard' && (
            <DashboardTab
              store={store}
              onSelectProduct={(id) => { handleSelectProduct(id); setActiveTab('tabla'); }}
              onGoToImport={() => setActiveTab('importar')}
            />
          )}
          {activeTab === 'importar' && <ImportTab store={store} />}
          {activeTab === 'tabla' && (
            <TableTab store={store} onSelectProduct={handleSelectProduct} selectedId={selectedId} />
          )}
          {activeTab === 'export' && <ExportTab store={store} />}
        </div>
      </div>

      {/* Product detail modal */}
      {selectedProduct && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={e => { if (e.target === e.currentTarget) setSelectedId(null); }}
          style={{ background: 'rgba(7,17,31,0.55)', backdropFilter: 'blur(4px)' }}
        >
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden">
            <ProductFicha
              product={selectedProduct}
              store={store}
              onClose={() => setSelectedId(null)}
              geminiKey={geminiKey}
            />
          </div>
        </div>
      )}
    </div>
  );
}
