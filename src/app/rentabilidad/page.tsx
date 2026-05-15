'use client';

import { useState, useEffect, useMemo } from 'react';
import { useColumnResize } from '@/lib/use-column-resize';
import productsData from '@/data/products.json';
import { cn } from '@/lib/utils';
import {
  TrendingUp, Calculator, Lightbulb, AlertTriangle, X,
  Zap, Eye, Target, TrendingDown, ArrowUpRight,
} from 'lucide-react';

// ── Tipos de datos reales
interface RealProduct {
  id: string; sku: string | null; name: string;
  cost: number; price: number; margin: number | null;
  image: string | null; supplierName: string | null;
  category: string | null;
}
const realProducts = productsData as RealProduct[];

type MarginFilter = 'todos' | 'negMargin' | 'lowMargin' | 'okMargin';

export default function RentabilidadPage() {
  const [simPrice, setSimPrice]   = useState('');
  const [simCost, setSimCost]     = useState('10000');
  const [marginFilter, setMarginFilter] = useState<MarginFilter>('todos');
  const [search, setSearch]       = useState('');
  const [activeFilterBanner, setActiveFilterBanner] = useState<string | null>(null);

  const { widths: colW, startResize } = useColumnResize({
    producto: 280, costo: 120, listaA: 120, listaB: 120, listaC: 120, margen: 100,
  });

  // Leer URL params al montar
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const filterParam = params.get('filter');
    if (filterParam === 'negMargin') {
      setMarginFilter('negMargin');
      setActiveFilterBanner('negMargin');
    } else if (filterParam === 'lowMargin') {
      setMarginFilter('lowMargin');
      setActiveFilterBanner('lowMargin');
    }
  }, []);

  // Simulador
  const cost       = parseFloat(simCost) || 0;
  const price      = parseFloat(simPrice) || 0;
  const priceNoIVA = price / 1.21;
  const margin     = price > 0 ? ((priceNoIVA - cost) / priceNoIVA * 100) : 0;
  const utility    = price > 0 ? (priceNoIVA - cost) : 0;
  const markup     = cost > 0 ? ((priceNoIVA - cost) / cost * 100) : 0;
  const listB      = Math.ceil((price * 0.9) / 10) * 10;
  const listC      = Math.ceil((price * 0.85) / 10) * 10;

  // Stats reales
  const realStats = useMemo(() => ({
    total:     realProducts.length,
    conMargen: realProducts.filter(p => p.margin !== null).length,
    negativo:  realProducts.filter(p => p.margin !== null && p.margin < 0).length,
    bajo:      realProducts.filter(p => p.margin !== null && p.margin >= 0 && p.margin < 30).length,
    ok:        realProducts.filter(p => p.margin !== null && p.margin >= 30 && p.margin < 50).length,
    bueno:     realProducts.filter(p => p.margin !== null && p.margin >= 50).length,
  }), []);

  // Tabla filtrada (datos reales)
  const filteredProducts = useMemo(() => {
    let list = realProducts.filter(p => p.margin !== null && (p.cost > 0 || p.price > 0));

    if (marginFilter === 'negMargin') list = list.filter(p => (p.margin ?? 0) < 0);
    else if (marginFilter === 'lowMargin') list = list.filter(p => (p.margin ?? 0) >= 0 && (p.margin ?? 0) < 30);
    else if (marginFilter === 'okMargin') list = list.filter(p => (p.margin ?? 0) >= 30);

    if (search) {
      const s = search.toLowerCase();
      list = list.filter(
        p => p.name.toLowerCase().includes(s) ||
             (p.supplierName || '').toLowerCase().includes(s) ||
             (p.sku || '').toLowerCase().includes(s),
      );
    }

    return list.sort((a, b) => (a.margin ?? 0) - (b.margin ?? 0));
  }, [marginFilter, search]);

  const bannerText: Record<string, string> = {
    negMargin: `Filtrado desde el Socio Acqua — viendo ${realStats.negativo} productos con margen negativo`,
    lowMargin: `Filtrado desde el Socio Acqua — viendo ${realStats.bajo} productos con margen bajo (<30%)`,
  };

  const filterTabs: { key: MarginFilter; label: string; count?: number; color: string }[] = [
    { key: 'todos',     label: 'Todos con margen', count: realStats.conMargen, color: 'bg-gray-900 text-white' },
    { key: 'negMargin', label: 'Margen negativo',  count: realStats.negativo,  color: 'bg-danger text-white' },
    { key: 'lowMargin', label: 'Margen bajo <30%', count: realStats.bajo,      color: 'bg-warning text-white' },
    { key: 'okMargin',  label: 'Margen ok ≥30%',  count: realStats.ok + realStats.bueno, color: 'bg-success text-white' },
  ];

  return (
    <div className="min-h-screen">
    <div className="max-w-[1680px] mx-auto">
      {/* Header */}
      <div className="px-4 lg:px-6 pt-6 pb-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-success/10 flex items-center justify-center">
            <TrendingUp className="w-5 h-5 text-success" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Rentabilidad & Pricing</h1>
            <p className="text-sm text-gray-500">Analizá márgenes reales y simulá precios</p>
          </div>
        </div>
      </div>

      {/* Banner de filtro activo */}
      {activeFilterBanner && bannerText[activeFilterBanner] && (
        <div className="px-4 lg:px-6 mb-2">
          <div className="flex items-center gap-2 px-4 py-2.5 bg-danger/10 border border-danger/30 rounded-xl text-sm text-danger font-medium">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{bannerText[activeFilterBanner]}</span>
            <button
              onClick={() => { setActiveFilterBanner(null); setMarginFilter('todos'); }}
              className="ml-auto hover:bg-danger/20 rounded p-0.5 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* ── DASHBOARD: Cuadro de mando ── */}
      <div className="px-4 lg:px-6 mb-6">

        {/* 4 Buckets con top productos */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          {[
            {
              icon: Zap,
              label: 'Potenciar', sub: 'Margen ≥ 50%',
              color: 'bg-[#16A34A]', bgLight: 'bg-[#16A34A]/8 border-[#16A34A]/20',
              textColor: 'text-[#16A34A]',
              count: realStats.bueno,
              products: realProducts.filter(p => p.margin !== null && p.margin >= 50 && p.price > 1 && p.cost > 0)
                .sort((a, b) => (b.margin ?? 0) - (a.margin ?? 0)).slice(0, 3),
              action: 'Promover, crear combos, subir en ML',
              filterKey: 'okMargin' as MarginFilter,
            },
            {
              icon: Target,
              label: 'Bien encaminado', sub: 'Margen 35–49%',
              color: 'bg-[#0EA5E9]', bgLight: 'bg-[#0EA5E9]/8 border-[#0EA5E9]/20',
              textColor: 'text-[#0EA5E9]',
              count: realStats.ok,
              products: realProducts.filter(p => p.margin !== null && p.margin >= 35 && p.margin < 50 && p.price > 1 && p.cost > 0)
                .sort((a, b) => (b.margin ?? 0) - (a.margin ?? 0)).slice(0, 3),
              action: 'Mantener. Revisar si hay oportunidad de subir precio.',
              filterKey: 'okMargin' as MarginFilter,
            },
            {
              icon: Eye,
              label: 'Vigilar', sub: 'Margen 0–34%',
              color: 'bg-[#F97316]', bgLight: 'bg-[#F97316]/8 border-[#F97316]/20',
              textColor: 'text-[#F97316]',
              count: realStats.bajo,
              products: realProducts.filter(p => p.margin !== null && p.margin >= 0 && p.margin < 35 && p.price > 1 && p.cost > 0)
                .sort((a, b) => (a.margin ?? 0) - (b.margin ?? 0)).slice(0, 3),
              action: 'Revisar costo o ajustar precio de Lista A.',
              filterKey: 'lowMargin' as MarginFilter,
            },
            {
              icon: TrendingDown,
              label: 'Crítico', sub: 'Margen < 0%',
              color: 'bg-[#EF4444]', bgLight: 'bg-[#EF4444]/8 border-[#EF4444]/20',
              textColor: 'text-[#EF4444]',
              count: realStats.negativo,
              products: realProducts.filter(p => p.margin !== null && p.margin < 0 && p.price > 1 && p.cost > 0)
                .sort((a, b) => (a.margin ?? 0) - (b.margin ?? 0)).slice(0, 3),
              action: 'Acción inmediata — estás perdiendo en cada venta.',
              filterKey: 'negMargin' as MarginFilter,
            },
          ].map(bucket => {
            const Icon = bucket.icon;
            return (
              <div key={bucket.label} className={cn('bg-white border rounded-2xl p-4', bucket.bgLight)}>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className={cn('w-7 h-7 rounded-lg flex items-center justify-center', bucket.color)}>
                      <Icon className="w-3.5 h-3.5 text-white" />
                    </div>
                    <div>
                      <div className="text-[11px] font-bold text-gray-900">{bucket.label}</div>
                      <div className="text-[9px] text-gray-400">{bucket.sub}</div>
                    </div>
                  </div>
                  <div className={cn('text-2xl font-black', bucket.textColor)}>{bucket.count}</div>
                </div>

                {/* Top productos */}
                {bucket.products.length > 0 && (
                  <div className="space-y-1.5 mb-3">
                    {bucket.products.map(p => (
                      <div key={p.id} className="flex items-center justify-between py-1 border-t border-gray-100">
                        <span className="text-[10px] text-gray-600 line-clamp-1 flex-1 mr-2">{p.name.split(' ').slice(0,4).join(' ')}</span>
                        <span className={cn('text-[11px] font-bold shrink-0', bucket.textColor)}>{p.margin}%</span>
                      </div>
                    ))}
                  </div>
                )}
                {bucket.products.length === 0 && (
                  <p className="text-[10px] text-gray-400 italic mb-3">Sin productos en este rango</p>
                )}

                {/* Acción sugerida */}
                <p className="text-[9px] text-gray-500 leading-tight">{bucket.action}</p>

                <button
                  onClick={() => setMarginFilter(bucket.filterKey)}
                  className={cn('flex items-center gap-1 mt-2 text-[10px] font-semibold', bucket.textColor)}
                >
                  Ver todos <ArrowUpRight className="w-3 h-3" />
                </button>
              </div>
            );
          })}
        </div>

        {/* Insight del Socio Acqua */}
        <div className="bg-[#07111F] rounded-2xl px-5 py-4 flex items-start gap-4">
          <div className="w-9 h-9 rounded-full bg-acqua/20 border border-acqua/40 flex items-center justify-center shrink-0 mt-0.5">
            <Lightbulb className="w-4 h-4 text-acqua" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] font-bold text-acqua uppercase tracking-widest mb-1.5">Socio Acqua — Lectura de rentabilidad</p>
            <p className="text-[13px] text-white/80 leading-relaxed">
              Tu margen promedio de <span className="text-white font-bold">58.8%</span> es saludable.
              Los {realStats.bueno} productos con ≥50% son tus estrellas — priorizalos en MercadoLibre y promos.
              {realStats.negativo > 0 && (
                <> <span className="text-[#EF4444]">{realStats.negativo} productos tienen margen negativo</span> — revisalos antes del próximo export a Odoo, están generando pérdida en cada venta.</>
              )}
              {realStats.bajo > 0 && (
                <> Los {realStats.bajo} con margen bajo son los que más impactan tu rentabilidad media — un ajuste de 5% de precio en esos te levanta el promedio significativamente.</>
              )}
            </p>
          </div>
        </div>
      </div>

      <div className="px-4 lg:px-6 mb-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* ── Simulador ── */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-xl border border-gray-100 p-5 lg:sticky lg:top-16">
              <div className="flex items-center gap-2 mb-4">
                <Calculator className="w-4 h-4 text-acqua" />
                <h2 className="text-sm font-bold text-gray-900">Simulador de precio</h2>
              </div>
              <p className="text-xs text-gray-500 mb-4">&quot;Qué pasa si lo vendo a...&quot;</p>

              <div className="space-y-3">
                <div>
                  <label className="text-[10px] text-gray-400 font-semibold uppercase">Costo final s/IVA</label>
                  <input
                    type="number" value={simCost} onChange={e => setSimCost(e.target.value)}
                    className="w-full mt-1 px-3 py-2.5 rounded-lg border border-gray-200 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-acqua/30"
                    placeholder="10000"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-gray-400 font-semibold uppercase">Precio Lista A c/IVA</label>
                  <input
                    type="number" value={simPrice} onChange={e => setSimPrice(e.target.value)}
                    className="w-full mt-1 px-3 py-2.5 rounded-lg border border-gray-200 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-acqua/30"
                    placeholder="19990"
                  />
                </div>
              </div>

              {price > 0 && (
                <div className="mt-5 space-y-3">
                  <div className="h-px bg-gray-100" />
                  <div className={cn('rounded-xl p-4', margin >= 40 ? 'bg-success/10' : margin >= 25 ? 'bg-warning/10' : 'bg-danger/10')}>
                    <div className="text-[10px] text-gray-400 font-semibold uppercase mb-1">Margen Lista A</div>
                    <div className={cn('text-3xl font-bold', margin >= 40 ? 'text-success' : margin >= 25 ? 'text-warning' : 'text-danger')}>
                      {margin.toFixed(1)}%
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="bg-gray-50 rounded-lg p-3">
                      <div className="text-[10px] text-gray-400 font-semibold">Utilidad</div>
                      <div className="text-sm font-bold text-gray-900">${Math.round(utility).toLocaleString('es-AR')}</div>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-3">
                      <div className="text-[10px] text-gray-400 font-semibold">Markup</div>
                      <div className="text-sm font-bold text-gray-900">{markup.toFixed(1)}%</div>
                    </div>
                  </div>
                  <div className="h-px bg-gray-100" />
                  <div className="space-y-2">
                    {[
                      { label: 'Lista A',       val: price },
                      { label: 'Lista B (-10%)', val: listB },
                      { label: 'Lista C (-15%)', val: listC },
                      { label: 'Profesional A', val: Math.ceil((price * 0.95) / 10 * 10) },
                      { label: 'Consorcio',     val: Math.ceil((price * 1.1) / 10 * 10) },
                    ].map(r => (
                      <div key={r.label} className="flex justify-between text-xs">
                        <span className="text-gray-500">{r.label}</span>
                        <span className="font-semibold text-gray-900">${r.val.toLocaleString('es-AR')}</span>
                      </div>
                    ))}
                  </div>
                  <div className={cn('rounded-lg p-3 mt-2',
                    margin >= 40 ? 'bg-success/5 border border-success/20' :
                    margin >= 25 ? 'bg-warning/5 border border-warning/20' :
                    'bg-danger/5 border border-danger/20',
                  )}>
                    <div className="flex items-start gap-2">
                      <Lightbulb className="w-3.5 h-3.5 mt-0.5 text-gray-500" />
                      <p className="text-xs text-gray-600">
                        {margin >= 40 ? 'Precio equilibrado con buen margen. Apto para todas las listas.' :
                         margin >= 25 ? 'Margen aceptable para Lista A y B. Lista C queda justa. Desactivar Profesional.' :
                         'Margen muy bajo. No ofrecer Lista C ni Profesional. Revisar costo o subir precio.'}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ── Tabla de rentabilidad — datos reales ── */}
          <div className="lg:col-span-2">

            {/* KPIs */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mb-4">
              {[
                { label: 'Total c/margen', val: realStats.conMargen, color: 'text-gray-900' },
                { label: 'Margen negativo', val: realStats.negativo, color: 'text-danger' },
                { label: 'Margen bajo',     val: realStats.bajo,     color: 'text-warning' },
                { label: 'Margen ok',       val: realStats.ok + realStats.bueno, color: 'text-success' },
              ].map(k => (
                <div key={k.label} className="bg-white rounded-xl border border-gray-100 p-4 text-center">
                  <div className={cn('text-2xl font-bold', k.color)}>{k.val}</div>
                  <div className="text-xs text-gray-500 mt-1">{k.label}</div>
                </div>
              ))}
            </div>

            {/* Filtros de margen + búsqueda */}
            <div className="flex flex-col sm:flex-row gap-3 mb-3">
              <div className="flex items-center gap-1 bg-white rounded-lg border border-gray-200 p-1 flex-wrap">
                {filterTabs.map(t => (
                  <button
                    key={t.key}
                    onClick={() => setMarginFilter(t.key)}
                    className={cn(
                      'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-colors',
                      marginFilter === t.key
                        ? (t.key === 'negMargin' ? 'bg-danger text-white' :
                           t.key === 'lowMargin' ? 'bg-warning text-white' :
                           t.key === 'okMargin'  ? 'bg-success text-white' : 'bg-gray-900 text-white')
                        : 'text-gray-500 hover:text-gray-700',
                    )}
                  >
                    {t.label}
                    {t.count !== undefined && (
                      <span className={cn(
                        'text-[10px] font-bold px-1.5 py-0.5 rounded-full',
                        marginFilter === t.key ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-500',
                      )}>
                        {t.count}
                      </span>
                    )}
                  </button>
                ))}
              </div>
              <div className="relative flex-1">
                <input
                  type="text" value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Buscar…"
                  className="w-full pl-4 pr-4 py-2 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-acqua/30"
                />
              </div>
            </div>

            {/* Tabla */}
            <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
                <h3 className="text-sm font-bold text-gray-900">
                  Rentabilidad real — {filteredProducts.length} productos
                </h3>
                {(marginFilter === 'negMargin' || marginFilter === 'lowMargin') && (
                  <span className="text-[11px] text-gray-400">Ordenados por margen ↑</span>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="text-[11px] text-gray-400 font-semibold uppercase tracking-wider border-b border-gray-100 select-none">
                      <th className="text-left px-5 py-3 relative group/th" style={{ width: colW.producto, minWidth: 120 }}>Producto<div className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize opacity-0 group-hover/th:opacity-100 hover:bg-acqua/40 transition-opacity" onMouseDown={startResize('producto')} /></th>
                      <th className="text-right px-3 py-3 relative group/th" style={{ width: colW.costo, minWidth: 70 }}>Costo<div className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize opacity-0 group-hover/th:opacity-100 hover:bg-acqua/40 transition-opacity" onMouseDown={startResize('costo')} /></th>
                      <th className="text-right px-3 py-3 relative group/th" style={{ width: colW.listaA, minWidth: 70 }}>Lista A<div className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize opacity-0 group-hover/th:opacity-100 hover:bg-acqua/40 transition-opacity" onMouseDown={startResize('listaA')} /></th>
                      <th className="text-right px-3 py-3 relative group/th" style={{ width: colW.listaB, minWidth: 70 }}>Lista B<div className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize opacity-0 group-hover/th:opacity-100 hover:bg-acqua/40 transition-opacity" onMouseDown={startResize('listaB')} /></th>
                      <th className="text-right px-3 py-3 relative group/th" style={{ width: colW.listaC, minWidth: 70 }}>Lista C<div className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize opacity-0 group-hover/th:opacity-100 hover:bg-acqua/40 transition-opacity" onMouseDown={startResize('listaC')} /></th>
                      <th className="text-center px-3 py-3 relative group/th" style={{ width: colW.margen, minWidth: 70 }}>Margen<div className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize opacity-0 group-hover/th:opacity-100 hover:bg-acqua/40 transition-opacity" onMouseDown={startResize('margen')} /></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {filteredProducts.slice(0, 80).map(p => {
                      const mg = p.margin ?? 0;
                      const lB = Math.ceil((p.price * 0.9) / 10) * 10;
                      const lC = Math.ceil((p.price * 0.85) / 10) * 10;
                      return (
                        <tr key={p.id} className={cn(
                          'hover:bg-gray-50/50 transition-colors',
                          mg < 0 && 'bg-danger/5',
                        )}>
                          <td className="px-5 py-3.5">
                            <div className="text-sm font-medium text-gray-900 line-clamp-1">{p.name}</div>
                            <div className="text-[10px] text-gray-400">
                              {p.supplierName?.split(' ').slice(0, 2).join(' ') || '—'}
                              {p.sku && ` · ${p.sku}`}
                            </div>
                          </td>
                          <td className="px-3 py-3.5 text-right text-sm font-mono text-gray-600">
                            {p.cost > 0 ? `$${p.cost.toLocaleString('es-AR')}` : <span className="text-gray-400">—</span>}
                          </td>
                          <td className="px-3 py-3.5 text-right text-sm font-mono font-semibold text-gray-900">
                            {p.price > 0 ? `$${p.price.toLocaleString('es-AR')}` : <span className="text-gray-400">—</span>}
                          </td>
                          <td className="px-3 py-3.5 text-right text-sm font-mono text-gray-600">
                            {p.price > 0 ? `$${lB.toLocaleString('es-AR')}` : <span className="text-gray-400">—</span>}
                          </td>
                          <td className="px-3 py-3.5 text-right text-sm font-mono text-gray-600">
                            {p.price > 0 ? `$${lC.toLocaleString('es-AR')}` : <span className="text-gray-400">—</span>}
                          </td>
                          <td className="px-3 py-3.5 text-center">
                            <span className={cn(
                              'text-sm font-bold',
                              mg < 0 ? 'text-danger' : mg < 30 ? 'text-warning' : mg < 50 ? 'text-gray-700' : 'text-success',
                            )}>
                              {mg.toFixed(1)}%
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {filteredProducts.length === 0 && (
                <div className="px-5 py-8 text-center text-sm text-gray-400">
                  No hay productos para este filtro.
                </div>
              )}
              {filteredProducts.length > 80 && (
                <div className="px-5 py-3 border-t border-gray-100 text-center text-xs text-gray-400">
                  Mostrando 80 de {filteredProducts.length} — refiná la búsqueda para ver más
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
    </div>
  );
}
