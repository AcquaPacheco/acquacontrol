'use client';

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import * as XLSX from 'xlsx';
import productsData from '@/data/products.json';
import { cn } from '@/lib/utils';
import { useMLLabStore } from '@/lib/use-ml-lab-store';
import { loadGeminiKey, saveGeminiKey, clearGeminiKey } from '@/lib/gemini-key';
import {
  parseOdooRows, parseMLRows, matchAndBuild, calcProfitability,
  calcIdealPrice, generateScenarios, generateConsultantReport, generateAlerts,
  buildOdooExportRows, parseNum, inspectOdooHeaders, getOrphanMLPubs,
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

function MarginBadge({ value, minMargin }: { value: number | null | undefined; minMargin: number }) {
  if (value == null || !isFinite(value)) return null;
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
// MANUAL LINK MODAL — vincular sin_publicacion ↔ orphan ML pub
// ─────────────────────────────────────────────────────────────────────────────

function ManualLinkModal({
  store,
  onClose,
}: {
  store: ReturnType<typeof useMLLabStore>;
  onClose: () => void;
}) {
  const sinPub   = store.products.filter(p => p.syncStatus === 'sin_publicacion');
  const orphans  = store.orphanPubs ?? [];
  const [leftId,  setLeftId]  = useState<string | null>(null);
  const [rightId, setRightId] = useState<string | null>(null);
  const [done,    setDone]    = useState<string[]>([]);
  const [search,  setSearch]  = useState('');

  const filteredOrphans = orphans.filter(o =>
    !search || o.title.toLowerCase().includes(search.toLowerCase()) ||
    (o.sku ?? '').toLowerCase().includes(search.toLowerCase())
  );

  const canLink = !!leftId && !!rightId;

  function handleLink() {
    if (!leftId || !rightId) return;
    const product = sinPub.find(p => p.id === leftId);
    const pub     = orphans.find(o => o.mlItemId === rightId);
    if (!product || !pub) return;

    const params  = { ...DEFAULT_ML_PARAMS, ...store.globalParams, ...(product.params ?? {}) };
    const newCalc = calcProfitability(pub.price, product.cost, params);
    const newAlerts = generateAlerts(
      { ...product, mlPrice: pub.price, mlStatus: pub.status, mlStock: pub.stock },
      params
    );

    store.updateProduct(product.id, {
      mlItemId:          pub.mlItemId,
      mlTitle:           pub.title,
      mlPrice:           pub.price,
      mlStatus:          pub.status,
      mlStock:           pub.stock,
      mlSold:            pub.sold,
      mlVisits:          pub.visits,
      mlFreeShipping:    pub.freeShipping,
      mlHasInstallments: pub.hasInstallments,
      mlIsFull:          pub.isFull,
      mlListingType:     pub.listingType,
      mlPermalink:       pub.permalink,
      mlCondition:       pub.condition,
      mlThumbnail:       pub.thumbnail,
      syncStatus:        'match_dudoso',
      matchMethod:       'manual',
      matchConfidence:   100,
      calc:              newCalc ?? undefined,
      alerts:            newAlerts,
    });

    setDone(prev => [...prev, leftId]);
    setLeftId(null);
    setRightId(null);
  }

  const remaining = sinPub.filter(p => !done.includes(p.id));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 bg-[#07111F] rounded-t-2xl">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-[#FFE600] flex items-center justify-center shrink-0">
              <Layers className="w-4 h-4 text-gray-900" />
            </div>
            <div>
              <p className="text-[13px] font-bold text-white">Vincular publicaciones manualmente</p>
              <p className="text-[10px] text-white/50">Seleccioná un producto Odoo (izq.) y una publicación ML (der.) → Vincular</p>
            </div>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-lg hover:bg-white/10 flex items-center justify-center text-white/60 hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {remaining.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 p-8">
            <CheckCircle2 className="w-12 h-12 text-[#16A34A]" />
            <p className="text-[14px] font-bold text-gray-900">¡Todos vinculados!</p>
            <p className="text-[12px] text-gray-400">Los productos ahora aparecen como <strong>Match dudoso</strong> en la Tabla.</p>
            <button onClick={onClose} className="mt-2 px-4 py-2 bg-[#07111F] text-[#FFE600] rounded-xl text-[13px] font-bold">Cerrar</button>
          </div>
        ) : (
          <div className="flex flex-1 min-h-0">
            {/* LEFT — sin publicación */}
            <div className="w-[42%] border-r border-gray-100 flex flex-col">
              <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
                <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">Sin publicación en ML</p>
                <p className="text-[10px] text-gray-400">{remaining.length} productos</p>
              </div>
              <div className="flex-1 overflow-y-auto py-2">
                {remaining.map(p => (
                  <button
                    key={p.id}
                    onClick={() => setLeftId(prev => prev === p.id ? null : p.id)}
                    className={cn(
                      'w-full text-left px-4 py-3 flex items-start gap-2.5 transition-colors border-l-2',
                      leftId === p.id
                        ? 'bg-[#0784F2]/8 border-[#0784F2]'
                        : 'border-transparent hover:bg-gray-50',
                    )}
                  >
                    <div className={cn(
                      'w-4 h-4 rounded-full border-2 shrink-0 mt-0.5 transition-colors',
                      leftId === p.id ? 'border-[#0784F2] bg-[#0784F2]' : 'border-gray-300',
                    )} />
                    <div className="min-w-0">
                      <p className="text-[12px] font-semibold text-gray-900 leading-tight line-clamp-2">{p.name}</p>
                      {p.sku && <p className="text-[10px] text-gray-400 mt-0.5 font-mono">{p.sku}</p>}
                      {p.cost > 0 && <p className="text-[10px] text-[#16A34A] font-bold mt-0.5">{ars(p.cost)} costo</p>}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* RIGHT — orphan ML pubs */}
            <div className="flex-1 flex flex-col min-w-0">
              <div className="px-4 py-3 border-b border-gray-100 bg-gray-50 space-y-2">
                <p className="text-[11px] font-bold text-gray-500 uppercase tracking-wide">Publicaciones ML sin regla Odoo</p>
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                  <input
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Buscar..."
                    className="w-full pl-7 pr-3 py-1.5 text-[11px] border border-gray-200 rounded-lg focus:outline-none focus:border-[#0784F2]"
                  />
                </div>
              </div>
              <div className="flex-1 overflow-y-auto py-2">
                {filteredOrphans.length === 0 && (
                  <p className="text-[12px] text-gray-400 text-center py-8">Sin resultados</p>
                )}
                {filteredOrphans.map(o => (
                  <button
                    key={o.mlItemId}
                    onClick={() => setRightId(prev => prev === o.mlItemId ? null : o.mlItemId)}
                    className={cn(
                      'w-full text-left px-4 py-3 flex items-start gap-2.5 transition-colors border-l-2',
                      rightId === o.mlItemId
                        ? 'bg-[#FFE600]/10 border-[#FFE600]'
                        : 'border-transparent hover:bg-gray-50',
                    )}
                  >
                    <div className={cn(
                      'w-4 h-4 rounded-full border-2 shrink-0 mt-0.5 transition-colors',
                      rightId === o.mlItemId ? 'border-[#F59E0B] bg-[#F59E0B]' : 'border-gray-300',
                    )} />
                    <div className="min-w-0">
                      <p className="text-[12px] font-semibold text-gray-900 leading-tight line-clamp-2">{o.title}</p>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        <span className="text-[10px] font-mono text-gray-400">{o.mlItemId}</span>
                        {o.sku && <span className="text-[10px] font-mono text-gray-500">SKU: {o.sku}</span>}
                        <span className="text-[10px] font-bold text-[#07111F]">{ars(o.price)}</span>
                        <span className={cn('text-[9px] px-1.5 py-0.5 rounded-full font-bold',
                          o.status === 'active' ? 'bg-[#16A34A]/10 text-[#16A34A]' : 'bg-gray-100 text-gray-500'
                        )}>{o.status}</span>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        {remaining.length > 0 && (
          <div className="px-5 py-4 border-t border-gray-100 flex items-center justify-between bg-gray-50 rounded-b-2xl">
            <div className="text-[11px] text-gray-500">
              {leftId && rightId
                ? <span className="text-[#16A34A] font-semibold">✓ Listo para vincular</span>
                : leftId
                ? 'Ahora seleccioná la publicación ML →'
                : rightId
                ? '← Ahora seleccioná el producto Odoo'
                : 'Seleccioná un producto y una publicación'}
            </div>
            <div className="flex items-center gap-2">
              <button onClick={onClose} className="px-3 py-2 text-[12px] text-gray-500 hover:text-gray-700 rounded-lg hover:bg-gray-100 transition-colors">
                Cerrar
              </button>
              <button
                onClick={handleLink}
                disabled={!canLink}
                className={cn(
                  'px-4 py-2 rounded-xl text-[12px] font-bold flex items-center gap-1.5 transition-all',
                  canLink
                    ? 'bg-[#07111F] text-[#FFE600] hover:opacity-90'
                    : 'bg-gray-200 text-gray-400 cursor-not-allowed',
                )}
              >
                <Layers className="w-3.5 h-3.5" />
                Vincular seleccionados
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// IMPORT TAB
// ─────────────────────────────────────────────────────────────────────────────

const ML_ODOO_IDS_KEY = 'acqua_ml_template_ids';

function ImportTab({ store }: { store: ReturnType<typeof useMLLabStore> }) {
  const [odooRows,    setOdooRows]    = useState<unknown[][]>([]);
  const [mlRows,      setMlRows]      = useState<unknown[][]>([]);
  const [odooName,    setOdooName]    = useState('');
  const [mlName,      setMlName]      = useState('');
  const [processing,  setProcessing]  = useState(false);
  const [linkOpen,    setLinkOpen]    = useState(false);
  const [result,      setResult]      = useState<{
    odooTotal: number; withCost: number; withML: number; sinPublicacion: number; orphans: number;
  } | null>(null);

  const hasOdoo = odooRows.length > 1;
  const hasML   = mlRows.length > 1;
  // Odoo pricelist is REQUIRED; ML file is OPTIONAL enrichment
  const canRun  = hasOdoo;

  const runMatch = useCallback(() => {
    if (!canRun) return;
    setProcessing(true);
    try {
      const odooRules = parseOdooRows(odooRows);
      const mlPubs    = hasML ? parseMLRows(mlRows) : [];

      // Build products — Odoo pricelist is source of truth, orphan ML pubs excluded
      const products = matchAndBuild(odooRules, mlPubs, systemProducts, store.globalParams);

      // Save Odoo template IDs to localStorage → "En MercadoLibre" badge in Productos
      const templateIds = odooRules
        .map(r => r.productTemplateId)
        .filter((id): id is number => id !== undefined && id > 0);
      try { localStorage.setItem(ML_ODOO_IDS_KEY, JSON.stringify(templateIds)); } catch { /* quota */ }

      // Count orphan ML pubs (ML publications with no Odoo rule — info only)
      const orphanPubs = hasML ? getOrphanMLPubs(odooRules, mlPubs) : [];

      const withCost       = products.filter(p => p.cost > 0).length;
      const withML         = products.filter(p => !!p.mlItemId).length;
      const sinPublicacion = products.filter(p => p.syncStatus === 'sin_publicacion' || p.syncStatus === 'sin_costo').length;

      store.setProducts(products, { odooFileName: odooName, mlFileName: mlName, orphanPubs });
      setResult({ odooTotal: products.length, withCost, withML, sinPublicacion, orphans: orphanPubs.length });
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
            <p className="text-[13px] font-bold text-gray-900 mb-1">Espejo Maestro — Odoo como base</p>
            <p className="text-[12px] text-gray-600 leading-relaxed">
              La <strong>lista de precios Odoo</strong> es la fuente de verdad: define qué productos están en MercadoLibre y con qué markup. El archivo de <strong>ML Seller Center</strong> es opcional — solo enriquece con datos de publicación (precio real, stock ML, visitas, comisión).
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
        {hasOdoo && (() => {
          const info = inspectOdooHeaders(odooRows);
          const ok   = info.markupCol !== null || info.isPrintFormat;
          const formatLabel = info.isPrintFormat
            ? '📄 Formato reporte Odoo (% utilidad en texto)'
            : info.isPricelist ? '📊 Lista de precios Odoo (columnas raw)'
            : '📋 Formato genérico';
          return (
            <div className="mt-2 space-y-2">
              <div className={cn(
                'flex items-start gap-2 px-3 py-2.5 rounded-xl text-[11px] border',
                ok ? 'bg-[#16A34A]/10 border-[#16A34A]/20' : 'bg-[#EF4444]/10 border-[#EF4444]/20',
              )}>
                <span className="shrink-0 mt-0.5">{ok ? '✅' : '❌'}</span>
                <div>
                  <p className={cn('font-bold', ok ? 'text-[#16A34A]' : 'text-[#EF4444]')}>
                    {info.rowCount} reglas detectadas — {formatLabel}
                  </p>
                  {ok && (
                    <p className="text-gray-500 mt-0.5">
                      Markup: <strong className="text-gray-700">{info.markupCol}</strong>
                    </p>
                  )}
                </div>
              </div>
              {!info.isPrintFormat && (
                <details className="bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-[10px] text-gray-500 cursor-pointer">
                  <summary className="font-semibold text-gray-600 select-none">Ver todas las columnas ({info.allHeaders.length})</summary>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {info.allHeaders.map((h, i) => (
                      <span key={i} className={cn(
                        'px-1.5 py-0.5 rounded text-[9px] font-mono border',
                        h === info.markupCol ? 'bg-[#16A34A] text-white border-transparent font-bold' :
                        h === info.nameCol   ? 'bg-[#0784F2] text-white border-transparent' :
                        'bg-white border-gray-200 text-gray-500',
                      )}>
                        {h || '(vacío)'}
                      </span>
                    ))}
                  </div>
                </details>
              )}
              {!ok && (
                <div className="bg-[#FEF2F2] border border-[#EF4444]/20 rounded-xl p-3 text-[11px] text-[#991B1B] space-y-1">
                  <p className="font-bold">⚠️ No se encontró el formato correcto</p>
                  <p>Exportá desde Odoo → Lista de precios ML → Imprimir, o usá el botón Export desde la vista lista.</p>
                </div>
              )}
            </div>
          );
        })()}
      </div>

      {/* Step 2 — OPTIONAL */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <span className="w-6 h-6 rounded-full bg-[#0784F2] text-white text-[11px] font-black flex items-center justify-center shrink-0">2</span>
          <div className="flex items-center gap-2">
            <p className="text-[13px] font-bold text-gray-900">Publicaciones activas de MercadoLibre</p>
            <span className="px-2 py-0.5 rounded-full bg-[#0784F2]/10 text-[#0784F2] text-[10px] font-bold uppercase tracking-wide">Opcional</span>
          </div>
        </div>
        <DropZone
          label="Exportar desde ML Seller Center (opcional)"
          hint="Enriquece con ID de publicación, precio real, stock ML, visitas y comisión"
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
      {!hasOdoo && (
        <p className="text-[11px] text-center text-gray-400">
          ↑ Requerido: subí el archivo de <strong>lista de precios Odoo</strong> para continuar
        </p>
      )}
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
        {processing
          ? <><RefreshCw className="w-5 h-5 animate-spin" /> Generando espejo…</>
          : <><Zap className="w-5 h-5" /> {hasML ? 'Procesar Odoo + ML' : 'Procesar Lista Odoo'}</>}
      </button>

      {/* Result */}
      {result && (
        <div className="bg-[#16A34A]/10 border border-[#16A34A]/20 rounded-2xl p-5 space-y-4">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-[#16A34A]" />
            <p className="text-[14px] font-bold text-[#16A34A]">Espejo maestro generado</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="text-center bg-white rounded-xl p-3">
              <div className="text-2xl font-black text-gray-900">{result.odooTotal}</div>
              <div className="text-[10px] text-gray-500 uppercase tracking-wide">En lista Odoo</div>
            </div>
            <div className="text-center bg-white rounded-xl p-3">
              <div className="text-2xl font-black text-[#16A34A]">{result.withCost}</div>
              <div className="text-[10px] text-gray-500 uppercase tracking-wide">Con costo</div>
            </div>
            <div className="text-center bg-white rounded-xl p-3">
              <div className="text-2xl font-black text-[#0784F2]">{result.withML}</div>
              <div className="text-[10px] text-gray-500 uppercase tracking-wide">Vinculados ML</div>
            </div>
            {/* Sin publicación — clickable when orphan pubs exist */}
            <button
              onClick={() => result.sinPublicacion > 0 && result.orphans > 0 ? setLinkOpen(true) : undefined}
              disabled={result.sinPublicacion === 0 || result.orphans === 0}
              className={cn(
                'text-center bg-white rounded-xl p-3 transition-all',
                result.sinPublicacion > 0 && result.orphans > 0
                  ? 'hover:ring-2 hover:ring-[#F97316]/40 cursor-pointer group'
                  : 'cursor-default',
              )}
            >
              <div className="text-2xl font-black text-[#F97316]">{result.sinPublicacion}</div>
              <div className="text-[10px] text-gray-500 uppercase tracking-wide">Sin publicación</div>
              {result.sinPublicacion > 0 && result.orphans > 0 && (
                <div className="mt-1 flex items-center justify-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Layers className="w-3 h-3 text-[#F97316]" />
                  <span className="text-[9px] font-bold text-[#F97316]">Vincular</span>
                </div>
              )}
            </button>
          </div>
          {result.orphans > 0 && (
            <div
              className="flex items-center gap-2 px-3 py-2.5 bg-[#714B67]/10 rounded-xl cursor-pointer hover:bg-[#714B67]/15 transition-colors group"
              onClick={() => setLinkOpen(true)}
            >
              <Info className="w-3.5 h-3.5 text-[#714B67] shrink-0" />
              <p className="text-[11px] text-[#714B67] flex-1">
                <strong>{result.orphans}</strong> publicaciones en ML sin regla Odoo — no se importan.{' '}
                {result.sinPublicacion > 0 && (
                  <span className="underline font-bold group-hover:text-[#714B67]">Vincular manualmente →</span>
                )}
              </p>
              {result.sinPublicacion > 0 && <Layers className="w-3.5 h-3.5 text-[#714B67] shrink-0" />}
            </div>
          )}
          <p className="text-[11px] text-[#16A34A] text-center">
            Andá a la pestaña <strong>Tabla</strong> para ver todos los productos.
          </p>
        </div>
      )}

      {linkOpen && <ManualLinkModal store={store} onClose={() => setLinkOpen(false)} />}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ML PRODUCT CARD — styled like a MercadoLibre listing card
// ─────────────────────────────────────────────────────────────────────────────

function MLProductCard({
  p,
  isSelected,
  onSelect,
  onThumbFetched,
}: {
  p: MLLabProduct;
  isSelected: boolean;
  onSelect: () => void;
  onThumbFetched?: (id: string, url: string) => void;
}) {
  const [thumb, setThumb] = useState<string | null>(p.mlThumbnail ?? p.image ?? null);

  // Fetch thumbnail from ML public API when none available
  useEffect(() => {
    if (thumb || !p.mlItemId) return;
    let cancelled = false;
    fetch(`https://api.mercadolibre.com/items/${p.mlItemId}?attributes=thumbnail`)
      .then(r => r.ok ? r.json() : null)
      .then((d: { thumbnail?: string } | null) => {
        if (!cancelled && d?.thumbnail) {
          setThumb(d.thumbnail);
          onThumbFetched?.(p.id, d.thumbnail);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [p.mlItemId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep thumb in sync if product updates externally
  useEffect(() => {
    if (p.mlThumbnail && p.mlThumbnail !== thumb) setThumb(p.mlThumbnail);
  }, [p.mlThumbnail]); // eslint-disable-line react-hooks/exhaustive-deps

  const margin = p.calc?.netMargin;
  const price  = p.mlPrice || p.odooListML || 0;
  const marginColor =
    p.calc?.status === 'pierde'      ? 'bg-[#EF4444] text-white' :
    p.calc?.status === 'bajo_margen' ? 'bg-[#F97316] text-white' :
    p.calc?.status === 'rentable'    ? 'bg-[#00A650] text-white' :
    'bg-gray-100 text-gray-500';
  const borderColor =
    isSelected
      ? p.calc?.status === 'pierde'      ? 'border-[#EF4444]' :
        p.calc?.status === 'bajo_margen' ? 'border-[#F97316]' :
        p.calc?.status === 'rentable'    ? 'border-[#00A650]' :
        'border-[#3483FA]'
      : 'border-transparent';

  return (
    <button
      onClick={onSelect}
      className={cn(
        'w-full text-left flex gap-3 px-3 py-2.5 rounded-xl border transition-all',
        isSelected
          ? 'bg-white shadow-sm ' + borderColor
          : 'border-transparent hover:bg-white hover:shadow-sm',
      )}
    >
      {/* Thumbnail — ML style (square, light bg) */}
      <div className="w-[52px] h-[52px] shrink-0 rounded-lg overflow-hidden bg-[#EBEBEB] flex items-center justify-center">
        {thumb ? (
          <img
            src={thumb}
            alt={p.name}
            className="w-full h-full object-contain"
            onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
        ) : (
          <Package className="w-6 h-6 text-[#C8C8C8]" />
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        {/* Title — ML uses gray-800, 2 lines max */}
        <p className="text-[12px] text-[#333333] leading-snug line-clamp-2 font-normal">
          {p.name}
        </p>

        {/* Price — ML blue, bold */}
        {price > 0 && (
          <p className="text-[15px] font-semibold text-[#3483FA] mt-0.5 leading-none">
            {ars(price)}
          </p>
        )}

        {/* Condition chips */}
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          {p.mlFreeShipping && (
            <span className="text-[10px] font-semibold text-[#00A650]">Envío gratis</span>
          )}
          {p.mlHasInstallments && (
            <span className="text-[10px] text-gray-500">en cuotas</span>
          )}
          {p.mlSold !== undefined && p.mlSold > 0 && (
            <span className="text-[10px] text-gray-400">{p.mlSold} vendidos</span>
          )}
        </div>
      </div>

      {/* Margin badge — internal data */}
      {margin != null && isFinite(margin) && (
        <div className="shrink-0 flex flex-col items-end justify-start pt-0.5">
          <span className={cn('text-[10px] font-black px-2 py-0.5 rounded-full', marginColor)}>
            {margin.toFixed(0)}%
          </span>
        </div>
      )}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DASHBOARD TAB — Centro de Comandos split-pane
// ─────────────────────────────────────────────────────────────────────────────

type DashFilter = 'todos' | 'pierde' | 'bajo_margen' | 'rentable' | 'sin_datos';

function DashboardTab({
  store,
  onGoToImport,
  geminiKey,
}: {
  store: ReturnType<typeof useMLLabStore>;
  onGoToImport: () => void;
  geminiKey?: string;
}) {
  const { stats, products, globalParams } = store;
  const [selectedId,  setSelectedId]  = useState<string | null>(null);
  const [filter,      setFilter]      = useState<DashFilter>('todos');
  const [search,      setSearch]      = useState('');
  const [showSidebar, setShowSidebar] = useState(true);

  const selectedProduct = useMemo(
    () => products.find(p => p.id === selectedId) ?? null,
    [products, selectedId],
  );

  // ── Groups ─────────────────────────────────────────────────────────────────
  const grouped = useMemo(() => {
    const q = search.toLowerCase();
    const base = q
      ? products.filter(p =>
          p.name.toLowerCase().includes(q) ||
          (p.sku ?? '').toLowerCase().includes(q) ||
          (p.mlItemId ?? '').toLowerCase().includes(q),
        )
      : products;

    const pierde     = base.filter(p => p.calc?.status === 'pierde');
    const bajoMargen = base.filter(p => p.calc?.status === 'bajo_margen');
    const sinDatos   = base.filter(p => !p.calc && p.syncStatus !== 'sincronizado');
    const rentable   = base.filter(p => p.calc?.status === 'rentable');

    if (filter === 'pierde')      return { pierde, bajoMargen: [], sinDatos: [], rentable: [] };
    if (filter === 'bajo_margen') return { pierde: [], bajoMargen, sinDatos: [], rentable: [] };
    if (filter === 'sin_datos')   return { pierde: [], bajoMargen: [], sinDatos, rentable: [] };
    if (filter === 'rentable')    return { pierde: [], bajoMargen: [], sinDatos: [], rentable };
    return { pierde, bajoMargen, sinDatos, rentable };
  }, [products, filter, search]);

  if (products.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 px-8 text-center">
        <div className="w-20 h-20 rounded-3xl bg-[#FFE600]/20 flex items-center justify-center mb-6">
          <ShoppingCart className="w-10 h-10 text-gray-600" />
        </div>
        <h2 className="text-2xl font-bold text-gray-900 mb-3">Espejo maestro vacío</h2>
        <p className="text-gray-500 text-[14px] max-w-md leading-relaxed mb-6">
          Importá la regla de precio Odoo y las publicaciones de ML para generar el espejo.
        </p>
        <button
          onClick={onGoToImport}
          className="flex items-center gap-2 px-6 py-3 bg-[#07111F] text-[#FFE600] rounded-xl font-bold text-[13px] hover:opacity-90"
        >
          <Upload className="w-4 h-4" /> Importar archivos
        </button>
      </div>
    );
  }

  const totalWithCalc = stats.rentables + stats.bajoMargen + stats.pierde;
  const rentPct  = totalWithCalc > 0 ? Math.round(stats.rentables  / totalWithCalc * 100) : 0;
  const bajoPct  = totalWithCalc > 0 ? Math.round(stats.bajoMargen / totalWithCalc * 100) : 0;
  const pierdePct= totalWithCalc > 0 ? Math.round(stats.pierde     / totalWithCalc * 100) : 0;

  const Section = ({ title, color, items }: { title: string; color: string; items: MLLabProduct[] }) => {
    if (items.length === 0) return null;
    return (
      <div className="mb-2">
        <p className={cn('text-[10px] font-black uppercase tracking-widest px-3 py-1.5 sticky top-0 bg-white z-10 border-b border-gray-100', color)}>
          {title} · {items.length}
        </p>
        <div className="space-y-0.5 px-2 py-1">
          {items.map(p => (
            <MLProductCard
              key={p.id}
              p={p}
              isSelected={p.id === selectedId}
              onSelect={() => setSelectedId(prev => prev === p.id ? null : p.id)}
              onThumbFetched={(id, url) => store.updateProduct(id, { mlThumbnail: url })}
            />
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="flex h-full overflow-hidden">

      {/* ── LEFT: product list ── ML white sidebar ───────────────────────────── */}
      <div className={cn(
        'shrink-0 flex flex-col border-r border-gray-200 bg-white overflow-hidden transition-all duration-200',
        showSidebar ? 'w-[280px] lg:w-[320px] xl:w-[360px]' : 'w-0 border-r-0',
      )}>

        {/* Search + filter chips */}
        <div className="p-3 space-y-2 border-b border-gray-200 bg-white shrink-0 min-w-0">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar producto, SKU…"
              className="w-full pl-8 pr-3 py-1.5 bg-gray-100 rounded-lg text-[12px] outline-none focus:ring-2 focus:ring-[#FFE600]/50"
            />
          </div>
          <div className="flex flex-wrap gap-1">
            {([
              { key: 'todos',      label: `Todo (${products.length})`,   cls: 'bg-gray-900 text-white' },
              { key: 'pierde',     label: `🔴 ${stats.pierde}`,          cls: 'bg-[#EF4444] text-white' },
              { key: 'bajo_margen',label: `🟡 ${stats.bajoMargen}`,      cls: 'bg-[#F97316] text-white' },
              { key: 'rentable',   label: `🟢 ${stats.rentables}`,       cls: 'bg-[#16A34A] text-white' },
              { key: 'sin_datos',  label: `⚪ Sin datos`,                 cls: 'bg-gray-500 text-white' },
            ] as { key: DashFilter; label: string; cls: string }[]).map(f => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={cn(
                  'px-2.5 py-1 rounded-full text-[10px] font-bold transition-all',
                  filter === f.key ? f.cls : 'bg-gray-100 text-gray-500 hover:bg-gray-200',
                )}
              >{f.label}</button>
            ))}
          </div>
        </div>

        {/* Product list */}
        <div className="flex-1 overflow-y-auto">
          <Section title="🔴 Perdiendo dinero" color="text-[#EF4444]" items={grouped.pierde} />
          <Section title="🟡 Bajo margen"      color="text-[#F97316]" items={grouped.bajoMargen} />
          <Section title="⚪ Sin datos / regla" color="text-gray-400"  items={grouped.sinDatos} />
          <Section title="🟢 Rentables"         color="text-[#16A34A]" items={grouped.rentable} />
        </div>
      </div>

      {/* ── RIGHT: overview or product detail ──────────────────────────────── */}
      <div className="flex-1 min-w-0 flex flex-col overflow-hidden">

        {/* Toggle sidebar btn */}
        <button
          onClick={() => setShowSidebar(v => !v)}
          className="absolute z-20 m-2 p-1.5 bg-white border border-gray-200 rounded-lg shadow-sm text-gray-500 hover:text-gray-800 transition-colors"
          title={showSidebar ? 'Ocultar lista' : 'Mostrar lista'}
        >
          <List className="w-3.5 h-3.5" />
        </button>

        {selectedProduct ? (
          /* ── PRODUCT FICHA ── */
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <ProductFicha
              product={selectedProduct}
              store={store}
              onClose={() => setSelectedId(null)}
              geminiKey={geminiKey ?? ''}
            />
          </div>
        ) : (() => {
          /* ── SOCIO ACTIVO — Daily briefing ── */

          // --- Data calculations ---
          const now        = new Date();
          const hour       = now.getHours();
          const dayNames   = ['domingo','lunes','martes','miércoles','jueves','viernes','sábado'];
          const monthNames = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
          const greeting   = hour < 12 ? '¡Buenos días!' : hour < 18 ? '¡Buenas tardes!' : '¡Buenas noches!';
          const greetEmoji = hour < 12 ? '🌅' : hour < 18 ? '☀️' : '🌙';
          const dateStr    = `${dayNames[now.getDay()]}, ${now.getDate()} de ${monthNames[now.getMonth()]}`;

          const daysSince = store.lastImportAt
            ? Math.floor((Date.now() - new Date(store.lastImportAt).getTime()) / (1000 * 60 * 60 * 24))
            : null;

          // Inventory issues (from system products)
          const sinCostoInv  = systemProducts.filter(p => (p as {active?:boolean}).active !== false && (!p.cost || p.cost === 0)).length;
          const sinFotoInv   = systemProducts.filter(p => (p as {active?:boolean}).active !== false && !p.image).length;

          // ML issues
          const pierden       = products.filter(p => p.calc?.status === 'pierde');
          const sinPublicar   = products.filter(p => p.syncStatus === 'sin_publicacion');
          const matchDudoso   = products.filter(p => p.syncStatus === 'match_dudoso');

          // Build prioritized action list
          type ActionItem = {
            priority: 'urgente' | 'importante' | 'mejora';
            emoji: string;
            title: string;
            sub: string;
            cta: string;
            action?: () => void;
            href?: string;
            previews?: string[];
          };
          const items: ActionItem[] = [];

          if (daysSince !== null && daysSince >= 3) {
            items.push({
              priority: daysSince >= 5 ? 'urgente' : 'importante',
              emoji: '🔄',
              title: daysSince === 0 ? 'Datos actualizados hoy' : daysSince === 1 ? 'Última actualización: ayer' : `Hace ${daysSince} días sin actualizar ML`,
              sub: 'Los precios de ML y del mercado pueden haber cambiado. Subí los archivos de Odoo y Seller Center.',
              cta: 'Actualizar ahora',
              action: onGoToImport,
            });
          }

          if (pierden.length > 0) {
            items.push({
              priority: 'urgente',
              emoji: '🔴',
              title: `${pierden.length} producto${pierden.length > 1 ? 's' : ''} perdiendo plata`,
              sub: 'Cada venta de estos productos genera una pérdida. Hay que ajustar el precio o el markup urgente.',
              cta: 'Ver y corregir',
              action: () => setFilter('pierde'),
              previews: pierden.slice(0, 3).map(p =>
                `${p.name.split(' ').slice(0, 4).join(' ')} — ${p.calc?.netMargin?.toFixed(1)}% margen`
              ),
            });
          }

          if (sinCostoInv > 0) {
            items.push({
              priority: 'importante',
              emoji: '💰',
              title: `${sinCostoInv} productos sin costo en inventario`,
              sub: 'Sin costo no puedo calcular rentabilidad ni darte recomendaciones de precio. Completá el costo en Odoo.',
              cta: 'Ir a inventario',
              href: '/productos?filter=noCost',
            });
          }

          if (sinPublicar.length > 0) {
            items.push({
              priority: 'importante',
              emoji: '📋',
              title: `${sinPublicar.length} producto${sinPublicar.length > 1 ? 's' : ''} sin publicación en ML`,
              sub: 'Tienen regla de precio en Odoo pero no están publicados. Podrías estar perdiendo ventas.',
              cta: 'Ver productos',
              action: () => setFilter('sin_datos'),
            });
          }

          if (sinFotoInv > 0) {
            items.push({
              priority: 'mejora',
              emoji: '📷',
              title: `${sinFotoInv} productos sin foto`,
              sub: 'Las fotos aumentan la conversión en ML. Agregá imágenes desde Odoo o directamente en la publicación.',
              cta: 'Completar fotos',
              href: '/productos',
            });
          }

          if (matchDudoso.length > 0) {
            items.push({
              priority: 'mejora',
              emoji: '🔗',
              title: `${matchDudoso.length} matches dudosos`,
              sub: 'Estos productos no matchearon con certeza entre Odoo y ML. Revisá que el SKU coincida.',
              cta: 'Revisar',
              action: () => setFilter('sin_datos'),
            });
          }

          const pColor = {
            urgente:   { card: 'bg-[#FEF2F2] border-[#EF4444]/25',   dot: 'bg-[#EF4444]',   label: 'Urgente',    labelCls: 'bg-[#EF4444] text-white',   btn: 'bg-[#EF4444] text-white hover:bg-red-600' },
            importante:{ card: 'bg-[#FFFBEB] border-[#F97316]/25',   dot: 'bg-[#F97316]',   label: 'Importante', labelCls: 'bg-[#F97316] text-white',   btn: 'bg-[#07111F] text-white hover:opacity-80' },
            mejora:    { card: 'bg-white border-gray-200',            dot: 'bg-[#0784F2]',   label: 'Mejora',     labelCls: 'bg-gray-100 text-gray-500', btn: 'bg-[#07111F] text-white hover:opacity-80' },
          };

          return (
            <div className="flex-1 overflow-y-auto min-h-0">

              {/* ─── GREETING HEADER ─── */}
              <div className="bg-[#07111F] px-6 pt-5 pb-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="text-[#FFE600] text-[10px] font-bold uppercase tracking-[0.15em] mb-1">Acqua Control · Socio activo</p>
                    <h2 className="text-white text-xl font-black">{greeting}</h2>
                    <p className="text-white/50 text-[12px] mt-0.5 capitalize">{dateStr}</p>
                  </div>
                  <div className="text-4xl shrink-0 select-none">{greetEmoji}</div>
                </div>

                {/* Last import strip */}
                <div className={cn(
                  'mt-4 px-4 py-3 rounded-xl border flex items-center justify-between gap-3',
                  daysSince === null        ? 'bg-white/5 border-white/10' :
                  daysSince >= 5            ? 'bg-[#EF4444]/20 border-[#EF4444]/30' :
                  daysSince >= 3            ? 'bg-[#F97316]/20 border-[#F97316]/30' :
                  'bg-[#16A34A]/20 border-[#16A34A]/30',
                )}>
                  <div>
                    <p className={cn(
                      'text-[12px] font-black',
                      daysSince === null ? 'text-white/60' :
                      daysSince >= 3    ? 'text-[#FFE600]' : 'text-white',
                    )}>
                      {daysSince === null    ? 'Sin datos importados todavía' :
                       daysSince === 0       ? '✓ Datos actualizados hoy' :
                       daysSince === 1       ? '⏰ Última actualización: ayer' :
                       `⏰ Hace ${daysSince} días sin actualizar`}
                    </p>
                    {(daysSince ?? 0) >= 3 && (
                      <p className="text-white/45 text-[10px] mt-0.5">Los precios de ML pueden haber cambiado</p>
                    )}
                  </div>
                  {(daysSince === null || (daysSince ?? 0) >= 2) && (
                    <button
                      onClick={onGoToImport}
                      className="shrink-0 px-3 py-1.5 bg-[#FFE600] text-[#07111F] text-[11px] font-black rounded-lg hover:opacity-90 transition-opacity whitespace-nowrap"
                    >
                      {daysSince === null ? 'Importar datos' : 'Actualizar →'}
                    </button>
                  )}
                </div>
              </div>

              {/* ─── CATALOG HEALTH — compact strip ─── */}
              <div className="px-5 pt-4 pb-1">
                <div className="flex items-center gap-3 bg-white rounded-2xl border border-gray-100 px-4 py-3 shadow-sm">
                  <div className="flex-1 min-w-0">
                    <div className="flex h-2.5 rounded-full overflow-hidden gap-px">
                      {rentPct  > 0 && <div style={{ width: `${rentPct}%`    }} className="bg-[#16A34A]" />}
                      {bajoPct  > 0 && <div style={{ width: `${bajoPct}%`    }} className="bg-[#F97316]" />}
                      {pierdePct> 0 && <div style={{ width: `${pierdePct}%`  }} className="bg-[#EF4444]" />}
                      <div className="flex-1 bg-gray-200" />
                    </div>
                    <div className="flex items-center gap-3 mt-1.5 text-[10px] text-gray-500 flex-wrap">
                      <span className="flex items-center gap-1 font-semibold text-[#16A34A]"><span className="w-2 h-2 rounded-full bg-[#16A34A]"/>{stats.rentables} ok</span>
                      <span className="flex items-center gap-1 font-semibold text-[#F97316]"><span className="w-2 h-2 rounded-full bg-[#F97316]"/>{stats.bajoMargen} bajo</span>
                      <span className="flex items-center gap-1 font-semibold text-[#EF4444]"><span className="w-2 h-2 rounded-full bg-[#EF4444]"/>{stats.pierde} pierden</span>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-[20px] font-black text-gray-900">{stats.activas}</p>
                    <p className="text-[9px] text-gray-400 uppercase tracking-wide">activas ML</p>
                  </div>
                </div>
              </div>

              {/* ─── TODO LIST ─── */}
              <div className="px-5 py-4 space-y-3">
                <div className="flex items-center gap-2">
                  <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Para hoy</p>
                  {items.filter(i => i.priority === 'urgente').length > 0 && (
                    <span className="px-2 py-0.5 bg-[#EF4444] text-white text-[9px] font-black rounded-full">
                      {items.filter(i => i.priority === 'urgente').length} urgente{items.filter(i => i.priority === 'urgente').length > 1 ? 's' : ''}
                    </span>
                  )}
                </div>

                {items.length === 0 && (
                  <div className="text-center py-10">
                    <div className="text-5xl mb-4">🎯</div>
                    <p className="text-[16px] font-black text-gray-900">¡Todo en orden!</p>
                    <p className="text-[12px] text-gray-400 mt-1.5 max-w-xs mx-auto">
                      No hay tareas urgentes hoy. Revisá oportunidades de mejora en las publicaciones.
                    </p>
                  </div>
                )}

                {items.map((item, i) => {
                  const c = pColor[item.priority];
                  return (
                    <div key={i} className={cn('rounded-2xl border p-4 transition-all', c.card)}>
                      <div className="flex items-start gap-3">
                        <span className="text-2xl shrink-0 leading-none mt-0.5">{item.emoji}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-0.5">
                            <p className="text-[13px] font-black text-gray-900">{item.title}</p>
                            <span className={cn('text-[8px] font-black px-1.5 py-0.5 rounded-full uppercase tracking-wide', c.labelCls)}>
                              {c.label}
                            </span>
                          </div>
                          <p className="text-[11px] text-gray-500 leading-snug">{item.sub}</p>
                          {item.previews && item.previews.length > 0 && (
                            <div className="mt-2 space-y-0.5">
                              {item.previews.map((prev, j) => (
                                <p key={j} className="text-[10px] text-gray-600 flex items-center gap-1.5">
                                  <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', c.dot)} />
                                  {prev}
                                </p>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="mt-3 flex justify-end">
                        {item.action ? (
                          <button
                            onClick={item.action}
                            className={cn('px-4 py-2 text-[11px] font-black rounded-xl transition-colors', c.btn)}
                          >
                            {item.cta} →
                          </button>
                        ) : item.href ? (
                          <Link
                            href={item.href}
                            className={cn('inline-block px-4 py-2 text-[11px] font-black rounded-xl transition-colors', c.btn)}
                          >
                            {item.cta} →
                          </Link>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* ─── QUICK STATS GRID ─── */}
              <div className="px-5 pb-6 grid grid-cols-2 gap-2">
                {[
                  { label: '🔴 Pierden plata', val: stats.pierde,      f: 'pierde'      as DashFilter, col: stats.pierde > 0      ? 'text-[#EF4444]' : 'text-gray-400' },
                  { label: '🟡 Bajo margen',   val: stats.bajoMargen,  f: 'bajo_margen' as DashFilter, col: stats.bajoMargen > 0  ? 'text-[#F97316]' : 'text-gray-400' },
                  { label: '🟢 Rentables',     val: stats.rentables,   f: 'rentable'    as DashFilter, col: 'text-[#16A34A]' },
                  { label: '⚪ Sin costo',     val: stats.sinCosto, f: 'sin_datos' as DashFilter, col: 'text-gray-400' },
                ].map(c => (
                  <button
                    key={c.label}
                    onClick={() => setFilter(c.f)}
                    className="bg-white border border-gray-100 rounded-xl px-3 py-3 text-left hover:border-gray-300 hover:shadow-sm transition-all"
                  >
                    <div className={cn('text-2xl font-black', c.col)}>{c.val}</div>
                    <div className="text-[10px] text-gray-500 mt-0.5">{c.label}</div>
                  </button>
                ))}
              </div>

            </div>
          );
        })()}
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
  initialProfitFilter,
}: {
  store: ReturnType<typeof useMLLabStore>;
  onSelectProduct: (id: string) => void;
  selectedId: string | null;
  initialProfitFilter?: string;
}) {
  const [search,       setSearch]       = useState('');
  const [syncFilter,   setSyncFilter]   = useState<MLSyncStatus | 'todos'>('todos');
  const [profitFilter, setProfitFilter] = useState<string>(initialProfitFilter ?? 'todos');
  const [linkOpen,     setLinkOpen]     = useState(false);

  // Sync if parent pushes a new filter (e.g., user clicks stat in header)
  useEffect(() => {
    if (initialProfitFilter) setProfitFilter(initialProfitFilter);
  }, [initialProfitFilter]);
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
                    {/* Pending Odoo update badge */}
                    {p.pendingOdooUpdate && (
                      <span className="absolute top-2 left-2 px-1.5 py-0.5 bg-[#FFE600] rounded text-[8px] font-black text-gray-900 leading-none">
                        ⚡ Odoo
                      </span>
                    )}
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
                    <div className="flex items-center gap-1.5">
                      <p className={cn('text-[12px] font-semibold line-clamp-1', isSelected ? 'text-[#07111F]' : 'text-gray-900')}>{p.name}</p>
                      {p.pendingOdooUpdate && (
                        <span className="shrink-0 px-1.5 py-0.5 bg-[#FFE600] rounded text-[8px] font-black text-gray-900 leading-none whitespace-nowrap">⚡ Odoo</span>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {p.sku && <span className="text-[9px] font-mono text-gray-400">{p.sku}</span>}
                      {p.mlItemId && <span className="text-[9px] font-mono text-[#0784F2]">{p.mlItemId}</span>}
                    </div>
                  </td>

                  {/* Sync */}
                  <td className="px-3 py-2.5 text-center">
                    <div className="flex flex-col items-center gap-1">
                      <SyncBadge status={p.syncStatus} />
                      {p.syncStatus === 'sin_publicacion' && (store.orphanPubs?.length ?? 0) > 0 && (
                        <button
                          onClick={e => { e.stopPropagation(); setLinkOpen(true); }}
                          className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[8px] font-bold text-[#714B67] bg-[#714B67]/10 hover:bg-[#714B67]/20 transition-colors whitespace-nowrap"
                        >
                          <Layers className="w-2.5 h-2.5" /> Vincular
                        </button>
                      )}
                    </div>
                  </td>

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

      {linkOpen && <ManualLinkModal store={store} onClose={() => setLinkOpen(false)} />}
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
  // Inline cost/markup editing
  const [editingCost,   setEditingCost]   = useState(false);
  const [editCostVal,   setEditCostVal]   = useState('');
  const [editMarkupVal, setEditMarkupVal] = useState('');

  const saveManualEdit = () => {
    const newCost   = parseFloat(editCostVal.replace(/[^0-9.]/g, ''));
    const newMarkup = parseFloat(editMarkupVal.replace(/[^0-9.]/g, ''));
    if (isNaN(newCost) || newCost <= 0) { setEditingCost(false); return; }
    const markup    = isNaN(newMarkup) ? product.markup : newMarkup;
    const odooPrice = newCost * (1 + markup / 100);
    const odooListML = odooPrice * 1.21;
    store.updateProduct(product.id, { cost: newCost, markup, odooPrice, odooListML });
    setEditingCost(false);
  };

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
      if (!res.ok || !res.body) {
        const errData = await res.json().catch(() => null) as { error?: string } | null;
        const msg = errData?.error ?? `Error ${res.status} al generar. Revisá la API key en Parámetros globales.`;
        setDescText(msg);
        return;
      }
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

  // Initialize chat + auto-scout when opening Consultor tab
  useEffect(() => {
    if (fichaTab === 'consultor') {
      if (!chatInitialized.current) {
        chatInitialized.current = true;
        setChatMessages([{ role: 'assistant', content: buildInitialMessage() }]);
      }
      // Auto-run scout if no data yet
      if (scout.items.length === 0 && !scouting) {
        void runScout();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fichaTab]);

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
          {editingCost ? (
            <div className="bg-white rounded-xl border border-[#0784F2]/30 p-3 space-y-2">
              <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wide">Editar manualmente</p>
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="text-[9px] text-gray-400">Costo</label>
                  <input
                    type="number" value={editCostVal} onChange={e => setEditCostVal(e.target.value)}
                    placeholder={String(product.cost)}
                    className="w-full mt-0.5 px-2 py-1 text-[12px] font-bold border border-gray-200 rounded-lg focus:outline-none focus:border-[#0784F2]"
                  />
                </div>
                <div className="flex-1">
                  <label className="text-[9px] text-gray-400">Markup %</label>
                  <input
                    type="number" value={editMarkupVal} onChange={e => setEditMarkupVal(e.target.value)}
                    placeholder={product.markup.toFixed(1)}
                    className="w-full mt-0.5 px-2 py-1 text-[12px] font-bold border border-gray-200 rounded-lg focus:outline-none focus:border-[#0784F2]"
                  />
                </div>
              </div>
              <div className="flex gap-1.5">
                <button onClick={saveManualEdit} className="flex-1 py-1.5 bg-[#07111F] text-white text-[10px] font-bold rounded-lg">Guardar</button>
                <button onClick={() => setEditingCost(false)} className="py-1.5 px-3 bg-gray-100 text-gray-600 text-[10px] font-bold rounded-lg">Cancelar</button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-1.5 group/grid">
              <button
                onClick={() => { setEditCostVal(String(product.cost)); setEditMarkupVal(product.markup.toFixed(1)); setEditingCost(true); }}
                className="bg-white rounded-xl px-2 py-2 text-center border border-gray-100 hover:border-[#0784F2]/40 transition-colors"
                title="Editar costo/markup"
              >
                <div className="text-[9px] text-gray-400 font-semibold uppercase tracking-wide leading-tight mb-1">Costo</div>
                <div className="text-[12px] font-black text-gray-900">{product.cost > 0 ? ars(product.cost) : '—'}</div>
              </button>
              <div className="bg-[#FFE600]/10 rounded-xl px-2 py-2 text-center border border-[#FFE600]/20">
                <div className="text-[9px] text-gray-400 font-semibold uppercase tracking-wide leading-tight mb-1">ML</div>
                <div className="text-[12px] font-black text-gray-900">{product.mlPrice ? ars(product.mlPrice) : '—'}</div>
              </div>
              <div className="bg-[#16A34A]/5 rounded-xl px-2 py-2 text-center border border-[#16A34A]/15">
                <div className="text-[9px] text-gray-400 font-semibold uppercase tracking-wide leading-tight mb-1">Ideal</div>
                <div className="text-[12px] font-black text-[#16A34A]">{idealPrice > 0 ? ars(idealPrice) : '—'}</div>
              </div>
            </div>
          )}

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
                    <div className={cn(
                      'rounded-2xl p-4',
                      product.pendingOdooUpdate
                        ? 'bg-[#FFE600]/10 border-2 border-[#FFE600]/50'
                        : 'bg-[#714B67]/5 border border-[#714B67]/15',
                    )}>
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-[10px] font-bold text-[#714B67] uppercase tracking-wide">Para Odoo</p>
                        {product.pendingOdooUpdate && (
                          <span className="flex items-center gap-1 px-2 py-0.5 bg-[#FFE600] rounded-full text-[9px] font-black text-gray-900 uppercase tracking-wide">
                            ⚡ Pendiente actualizar en Odoo
                          </span>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div className="text-center">
                          <div className="text-[10px] text-gray-400 mb-1">Markup actual</div>
                          <div className={cn(
                            'text-[16px] font-black',
                            product.pendingOdooUpdate ? 'text-[#FFE600] line-through opacity-60' : 'text-gray-900',
                          )}>{(product.localMarkup !== undefined ? product.localMarkup : product.markup).toFixed(1)}%</div>
                        </div>
                        <div className="text-center">
                          <div className="text-[10px] text-gray-400 mb-1">Lista Markup (sin IVA)</div>
                          <div className="text-[16px] font-black text-gray-900">{ars(calc.odooListMarkup)}</div>
                        </div>
                        {idealCalc && (
                          <>
                            <div className="text-center bg-[#16A34A]/5 rounded-xl p-2">
                              <div className="text-[10px] text-gray-400 mb-0.5">Markup ideal ({params.idealMargin}% margen)</div>
                              <div className="text-[18px] font-black text-[#16A34A]">{idealCalc.markup.toFixed(1)}%</div>
                            </div>
                            <div className="text-center bg-[#16A34A]/5 rounded-xl p-2">
                              <div className="text-[10px] text-gray-400 mb-0.5">Lista ML ideal</div>
                              <div className="text-[18px] font-black text-[#16A34A]">{ars(idealPrice)}</div>
                            </div>
                          </>
                        )}
                      </div>
                      {idealCalc && (
                        <button
                          onClick={() => {
                            const newMarkup = idealCalc.markup;
                            const newOdooPrice = product.cost * (1 + newMarkup / 100);
                            const newOdooListML = newOdooPrice * 1.21;
                            const newCalc = product.mlPrice
                              ? calcProfitability(product.mlPrice, product.cost, params) ?? undefined
                              : undefined;
                            store.updateProduct(product.id, {
                              markup: newMarkup,
                              localMarkup: newMarkup,
                              odooPrice: newOdooPrice,
                              odooListML: newOdooListML,
                              pendingOdooUpdate: true,
                              calc: newCalc,
                              alerts: generateAlerts(
                                { ...product, markup: newMarkup, odooPrice: newOdooPrice, odooListML: newOdooListML },
                                params,
                              ),
                            });
                          }}
                          className={cn(
                            'mt-3 w-full py-2.5 rounded-xl text-[12px] font-black transition-all flex items-center justify-center gap-2',
                            product.pendingOdooUpdate
                              ? 'bg-gray-100 text-gray-400 cursor-default'
                              : 'bg-[#16A34A] text-white hover:bg-[#15803d]',
                          )}
                          disabled={product.pendingOdooUpdate}
                        >
                          {product.pendingOdooUpdate
                            ? '✓ Markup ideal aplicado — actualizá en Odoo'
                            : `⚡ Aplicar markup ideal (${idealCalc.markup.toFixed(1)}%) para ${params.idealMargin}% margen`}
                        </button>
                      )}
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

            {/* ── CONSULTOR ── */}
            {fichaTab === 'consultor' && (
              <div className="flex flex-col h-full min-h-0">

                {/* ─── Market competitor panel ─── */}
                <div className="shrink-0 border-b border-gray-100 bg-gray-50/60">

                  {/* Header strip */}
                  <div className="flex items-center gap-2 px-4 pt-3 pb-2">
                    <div className={cn(
                      'text-[11px] font-black tabular-nums px-2 py-0.5 rounded-lg shrink-0',
                      consultant.overallScore >= 70 ? 'bg-[#16A34A]/15 text-[#16A34A]' :
                      consultant.overallScore >= 40 ? 'bg-[#F97316]/15 text-[#F97316]' : 'bg-[#EF4444]/15 text-[#EF4444]',
                    )}>
                      {consultant.overallScore}
                    </div>
                    <span className={cn(
                      'text-[11px] font-bold px-2 py-0.5 rounded-full flex-1 truncate',
                      consultant.strategy === 'subir_markup' ? 'text-[#EF4444] bg-[#EF4444]/8' :
                      consultant.strategy === 'pausar'       ? 'text-[#F97316] bg-[#F97316]/8' :
                      consultant.strategy === 'mantener'     ? 'text-[#16A34A] bg-[#16A34A]/8' :
                      'text-gray-700 bg-gray-100',
                    )}>{consultant.strategyLabel}</span>
                    {consultant.recommendedPrice > 0 && (
                      <span className="text-[11px] font-black text-[#16A34A] shrink-0">
                        → {ars(consultant.recommendedPrice)}
                      </span>
                    )}
                    <button onClick={() => void runScout()} disabled={scouting} title="Actualizar mercado"
                      className="flex items-center gap-1 px-2 py-1 bg-[#FFE600] text-gray-900 text-[10px] font-bold rounded-lg hover:opacity-90 disabled:opacity-60 transition-opacity shrink-0">
                      {scouting ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
                      {scouting ? '…' : 'Mercado'}
                    </button>
                  </div>

                  {/* Market stats */}
                  {scout.market && (
                    <div className="grid grid-cols-3 gap-2 px-4 pb-2">
                      {[
                        { label: 'Mínimo',   val: ars(scout.market.minPrice), color: 'text-[#EF4444]' },
                        { label: 'Promedio', val: ars(scout.market.avgPrice), color: 'text-gray-900' },
                        { label: 'Máximo',   val: ars(scout.market.maxPrice), color: 'text-[#16A34A]' },
                      ].map(s => (
                        <div key={s.label} className="bg-white rounded-lg border border-gray-100 px-2 py-1.5 text-center">
                          <div className="text-[8px] text-gray-400 uppercase tracking-wide">{s.label}</div>
                          <div className={cn('text-[12px] font-black', s.color)}>{s.val}</div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Conditions gap analysis */}
                  {scout.items.length > 0 && (() => {
                    const n = scout.items.length;
                    const withShipping    = scout.items.filter(i => i.freeShipping).length;
                    const withInstallments = scout.items.filter(i => i.installments !== null).length;
                    const conditions = [
                      {
                        label: 'Envío gratis',
                        mktPct: Math.round(withShipping / n * 100),
                        weHave: product.mlFreeShipping ?? false,
                        icon: '🚚',
                      },
                      {
                        label: 'Cuotas sin interés',
                        mktPct: Math.round(withInstallments / n * 100),
                        weHave: product.mlHasInstallments ?? false,
                        icon: '💳',
                      },
                    ];
                    return (
                      <div className="px-4 pb-2">
                        <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Condiciones del mercado</p>
                        <div className="grid grid-cols-2 gap-2">
                          {conditions.map(c => {
                            const gap = !c.weHave && c.mktPct >= 50; // we're missing something most competitors have
                            return (
                              <div key={c.label} className={cn(
                                'rounded-xl border p-2.5',
                                gap ? 'bg-[#EF4444]/5 border-[#EF4444]/20' : c.weHave ? 'bg-[#16A34A]/5 border-[#16A34A]/20' : 'bg-gray-50 border-gray-100',
                              )}>
                                <div className="flex items-center justify-between mb-1.5">
                                  <span className="text-[10px] font-semibold text-gray-700">{c.icon} {c.label}</span>
                                  <span className={cn(
                                    'text-[9px] font-black px-1.5 py-0.5 rounded-full',
                                    c.weHave ? 'bg-[#16A34A] text-white' : gap ? 'bg-[#EF4444] text-white' : 'bg-gray-200 text-gray-500',
                                  )}>
                                    {c.weHave ? 'Tenés ✓' : gap ? 'Te falta ✗' : 'Opcional'}
                                  </span>
                                </div>
                                {/* Market bar */}
                                <div className="flex items-center gap-1.5">
                                  <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                                    <div
                                      className={cn('h-full rounded-full', c.mktPct >= 70 ? 'bg-[#EF4444]' : c.mktPct >= 40 ? 'bg-[#F97316]' : 'bg-gray-300')}
                                      style={{ width: `${c.mktPct}%` }}
                                    />
                                  </div>
                                  <span className="text-[9px] text-gray-500 shrink-0">{c.mktPct}% compet.</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}

                  {/* Top 5 competitor cards */}
                  {scouting && scout.items.length === 0 && (
                    <div className="flex items-center gap-2 px-4 pb-3 text-[11px] text-gray-400">
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Buscando competencia en ML…
                    </div>
                  )}
                  {scout.items.length > 0 && (
                    <div className="px-4 pb-3 space-y-1.5">
                      <p className="text-[9px] font-bold text-gray-400 uppercase tracking-wider mb-1">Top {scout.items.slice(0, 5).length} publicaciones</p>
                      {scout.items.slice(0, 5).map((item, idx) => (
                        <a
                          key={item.id}
                          href={item.permalink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-2.5 p-2 rounded-xl border border-gray-100 bg-white hover:border-[#3483FA]/30 hover:bg-[#3483FA]/3 transition-colors group"
                        >
                          {/* Rank */}
                          <span className="text-[9px] font-black text-gray-300 w-3 shrink-0">#{idx + 1}</span>
                          {/* Thumbnail */}
                          <div className="w-9 h-9 rounded-lg bg-gray-50 border border-gray-100 flex items-center justify-center shrink-0 overflow-hidden">
                            {item.thumbnail
                              // eslint-disable-next-line @next/next/no-img-element
                              ? <img src={item.thumbnail} alt="" className="w-full h-full object-contain" />
                              : <Package className="w-4 h-4 text-gray-300" />}
                          </div>
                          {/* Title + condition chips */}
                          <div className="flex-1 min-w-0">
                            <p className="text-[10px] font-semibold text-gray-800 line-clamp-1 leading-tight">{item.title}</p>
                            <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                              {item.freeShipping && (
                                <span className="text-[7px] font-bold text-[#16A34A] bg-[#16A34A]/10 px-1 py-px rounded leading-none">🚚 gratis</span>
                              )}
                              {item.installments && (
                                <span className="text-[7px] font-bold text-[#0784F2] bg-[#0784F2]/10 px-1 py-px rounded leading-none">💳 {item.installments.qty}x</span>
                              )}
                              {item.soldQty > 0 && (
                                <span className="text-[7px] text-gray-400 bg-gray-100 px-1 py-px rounded leading-none">{item.soldQty} vend.</span>
                              )}
                            </div>
                          </div>
                          {/* Price */}
                          <div className="text-right shrink-0">
                            <div className="text-[12px] font-black text-gray-900">{ars(item.price)}</div>
                          </div>
                        </a>
                      ))}
                    </div>
                  )}

                  {/* Action recommendation card */}
                  {consultant.trialAction && (
                    <div className={cn(
                      'mx-4 mb-3 px-3 py-2.5 rounded-xl border text-[11px] leading-snug',
                      consultant.strategy === 'subir_markup' || consultant.strategy === 'pausar'
                        ? 'bg-[#EF4444]/5 border-[#EF4444]/20 text-[#EF4444]'
                        : 'bg-[#07111F]/5 border-[#07111F]/15 text-gray-800',
                    )}>
                      <p className="font-black text-[10px] mb-1 uppercase tracking-wide">
                        {consultant.strategy === 'subir_markup' ? '⚠️ Acción urgente' :
                         consultant.strategy === 'pausar'       ? '🛑 Revisar' :
                         '💡 Para vender más'}
                      </p>
                      {consultant.trialAction}
                    </div>
                  )}
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
  const [activeTab,        setActiveTab]        = useState<MainTab>('dashboard');
  const [selectedId,       setSelectedId]       = useState<string | null>(null);
  const [showParamsPanel,  setShowParamsPanel]  = useState(false);
  const [tablaFilterReq,   setTablaFilterReq]   = useState<string>('todos');

  const goToTablaWithFilter = (filter: string) => {
    setTablaFilterReq(filter);
    setActiveTab('tabla');
  };
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
              <div className="hidden md:flex items-center gap-1">
                {[
                  { label: 'Total',       value: stats.total,      color: 'text-[#07111F]',   filter: 'todos'      },
                  { label: 'Rentables',   value: stats.rentables,  color: 'text-[#16A34A]',   filter: 'rentable'   },
                  { label: 'Bajo margen', value: stats.bajoMargen, color: 'text-[#D97706]',   filter: 'bajo_margen'},
                  { label: 'Pierden',     value: stats.pierde,     color: 'text-[#DC2626]',   filter: 'pierde'     },
                  { label: 'Activas ML',  value: stats.activas,    color: 'text-[#07111F]',   filter: 'todos'      },
                ].map(s => (
                  <button
                    key={s.label}
                    onClick={() => goToTablaWithFilter(s.filter)}
                    title={`Ver ${s.label} en tabla`}
                    className="text-center px-3 py-1.5 rounded-xl hover:bg-[#07111F]/10 transition-colors cursor-pointer"
                  >
                    <div className={cn('text-xl font-black', s.color)}>{s.value}</div>
                    <div className="text-[9px] text-[#07111F]/50 uppercase tracking-wide font-semibold">{s.label}</div>
                  </button>
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

        {/* Main area — dashboard is full split, others scroll normally */}
        <div className={cn('flex-1', activeTab === 'dashboard' ? 'overflow-hidden' : 'overflow-y-auto')}>
          {activeTab === 'dashboard' && (
            <DashboardTab
              store={store}
              onGoToImport={() => setActiveTab('importar')}
              geminiKey={geminiKey}
            />
          )}
          {activeTab === 'importar' && <ImportTab store={store} />}
          {activeTab === 'tabla' && (
            <TableTab store={store} onSelectProduct={handleSelectProduct} selectedId={selectedId} initialProfitFilter={tablaFilterReq} />
          )}
          {activeTab === 'export' && <ExportTab store={store} />}
        </div>
      </div>

      {/* Product detail modal — only for Tabla tab */}
      {selectedProduct && activeTab === 'tabla' && (
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
