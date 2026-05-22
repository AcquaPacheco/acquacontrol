'use client';

import { useState, useEffect, useMemo } from 'react';
import { useColumnResize } from '@/lib/use-column-resize';
import { cn } from '@/lib/utils';
import Link from 'next/link';
import {
  DollarSign, AlertTriangle, CheckCircle2, ArrowRight,
  Search, X, Users, BarChart3, Package, Lightbulb,
  TrendingDown, RefreshCw, ChevronRight, Edit2, Check,
} from 'lucide-react';

// ── Tipos
interface RealProduct {
  id: string; sku: string | null; name: string;
  cost: number; price: number; margin: number | null;
  image: string | null; supplierName: string | null;
  category: string | null; active: boolean; hidden?: boolean;
}

interface RawSupplier { name: string; slug?: string; active?: boolean; [k: string]: unknown; }

// ── Stats por proveedor
interface SupplierCostStat {
  name: string; slug: string; total: number; sinCosto: number;
  sinPrecio: number; conCosto: number; completitud: number;
  avgMargin: number | null; worstMargin: number | null;
}

function buildSupplierStats(products: RealProduct[], suppliers: RawSupplier[]): SupplierCostStat[] {
  const map = new Map<string, { total: number; sinCosto: number; sinPrecio: number; margins: number[] }>();
  products.forEach(p => {
    if (!p.supplierName) return;
    if (!map.has(p.supplierName)) map.set(p.supplierName, { total: 0, sinCosto: 0, sinPrecio: 0, margins: [] });
    const s = map.get(p.supplierName)!;
    s.total++;
    if (!p.cost || p.cost === 0) s.sinCosto++;
    if (!p.price || p.price <= 1) s.sinPrecio++;
    if (p.margin !== null && p.price > 1 && p.cost > 0) s.margins.push(p.margin);
  });
  const slugMap = new Map(suppliers.map(c => [c.name, c.slug]));
  return Array.from(map.entries())
    .map(([name, s]) => ({
      name,
      slug: slugMap.get(name) || name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''),
      total: s.total, sinCosto: s.sinCosto, sinPrecio: s.sinPrecio,
      conCosto: s.total - s.sinCosto,
      completitud: Math.round((s.total - s.sinCosto) / s.total * 100),
      avgMargin: s.margins.length ? Math.round(s.margins.reduce((a, b) => a + b, 0) / s.margins.length) : null,
      worstMargin: s.margins.length ? Math.round(Math.min(...s.margins)) : null,
    }))
    .sort((a, b) => b.sinCosto - a.sinCosto);
}

type TabKey = 'resumen' | 'por_proveedor' | 'sin_costo' | 'margen_bajo';

// ── Formateo de ARS (reutilizable en la página)
function fmtARS(n: number) {
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n);
}

export default function CostosPage() {
  const [tab, setTab]     = useState<TabKey>('resumen');
  const [search, setSearch] = useState('');
  const [activeFilterBanner, setActiveFilterBanner] = useState<string | null>(null);

  // ── Datos dinámicos (fetched on mount, refresh on demand) ─────────────────
  const [rawProducts,  setRawProducts]  = useState<RealProduct[]>([]);
  const [rawSuppliers, setRawSuppliers] = useState<RawSupplier[]>([]);
  const [loading,      setLoading]      = useState(true);

  const loadData = async () => {
    setLoading(true);
    try {
      const [prods, sups] = await Promise.all([
        fetch('/api/products?showHidden=true').then(r => r.json() as Promise<RealProduct[]>),
        fetch('/api/suppliers').then(r => r.json() as Promise<RawSupplier[]>),
      ]);
      setRawProducts(prods);
      setRawSuppliers(sups);
    } catch { /* silencioso */ }
    finally { setLoading(false); }
  };

  useEffect(() => { loadData(); }, []);

  // ── Productos activos: excluye active=false Y hidden=true ─────────────────
  const activeProducts = useMemo(
    () => rawProducts.filter(p => p.active !== false && p.hidden !== true),
    [rawProducts],
  );

  // ── Stats por proveedor — reactivo a activeProducts ───────────────────────
  const supplierStats = useMemo(
    () => buildSupplierStats(activeProducts, rawSuppliers),
    [activeProducts, rawSuppliers],
  );

  // ── Edición inline de costos y markup ─────────────────────────────────────
  const [edits,      setEdits]      = useState<Record<string, { cost?: number; price?: number }>>({});
  const [editingId,  setEditingId]  = useState<string | null>(null);
  const [editField,  setEditField]  = useState<'cost' | 'markup' | 'price' | null>(null);
  const [editVal,    setEditVal]    = useState('');
  const [saving,     setSaving]     = useState(false);
  const [savedId,    setSavedId]    = useState<string | null>(null);

  // Productos con edits locales aplicados (para que la tabla se actualice sin recargar)
  const effectiveProds = useMemo(() => activeProducts.map(p => {
    const e = edits[p.id];
    if (!e) return p;
    const cost  = e.cost  ?? p.cost;
    const price = e.price ?? p.price;
    const margin = price > 1 && cost > 0
      ? Math.round(((price - cost) / price) * 1000) / 10
      : p.margin;
    return { ...p, cost, price, margin };
  }), [edits]);

  const startEdit = (id: string, field: 'cost' | 'markup' | 'price', currentVal: number) => {
    setEditingId(id);
    setEditField(field);
    if (field === 'markup') {
      setEditVal(currentVal > 0 ? currentVal.toFixed(1) : '');
    } else {
      setEditVal(currentVal > 0 ? String(currentVal) : '');
    }
  };

  const cancelEdit = () => { setEditingId(null); setEditField(null); setEditVal(''); };

  const saveEdit = async (product: RealProduct) => {
    const raw = parseFloat(editVal.replace(/\./g, '').replace(',', '.'));
    if (!raw || isNaN(raw) || raw <= 0) { cancelEdit(); return; }

    let patchBody: Record<string, unknown> = { id: product.id, source: 'costos_inline' };
    let localUpdate: { cost?: number; price?: number } = {};

    if (editField === 'cost') {
      patchBody.cost = raw;
      localUpdate = { cost: raw };
    } else if (editField === 'price') {
      patchBody.price = raw;
      localUpdate = { price: raw };
    } else if (editField === 'markup') {
      // markup% → nuevo precio = costo × (1 + markup/100)
      const effectiveCost = (edits[product.id]?.cost ?? product.cost);
      if (!effectiveCost) { cancelEdit(); return; }
      const newPrice = Math.round(effectiveCost * (1 + raw / 100));
      patchBody.price = newPrice;
      localUpdate = { price: newPrice };
    }

    setSaving(true);
    try {
      const res = await fetch('/api/products', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patchBody),
      });
      const data = await res.json() as { ok: boolean };
      if (data.ok) {
        setEdits(prev => ({ ...prev, [product.id]: { ...(prev[product.id] ?? {}), ...localUpdate } }));
        setSavedId(product.id);
        setTimeout(() => setSavedId(null), 2000);
      }
    } finally {
      setSaving(false);
      cancelEdit();
    }
  };

  const { widths: colW, startResize } = useColumnResize({
    proveedor: 220, total: 80, conCosto: 90, sinCosto: 90, completitud: 140, margenProm: 110, peorMargen: 110, accion: 90,
    producto: 260, sku: 100, provProd: 160, costo: 110, listaA: 120, estado: 90,
    margen: 100, diagnos: 120,
  });

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const filterParam = params.get('filter');
    if (filterParam === 'noCost') {
      setTab('sin_costo');
      setActiveFilterBanner('noCost');
    }
  }, []);

  // Stats globales — reactivas a activeProducts, effectiveProds y supplierStats
  const stats = useMemo(() => {
    const sinCostoProds   = effectiveProds.filter(p => !p.cost || p.cost === 0);
    const sinPrecioProds  = effectiveProds.filter(p => !p.price || p.price <= 1);
    const marginBajoProds = effectiveProds.filter(p => p.margin !== null && p.margin < 35 && p.price > 1 && p.cost > 0);
    const withMargin      = effectiveProds.filter(p => p.margin !== null && p.price > 1 && p.cost > 0);
    const avg = withMargin.length
      ? Math.round(withMargin.reduce((s, p) => s + p.margin!, 0) / withMargin.length * 10) / 10
      : 0;
    return {
      total:         activeProducts.length,
      sinCosto:      sinCostoProds.length,
      sinPrecio:     sinPrecioProds.length,
      marginBajo:    marginBajoProds.length,
      avgMargin:     avg,
      provCriticos:  supplierStats.filter(s => s.sinCosto > 0).length,
      provCompletos: supplierStats.filter(s => s.sinCosto === 0).length,
    };
  }, [activeProducts, effectiveProds, supplierStats]);

  // Filtros de búsqueda — usan effectiveProds para reflejar edits locales
  const filteredSinCosto = useMemo(() => {
    const base = effectiveProds.filter(p => !p.cost || p.cost === 0);
    if (!search) return base;
    const s = search.toLowerCase();
    return base.filter(p =>
      p.name.toLowerCase().includes(s) ||
      (p.supplierName || '').toLowerCase().includes(s) ||
      (p.sku || '').toLowerCase().includes(s),
    );
  }, [search, effectiveProds]);

  const filteredMarginBajo = useMemo(() => {
    const base = effectiveProds.filter(p => p.margin !== null && p.margin < 35 && p.price > 1 && p.cost > 0);
    if (!search) return base.sort((a, b) => (a.margin ?? 0) - (b.margin ?? 0));
    const s = search.toLowerCase();
    return base.filter(p =>
      p.name.toLowerCase().includes(s) ||
      (p.supplierName || '').toLowerCase().includes(s),
    ).sort((a, b) => (a.margin ?? 0) - (b.margin ?? 0));
  }, [search, effectiveProds]);

  const filteredSuppliers = useMemo(() => {
    if (!search) return supplierStats;
    const s = search.toLowerCase();
    return supplierStats.filter(sup => sup.name.toLowerCase().includes(s));
  }, [search, supplierStats]);

  const tabs: { key: TabKey; label: string; count?: number; danger?: boolean }[] = [
    { key: 'resumen',       label: 'Radar de costos' },
    { key: 'por_proveedor', label: 'Por proveedor',   count: stats.provCriticos, danger: true },
    { key: 'sin_costo',     label: 'Sin costo',       count: stats.sinCosto,     danger: true },
    { key: 'margen_bajo',   label: 'Margen bajo',     count: stats.marginBajo },
  ];

  return (
    <div className="min-h-screen">
    <div className="max-w-[1680px] mx-auto">

      {/* Header */}
      <div className="bg-[#07111F] border-b border-white/10 px-4 lg:px-8 py-5">
        <div className="max-w-[1680px] mx-auto flex items-start justify-between gap-4">
          <div>
            <p className="text-white/40 text-[11px] font-semibold uppercase tracking-widest mb-1">Módulo</p>
            <h1 className="text-white font-bold text-2xl">Control de Costos</h1>
            <p className="text-white/50 text-sm mt-0.5 flex items-center gap-2">
              {loading
                ? <span className="flex items-center gap-1.5"><RefreshCw className="w-3 h-3 animate-spin" /> Cargando datos…</span>
                : <>{activeProducts.length} productos activos · {supplierStats.length} proveedores</>
              }
            </p>
          </div>
          <div className="hidden lg:flex items-center gap-6 shrink-0">
            {[
              { label: 'Sin costo',      val: stats.sinCosto,      color: stats.sinCosto > 0      ? 'text-[#EF4444]' : 'text-success' },
              { label: 'Margen bajo',    val: stats.marginBajo,    color: stats.marginBajo > 0    ? 'text-[#F97316]' : 'text-success' },
              { label: 'Prov. críticos', val: stats.provCriticos,  color: stats.provCriticos > 0  ? 'text-[#EF4444]' : 'text-success' },
              { label: 'Margen prom.',   val: `${stats.avgMargin}%`, color: stats.avgMargin >= 45 ? 'text-success'   : 'text-[#F97316]' },
            ].map((k, i) => (
              <div key={i} className={i > 0 ? 'pl-6 border-l border-white/10 text-center' : 'text-center'}>
                <div className={cn('text-2xl font-bold', k.color)}>{k.val}</div>
                <div className="text-[10px] text-white/40 uppercase tracking-wide mt-0.5">{k.label}</div>
              </div>
            ))}
            <div className="pl-6 border-l border-white/10">
              <button
                onClick={loadData}
                disabled={loading}
                title="Actualizar datos"
                className="flex items-center gap-1.5 px-3 py-1.5 bg-white/10 hover:bg-white/20 text-white text-[11px] font-semibold rounded-lg transition-colors disabled:opacity-50"
              >
                <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
                Actualizar
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Banner de filtro activo */}
      {activeFilterBanner && (
        <div className="px-4 lg:px-8 mt-3">
          <div className="max-w-[1680px] mx-auto">
            <div className="flex items-center gap-2 px-4 py-2.5 bg-warning/10 border border-warning/30 rounded-xl text-sm text-warning font-medium">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>Filtrado desde el Socio Acqua — viendo <strong>{stats.sinCosto} productos sin costo cargado</strong></span>
              <button onClick={() => { setActiveFilterBanner(null); setTab('resumen'); }}
                className="ml-auto hover:bg-warning/20 rounded p-0.5 transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tabs + Search */}
      <div className="px-4 lg:px-8 mt-5">
        <div className="max-w-[1680px] mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-1 bg-white rounded-lg border border-gray-200 p-1 flex-wrap">
            {tabs.map(t => (
              <button key={t.key} onClick={() => setTab(t.key)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors',
                  tab === t.key
                    ? t.danger ? 'bg-danger text-white' : 'bg-gray-900 text-white'
                    : 'text-gray-500 hover:text-gray-700',
                )}
              >
                {t.label}
                {t.count !== undefined && t.count > 0 && (
                  <span className={cn(
                    'text-[10px] font-bold px-1.5 py-0.5 rounded-full',
                    tab === t.key ? 'bg-white/20 text-white' : t.danger ? 'bg-danger/10 text-danger' : 'bg-gray-100 text-gray-500',
                  )}>
                    {t.count}
                  </span>
                )}
              </button>
            ))}
          </div>
          <div className="relative w-full sm:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input type="text" value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Buscar producto o proveedor…"
              className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-acqua/30"
            />
          </div>
        </div>
      </div>

      <div className="px-4 lg:px-8 mt-5 pb-10">
        <div className="max-w-[1680px] mx-auto">

          {/* ── RADAR DE COSTOS ── */}
          {tab === 'resumen' && (
            <div className="space-y-5">

              {/* KPI cards */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {[
                  { label: 'Sin costo cargado', val: stats.sinCosto, sub: 'productos sin precio base', icon: DollarSign, color: stats.sinCosto > 0 ? 'text-danger bg-danger/10' : 'text-success bg-success/10', onClick: () => setTab('sin_costo') },
                  { label: 'Proveedores críticos', val: stats.provCriticos, sub: 'con productos sin costo', icon: Users, color: stats.provCriticos > 0 ? 'text-danger bg-danger/10' : 'text-success bg-success/10', onClick: () => setTab('por_proveedor') },
                  { label: 'Margen bajo <35%', val: stats.marginBajo, sub: 'productos en riesgo', icon: TrendingDown, color: stats.marginBajo > 0 ? 'text-warning bg-warning/10' : 'text-success bg-success/10', onClick: () => setTab('margen_bajo') },
                  { label: 'Margen promedio', val: `${stats.avgMargin}%`, sub: 'del portfolio activo', icon: BarChart3, color: stats.avgMargin >= 50 ? 'text-success bg-success/10' : 'text-warning bg-warning/10', onClick: undefined },
                ].map((k, i) => {
                  const Icon = k.icon;
                  return (
                    <button key={i} onClick={k.onClick}
                      className={cn('bg-white rounded-xl border border-gray-100 p-4 text-left transition-all', k.onClick && 'hover:shadow-md cursor-pointer')}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center', k.color)}>
                          <Icon className="w-4 h-4" />
                        </div>
                        {k.onClick && <ChevronRight className="w-4 h-4 text-gray-400" />}
                      </div>
                      <div className="text-2xl font-bold text-gray-900">{k.val}</div>
                      <div className="text-[11px] font-semibold text-gray-500 mt-0.5">{k.label}</div>
                      <div className="text-[10px] text-gray-400">{k.sub}</div>
                    </button>
                  );
                })}
              </div>

              {/* Top proveedores con problemas */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

                {/* Proveedores con más productos sin costo */}
                <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                  <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between">
                    <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-danger" />
                      Proveedores con costo incompleto
                    </h3>
                    <button onClick={() => setTab('por_proveedor')}
                      className="text-[11px] text-acqua hover:underline">
                      Ver todos →
                    </button>
                  </div>
                  <div className="divide-y divide-gray-50">
                    {supplierStats.filter(s => s.sinCosto > 0).slice(0, 6).map(s => (
                      <div key={s.name} className="flex items-center gap-3 px-5 py-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-[12px] font-semibold text-gray-900 line-clamp-1">{s.name}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                              <div className="h-full bg-success rounded-full transition-all" style={{ width: `${s.completitud}%` }} />
                            </div>
                            <span className="text-[10px] text-gray-400 shrink-0">{s.completitud}%</span>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-[13px] font-bold text-danger">{s.sinCosto}</div>
                          <div className="text-[9px] text-gray-400">sin costo</div>
                        </div>
                        <Link href={`/proveedores/${s.slug}`}
                          className="w-7 h-7 flex items-center justify-center rounded-lg bg-gray-100 hover:bg-gray-200 transition-colors shrink-0">
                          <ArrowRight className="w-3 h-3 text-gray-500" />
                        </Link>
                      </div>
                    ))}
                    {supplierStats.filter(s => s.sinCosto === 0).length > 0 && (
                      <div className="px-5 py-3 flex items-center gap-2 text-success bg-success/3">
                        <CheckCircle2 className="w-4 h-4" />
                        <span className="text-[12px] font-medium">
                          {supplierStats.filter(s => s.sinCosto === 0).length} proveedores con costos completos ✓
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Productos sin costo — top 6 más urgentes (con precio cargado) */}
                <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                  <div className="px-5 py-3.5 border-b border-gray-100 flex items-center justify-between">
                    <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                      <Package className="w-4 h-4 text-warning" />
                      Productos sin costo con precio cargado
                    </h3>
                    <button onClick={() => setTab('sin_costo')}
                      className="text-[11px] text-acqua hover:underline">
                      Ver todos →
                    </button>
                  </div>
                  <div className="divide-y divide-gray-50">
                    {activeProducts
                      .filter(p => (!p.cost || p.cost === 0) && p.price > 1)
                      .sort((a, b) => b.price - a.price)
                      .slice(0, 6)
                      .map(p => (
                        <div key={p.id} className="flex items-center gap-3 px-5 py-3">
                          <div className="flex-1 min-w-0">
                            <p className="text-[12px] font-medium text-gray-900 line-clamp-1">{p.name}</p>
                            <p className="text-[10px] text-gray-400 mt-0.5">{p.supplierName || '—'}</p>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="text-[12px] font-bold text-gray-700">${p.price.toLocaleString('es-AR')}</div>
                            <div className="text-[9px] text-danger">Sin costo</div>
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              </div>

              {/* Insight del Socio Acqua */}
              <div className="bg-[#07111F] rounded-2xl px-5 py-4 flex items-start gap-4">
                <div className="w-9 h-9 rounded-full bg-acqua/20 border border-acqua/40 flex items-center justify-center shrink-0 mt-0.5">
                  <Lightbulb className="w-4 h-4 text-acqua" />
                </div>
                <div>
                  <p className="text-[11px] font-bold text-acqua uppercase tracking-widest mb-1.5">Socio Acqua — Lectura de costos</p>
                  <p className="text-[13px] text-white/80 leading-relaxed">
                    {stats.sinCosto > 0
                      ? <>Tenés <span className="text-white font-bold">{stats.sinCosto} productos sin costo</span> — esto impide exportar con datos correctos a Odoo y hace que el margen se calcule como cero. Los proveedores más urgentes son <span className="text-[#F97316] font-semibold">{supplierStats.filter(s => s.sinCosto > 0).slice(0, 2).map(s => s.name.split(' ')[0]).join(' y ')}</span>. Cargá las listas desde Parámetros → Importar o directamente en la ficha del proveedor.</>
                      : <>Todos los productos activos tienen costo cargado 🎉. El próximo paso es revisar los {stats.marginBajo} productos con margen bajo 35% para ajustar precios o renegociar con proveedores.</>
                    }
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* ── POR PROVEEDOR ── */}
          {tab === 'por_proveedor' && (
            <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
              <div className="px-5 py-3 bg-gray-50/50 border-b border-gray-100">
                <p className="text-sm font-bold text-gray-900">
                  {filteredSuppliers.length} proveedores · {stats.provCriticos} con costo incompleto
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider border-b border-gray-100 bg-gray-50/50 select-none">
                      <th className="text-left px-5 py-3 relative group/th" style={{ width: colW.proveedor, minWidth: 100 }}>Proveedor<div className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize opacity-0 group-hover/th:opacity-100 hover:bg-acqua/40 transition-opacity" onMouseDown={startResize('proveedor')} /></th>
                      <th className="text-center px-3 py-3 relative group/th" style={{ width: colW.total, minWidth: 50 }}>Total<div className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize opacity-0 group-hover/th:opacity-100 hover:bg-acqua/40 transition-opacity" onMouseDown={startResize('total')} /></th>
                      <th className="text-center px-3 py-3 relative group/th" style={{ width: colW.conCosto, minWidth: 60 }}>Con costo<div className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize opacity-0 group-hover/th:opacity-100 hover:bg-acqua/40 transition-opacity" onMouseDown={startResize('conCosto')} /></th>
                      <th className="text-center px-3 py-3 relative group/th" style={{ width: colW.sinCosto, minWidth: 60 }}>Sin costo<div className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize opacity-0 group-hover/th:opacity-100 hover:bg-acqua/40 transition-opacity" onMouseDown={startResize('sinCosto')} /></th>
                      <th className="text-center px-3 py-3 relative group/th" style={{ width: colW.completitud, minWidth: 100 }}>Completitud<div className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize opacity-0 group-hover/th:opacity-100 hover:bg-acqua/40 transition-opacity" onMouseDown={startResize('completitud')} /></th>
                      <th className="text-center px-3 py-3 relative group/th" style={{ width: colW.margenProm, minWidth: 80 }}>Margen prom.<div className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize opacity-0 group-hover/th:opacity-100 hover:bg-acqua/40 transition-opacity" onMouseDown={startResize('margenProm')} /></th>
                      <th className="text-center px-3 py-3 relative group/th" style={{ width: colW.peorMargen, minWidth: 80 }}>Peor margen<div className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize opacity-0 group-hover/th:opacity-100 hover:bg-acqua/40 transition-opacity" onMouseDown={startResize('peorMargen')} /></th>
                      <th className="text-center px-3 py-3 relative group/th" style={{ width: colW.accion, minWidth: 60 }}>Acción<div className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize opacity-0 group-hover/th:opacity-100 hover:bg-acqua/40 transition-opacity" onMouseDown={startResize('accion')} /></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {filteredSuppliers.map(s => (
                      <tr key={s.name} className={cn('hover:bg-gray-50/50 transition-colors', s.sinCosto > 0 && 'bg-danger/2')}>
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2">
                            {s.sinCosto > 0
                              ? <AlertTriangle className="w-3.5 h-3.5 text-danger shrink-0" />
                              : <CheckCircle2 className="w-3.5 h-3.5 text-success shrink-0" />}
                            <span className="text-[12px] font-semibold text-gray-900 line-clamp-1">{s.name}</span>
                          </div>
                        </td>
                        <td className="px-3 py-3 text-center text-[12px] text-gray-600 font-mono">{s.total}</td>
                        <td className="px-3 py-3 text-center text-[12px] font-semibold text-success">{s.conCosto}</td>
                        <td className="px-3 py-3 text-center">
                          {s.sinCosto > 0
                            ? <span className="text-[12px] font-bold text-danger">{s.sinCosto}</span>
                            : <span className="text-gray-400 text-[11px]">—</span>}
                        </td>
                        <td className="px-3 py-3 text-center">
                          <div className="flex items-center gap-2 justify-center">
                            <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                              <div className={cn('h-full rounded-full', s.completitud === 100 ? 'bg-success' : s.completitud >= 80 ? 'bg-warning' : 'bg-danger')}
                                style={{ width: `${s.completitud}%` }} />
                            </div>
                            <span className={cn('text-[11px] font-bold', s.completitud === 100 ? 'text-success' : s.completitud >= 80 ? 'text-warning' : 'text-danger')}>
                              {s.completitud}%
                            </span>
                          </div>
                        </td>
                        <td className="px-3 py-3 text-center">
                          {s.avgMargin !== null
                            ? <span className={cn('text-[12px] font-bold', s.avgMargin >= 45 ? 'text-success' : s.avgMargin >= 30 ? 'text-warning' : 'text-danger')}>
                                {s.avgMargin}%
                              </span>
                            : <span className="text-gray-400 text-[11px]">—</span>}
                        </td>
                        <td className="px-3 py-3 text-center">
                          {s.worstMargin !== null
                            ? <span className={cn('text-[11px] font-semibold', s.worstMargin < 0 ? 'text-danger' : s.worstMargin < 30 ? 'text-warning' : 'text-gray-500')}>
                                {s.worstMargin}%
                              </span>
                            : <span className="text-gray-400 text-[11px]">—</span>}
                        </td>
                        <td className="px-3 py-3 text-center">
                          <Link href={`/proveedores/${s.slug}`}
                            className="inline-flex items-center gap-1 px-2.5 py-1 bg-gray-900 text-white text-[10px] font-semibold rounded-lg hover:bg-gray-800 transition-colors">
                            Abrir <ArrowRight className="w-2.5 h-2.5" />
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── SIN COSTO (datos reales) ── */}
          {tab === 'sin_costo' && (
            <div>
              <div className="bg-white rounded-xl border border-danger/20 overflow-hidden">
                <div className="px-5 py-3 bg-danger/5 border-b border-danger/10 flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-danger" />
                    <span className="text-sm font-bold text-danger">
                      {filteredSinCosto.length} productos sin costo — datos reales
                    </span>
                  </div>
                  <span className="text-xs text-gray-400">Sin costo = sin margen = no exportar</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="text-[11px] text-gray-400 font-semibold uppercase tracking-wider border-b border-gray-100 select-none">
                        <th className="text-left px-5 py-3 relative group/th" style={{ width: colW.producto, minWidth: 120 }}>Producto<div className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize opacity-0 group-hover/th:opacity-100 hover:bg-acqua/40 transition-opacity" onMouseDown={startResize('producto')} /></th>
                        <th className="text-left px-3 py-3 relative group/th" style={{ width: colW.sku, minWidth: 60 }}>SKU<div className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize opacity-0 group-hover/th:opacity-100 hover:bg-acqua/40 transition-opacity" onMouseDown={startResize('sku')} /></th>
                        <th className="text-left px-3 py-3 relative group/th" style={{ width: colW.provProd, minWidth: 80 }}>Proveedor<div className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize opacity-0 group-hover/th:opacity-100 hover:bg-acqua/40 transition-opacity" onMouseDown={startResize('provProd')} /></th>
                        <th className="text-right px-3 py-3 relative group/th" style={{ width: colW.listaA, minWidth: 70 }}>Lista A<div className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize opacity-0 group-hover/th:opacity-100 hover:bg-acqua/40 transition-opacity" onMouseDown={startResize('listaA')} /></th>
                        <th className="text-right px-3 py-3 relative group/th" style={{ width: colW.costo, minWidth: 100 }}>Costo neto<div className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize opacity-0 group-hover/th:opacity-100 hover:bg-acqua/40 transition-opacity" onMouseDown={startResize('costo')} /></th>
                        <th className="text-center px-3 py-3 relative group/th" style={{ width: colW.estado, minWidth: 60 }}>Estado<div className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize opacity-0 group-hover/th:opacity-100 hover:bg-acqua/40 transition-opacity" onMouseDown={startResize('estado')} /></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {filteredSinCosto.map(p => {
                        const isEditing = editingId === p.id && editField === 'cost';
                        const wasSaved  = savedId === p.id;
                        return (
                          <tr key={p.id} className={cn('hover:bg-red-50/30 transition-colors group', wasSaved && 'bg-success/5')}>
                            <td className="px-5 py-3">
                              <div className="text-sm font-medium text-gray-900 line-clamp-1">{p.name}</div>
                              <div className="text-[10px] text-gray-400">{p.category || '—'}</div>
                            </td>
                            <td className="px-3 py-3 text-xs text-gray-500 font-mono">{p.sku || '—'}</td>
                            <td className="px-3 py-3">
                              {p.supplierName
                                ? <Link href={`/proveedores/${p.supplierName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')}`}
                                    className="text-xs text-acqua hover:underline">{p.supplierName}</Link>
                                : <span className="text-gray-400 text-xs">—</span>}
                            </td>
                            <td className="px-3 py-3 text-right text-sm text-gray-700 font-mono">
                              {p.price > 1 ? fmtARS(p.price) : <span className="text-gray-400">—</span>}
                            </td>
                            {/* ── Costo inline editable ── */}
                            <td className="px-3 py-3 text-right">
                              {isEditing ? (
                                <div className="flex items-center justify-end gap-1">
                                  <span className="text-xs text-gray-400">$</span>
                                  <input
                                    autoFocus
                                    type="text"
                                    inputMode="decimal"
                                    value={editVal}
                                    onChange={e => setEditVal(e.target.value)}
                                    onKeyDown={e => {
                                      if (e.key === 'Enter')  saveEdit(p as unknown as RealProduct);
                                      if (e.key === 'Escape') cancelEdit();
                                    }}
                                    placeholder="0"
                                    className="w-24 text-right text-sm font-mono border-b-2 border-acqua bg-acqua/5 px-1 py-0.5 focus:outline-none rounded-t"
                                  />
                                  <button onClick={() => saveEdit(p as unknown as RealProduct)} disabled={saving}
                                    className="w-6 h-6 flex items-center justify-center rounded bg-success/10 text-success hover:bg-success/20 disabled:opacity-50">
                                    {saving ? '…' : <Check className="w-3.5 h-3.5" />}
                                  </button>
                                  <button onClick={cancelEdit}
                                    className="w-6 h-6 flex items-center justify-center rounded bg-gray-100 text-gray-400 hover:bg-gray-200">
                                    <X className="w-3 h-3" />
                                  </button>
                                </div>
                              ) : (
                                <button
                                  onClick={() => startEdit(p.id, 'cost', p.cost)}
                                  className="flex items-center justify-end gap-1.5 w-full text-right group/edit"
                                >
                                  {wasSaved
                                    ? <span className="text-success text-[11px] font-semibold">✓ Guardado</span>
                                    : <span className="flex items-center gap-1 text-[11px] text-danger font-medium group-hover/edit:text-acqua transition-colors">
                                        <Edit2 className="w-3 h-3" /> Ingresar costo
                                      </span>}
                                </button>
                              )}
                            </td>
                            <td className="px-3 py-3 text-center">
                              {wasSaved
                                ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-success/10 text-success text-[10px] font-semibold">
                                    <span className="w-1.5 h-1.5 rounded-full bg-success" /> Guardado ✓
                                  </span>
                                : <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-danger/10 text-danger text-[10px] font-semibold">
                                    <span className="w-1.5 h-1.5 rounded-full bg-danger" /> Falta costo
                                  </span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {filteredSinCosto.length === 0 && search && (
                  <div className="px-5 py-8 text-center text-sm text-gray-400">Sin resultados para &ldquo;{search}&rdquo;</div>
                )}
                <div className="px-5 py-3 border-t border-gray-100 bg-gray-50/50 text-[12px] text-gray-500">
                  Total: <span className="font-semibold text-gray-700">{stats.sinCosto}</span> sin costo ·
                  Mostrando: <span className="font-semibold text-gray-700">{filteredSinCosto.length}</span>
                </div>
              </div>
            </div>
          )}

          {/* ── MARGEN BAJO ── */}
          {tab === 'margen_bajo' && (
            <div className="bg-white rounded-xl border border-warning/20 overflow-hidden">
              <div className="px-5 py-3 bg-warning/5 border-b border-warning/10 flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <TrendingDown className="w-4 h-4 text-warning" />
                  <span className="text-sm font-bold text-warning">
                    {filteredMarginBajo.length} productos con margen bajo 35%
                  </span>
                </div>
                <span className="text-xs text-gray-400">Ordenados por margen ↑</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="text-[11px] text-gray-400 font-semibold uppercase tracking-wider border-b border-gray-100">
                      <th className="text-left px-5 py-3 relative group/th" style={{ width: colW.producto, minWidth: 120 }}>
                        Producto
                        <div className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize opacity-0 group-hover/th:opacity-100 hover:bg-acqua/40 transition-opacity" onMouseDown={startResize('producto')} />
                      </th>
                      <th className="text-left px-3 py-3 relative group/th" style={{ width: colW.provProd, minWidth: 80 }}>
                        Proveedor
                        <div className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize opacity-0 group-hover/th:opacity-100 hover:bg-acqua/40 transition-opacity" onMouseDown={startResize('provProd')} />
                      </th>
                      <th className="text-right px-3 py-3 relative group/th" style={{ width: colW.costo, minWidth: 70 }}>
                        Costo
                        <div className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize opacity-0 group-hover/th:opacity-100 hover:bg-acqua/40 transition-opacity" onMouseDown={startResize('costo')} />
                      </th>
                      <th className="text-right px-3 py-3 relative group/th" style={{ width: colW.listaA, minWidth: 70 }}>
                        Lista A
                        <div className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize opacity-0 group-hover/th:opacity-100 hover:bg-acqua/40 transition-opacity" onMouseDown={startResize('listaA')} />
                      </th>
                      <th className="text-center px-3 py-3 relative group/th" style={{ width: colW.margen, minWidth: 60 }}>
                        Margen
                        <div className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize opacity-0 group-hover/th:opacity-100 hover:bg-acqua/40 transition-opacity" onMouseDown={startResize('margen')} />
                      </th>
                      <th className="text-center px-3 py-3 relative group/th" style={{ width: 110, minWidth: 80 }}>
                        Markup %
                      </th>
                      <th className="text-center px-3 py-3 relative group/th" style={{ width: colW.diagnos, minWidth: 80 }}>
                        Diagnóstico
                        <div className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize opacity-0 group-hover/th:opacity-100 hover:bg-acqua/40 transition-opacity" onMouseDown={startResize('diagnos')} />
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {filteredMarginBajo.slice(0, 80).map(p => {
                      const mg = p.margin ?? 0;
                      const isNeg = mg < 0;
                      const markup = p.cost > 0 && p.price > 1 ? Math.round(((p.price / p.cost) - 1) * 1000) / 10 : null;
                      const isEditingMarkup = editingId === p.id && editField === 'markup';
                      const isEditingPrice  = editingId === p.id && editField === 'price';
                      const wasSaved = savedId === p.id;
                      return (
                        <tr key={p.id} className={cn('hover:bg-gray-50/50 transition-colors group', isNeg && 'bg-danger/3', wasSaved && 'bg-success/5')}>
                          <td className="px-5 py-3">
                            <div className="text-sm font-medium text-gray-900 line-clamp-1">{p.name}</div>
                            <div className="text-[10px] text-gray-400">{p.category || '—'}</div>
                          </td>
                          <td className="px-3 py-3 text-xs text-gray-600">{p.supplierName || '—'}</td>
                          {/* Costo */}
                          <td className="px-3 py-3 text-right text-sm font-mono text-gray-600">
                            {p.cost > 0 ? fmtARS(p.cost) : <span className="text-gray-400">—</span>}
                          </td>
                          {/* Lista A editable */}
                          <td className="px-3 py-3 text-right">
                            {isEditingPrice ? (
                              <div className="flex items-center justify-end gap-1">
                                <span className="text-xs text-gray-400">$</span>
                                <input autoFocus type="text" inputMode="decimal" value={editVal}
                                  onChange={e => setEditVal(e.target.value)}
                                  onKeyDown={e => { if (e.key === 'Enter') saveEdit(p as unknown as RealProduct); if (e.key === 'Escape') cancelEdit(); }}
                                  className="w-20 text-right text-sm font-mono border-b-2 border-acqua bg-acqua/5 px-1 py-0.5 focus:outline-none rounded-t"
                                />
                                <button onClick={() => saveEdit(p as unknown as RealProduct)} disabled={saving}
                                  className="w-6 h-6 flex items-center justify-center rounded bg-success/10 text-success hover:bg-success/20 disabled:opacity-50">
                                  {saving ? '…' : <Check className="w-3.5 h-3.5" />}
                                </button>
                                <button onClick={cancelEdit} className="w-6 h-6 flex items-center justify-center rounded bg-gray-100 text-gray-400"><X className="w-3 h-3" /></button>
                              </div>
                            ) : (
                              <button onClick={() => startEdit(p.id, 'price', p.price)}
                                className="flex items-center justify-end gap-1 w-full text-right group/editp">
                                <span className="text-sm font-mono font-semibold text-gray-900">{fmtARS(p.price)}</span>
                                <Edit2 className="w-3 h-3 text-gray-300 group-hover/editp:text-acqua transition-colors opacity-0 group-hover:opacity-100" />
                              </button>
                            )}
                          </td>
                          {/* Margen */}
                          <td className="px-3 py-3 text-center">
                            <span className={cn('text-sm font-bold', isNeg ? 'text-danger' : 'text-warning')}>{mg.toFixed(1)}%</span>
                          </td>
                          {/* Markup editable */}
                          <td className="px-3 py-3 text-center">
                            {isEditingMarkup ? (
                              <div className="flex items-center justify-center gap-1">
                                <input autoFocus type="text" inputMode="decimal" value={editVal}
                                  onChange={e => setEditVal(e.target.value)}
                                  onKeyDown={e => { if (e.key === 'Enter') saveEdit(p as unknown as RealProduct); if (e.key === 'Escape') cancelEdit(); }}
                                  placeholder="%"
                                  className="w-16 text-center text-sm font-mono border-b-2 border-acqua bg-acqua/5 px-1 py-0.5 focus:outline-none rounded-t"
                                />
                                <button onClick={() => saveEdit(p as unknown as RealProduct)} disabled={saving}
                                  className="w-6 h-6 flex items-center justify-center rounded bg-success/10 text-success hover:bg-success/20 disabled:opacity-50">
                                  {saving ? '…' : <Check className="w-3.5 h-3.5" />}
                                </button>
                                <button onClick={cancelEdit} className="w-6 h-6 flex items-center justify-center rounded bg-gray-100 text-gray-400"><X className="w-3 h-3" /></button>
                              </div>
                            ) : (
                              <button onClick={() => startEdit(p.id, 'markup', markup ?? 0)}
                                className="flex items-center justify-center gap-1 group/editm">
                                {markup !== null
                                  ? <span className="text-[12px] font-bold text-gray-700">{markup.toFixed(1)}%</span>
                                  : <span className="text-gray-400 text-[11px]">—</span>}
                                <Edit2 className="w-3 h-3 text-gray-300 group-hover/editm:text-acqua transition-colors opacity-0 group-hover:opacity-100" />
                              </button>
                            )}
                          </td>
                          <td className="px-3 py-3 text-center">
                            {wasSaved
                              ? <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold bg-success/10 text-success">✓ Guardado</span>
                              : <span className={cn('inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold',
                                  isNeg ? 'bg-danger/10 text-danger' : 'bg-warning/10 text-warning')}>
                                  {isNeg ? 'Pérdida' : mg < 20 ? 'Muy bajo' : 'Ajustado'}
                                </span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {filteredMarginBajo.length > 80 && (
                <div className="px-5 py-3 border-t border-gray-100 text-center text-xs text-gray-400">
                  Mostrando 80 de {filteredMarginBajo.length} — refiná la búsqueda
                </div>
              )}
            </div>
          )}

        </div>
      </div>
    </div>
    </div>
  );
}
