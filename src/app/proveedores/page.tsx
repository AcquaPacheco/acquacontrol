'use client';

import { useState, useMemo, useEffect } from 'react';
// Colores por rubro (inline — sin dependencia de mock-suppliers)
const rubroColors: Record<string, string> = {
  'Pileta & Química':        'bg-cyan-600 text-white',
  'Pileta & Limpieza':       'bg-cyan-700 text-white',
  'Pileta & Tratamiento':    'bg-sky-600 text-white',
  'Mangueras & Riego':       'bg-orange-600 text-white',
  'Riego & Jardinería':      'bg-green-600 text-white',
  'Jardín':                  'bg-emerald-600 text-white',
  'Limpieza':                'bg-blue-600 text-white',
  'Limpieza & Hogar':        'bg-blue-700 text-white',
  'Perfumería & Hogar':      'bg-purple-600 text-white',
  'Perfumería & Fragancias': 'bg-pink-600 text-white',
  'Papelera':                'bg-amber-600 text-white',
  'Química':                 'bg-red-600 text-white',
  'Almacén & Mascotas':      'bg-green-700 text-white',
  'default':                 'bg-zinc-600 text-white',
};
import productsData from '@/data/products.json';
import odooSuppliersRaw from '@/data/odoo-supplierinfo.json';
import suppliersContactsRaw from '@/data/suppliers.json';
import {
  Search, LayoutGrid, List, Upload, AlertCircle, CheckCircle2,
  ArrowRight, Package, ChevronDown, X,
  Database, Phone, RefreshCw,
} from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { useSettings, buildOdooImageUrl } from '@/lib/use-settings';

// ── Tipos
interface RealProd { id: string; cost: number; price: number; image: string | null; supplierName: string | null; odooId: number | null; }
interface Contact { id: string; name: string; slug: string; phone: string | null; tags: string[]; fiscalCondition: string | null; odooId?: number | null; }
type OdooSup = { name: string; slug: string; count: number };

// ── Datos cargados desde JSON
const realProducts    = productsData as unknown as RealProd[];
const odooSuppIndex   = odooSuppliersRaw as unknown as Array<OdooSup & { products: unknown[] }>;
const suppliersContacts = suppliersContactsRaw as unknown as Contact[];
const hasRealContacts = suppliersContacts.length > 0;

// ── Índices de cruce
const nameToSlug      = new Map(odooSuppIndex.map(s => [s.name, s.slug]));
const nameToOdooCount = new Map(odooSuppIndex.map(s => [s.name, s.count]));

// ── Enriquecer contacts con stats de productos
interface EnrichedContact extends Contact {
  rubro: string;
  totalProducts: number;
  sinCosto: number;
  sinPrecio: number;
  sinImagen: number;
  odooListCount: number;
}

function buildEnrichedContacts(): EnrichedContact[] {
  // Stats por supplierName desde products.json
  const statsMap = new Map<string, { total: number; sinCosto: number; sinPrecio: number; sinImagen: number }>();
  realProducts.forEach(p => {
    if (!p.supplierName) return;
    if (!statsMap.has(p.supplierName)) statsMap.set(p.supplierName, { total: 0, sinCosto: 0, sinPrecio: 0, sinImagen: 0 });
    const s = statsMap.get(p.supplierName)!;
    s.total++;
    if (!p.cost || p.cost === 0) s.sinCosto++;
    if (!p.price || p.price === 0) s.sinPrecio++;
    if (!p.image && !p.odooId) s.sinImagen++; // tiene imagen si hay base64 o odooId para URL de Odoo
  });

  return suppliersContacts.map(c => {
    // rubro = primer tag que no sea "Proveedor"
    const rubro = c.tags.find(t => !['Proveedor', 'Cliente', 'Empleado'].includes(t)) || 'Sin rubro';
    const stats = statsMap.get(c.name) || { total: 0, sinCosto: 0, sinPrecio: 0, sinImagen: 0 };
    const slug  = c.slug || nameToSlug.get(c.name) || c.id;
    return {
      ...c,
      slug,
      rubro,
      totalProducts:  stats.total,
      sinCosto:       stats.sinCosto,
      sinPrecio:      stats.sinPrecio,
      sinImagen:      stats.sinImagen,
      odooListCount:  nameToOdooCount.get(c.name) || 0,
    };
  }).sort((a, b) => b.totalProducts - a.totalProducts);
}

const enrichedContacts = buildEnrichedContacts();

// ── Proveedores reales (para pestaña Inteligencia — basado en products.json)
interface RealSupplier {
  name: string; slug: string | null; totalProducts: number;
  sinCosto: number; sinImagen: number; sinPrecio: number; odooCount: number;
}

function buildRealSuppliers(): RealSupplier[] {
  const map = new Map<string, { total: number; sinCosto: number; sinImagen: number; sinPrecio: number }>();
  realProducts.forEach(p => {
    if (!p.supplierName) return;
    if (!map.has(p.supplierName)) map.set(p.supplierName, { total: 0, sinCosto: 0, sinImagen: 0, sinPrecio: 0 });
    const s = map.get(p.supplierName)!;
    s.total++;
    if (!p.cost || p.cost === 0) s.sinCosto++;
    if (!p.image && !p.odooId) s.sinImagen++;
    if (!p.price || p.price === 0) s.sinPrecio++;
  });
  return Array.from(map.entries())
    .map(([name, stats]) => ({
      name, slug: nameToSlug.get(name) || null,
      totalProducts: stats.total, sinCosto: stats.sinCosto,
      sinImagen: stats.sinImagen, sinPrecio: stats.sinPrecio,
      odooCount: nameToOdooCount.get(name) || 0,
    }))
    .sort((a, b) => b.totalProducts - a.totalProducts);
}

const realSuppliers = buildRealSuppliers();

export default function ProveedoresPage() {
  const [search, setSearch] = useState('');
  const [rubroFilt, setRubroFilt] = useState('Todos');
  const [view, setView] = useState<'cards' | 'list'>('list');
  const [issuesOnly, setIssuesOnly] = useState(false);
  const [activeFilterBanner, setActiveFilterBanner] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'gestion' | 'inteligencia'>('gestion');

  // Odoo server URL para avatares de proveedor
  const { settings } = useSettings();
  const odooUrl = settings.odooServerUrl;

  const getSupImg = (c: { odooId?: number | null }) =>
    buildOdooImageUrl(c.odooId, 'res.partner', odooUrl);

  // Leer URL params al montar
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const filterParam = params.get('filter');
    const supplierParam = params.get('supplier');
    if (filterParam === 'issues') {
      setIssuesOnly(true);
      setActiveFilterBanner('issues');
      setView('list');
    }
    if (supplierParam) setSearch(supplierParam);
  }, []);

  // Rubros únicos de contacts
  const allRubros = useMemo(() =>
    ['Todos', ...Array.from(new Set(enrichedContacts.map(c => c.rubro))).sort()],
    [],
  );

  const filtered = useMemo(() => {
    return enrichedContacts.filter(c => {
      const q = search.toLowerCase();
      const matchSearch = !search
        || c.name.toLowerCase().includes(q)
        || c.rubro.toLowerCase().includes(q)
        || (c.phone ?? '').includes(q)
        || c.tags.some(t => t.toLowerCase().includes(q));
      const matchRubro  = rubroFilt === 'Todos' || c.rubro === rubroFilt;
      const matchIssues = !issuesOnly || c.sinCosto > 0 || c.sinPrecio > 0 || c.totalProducts === 0;
      return matchSearch && matchRubro && matchIssues;
    });
  }, [search, rubroFilt, issuesOnly]);

  const stats = useMemo(() => ({
    total:     enrichedContacts.length,
    conProds:  enrichedContacts.filter(c => c.totalProducts > 0).length,
    sinCosto:  enrichedContacts.filter(c => c.sinCosto > 0).length,
    conLista:  enrichedContacts.filter(c => c.odooListCount > 0).length,
  }), []);

  return (
    <div className="min-h-screen bg-surface">

      {/* Hero compacto */}
      <div className="bg-header border-b border-white/10 px-5 lg:px-8 xl:px-12 py-5">
        <div className="max-w-[1680px] mx-auto flex items-start justify-between gap-4">
          <div>
            <p className="text-white/40 text-[11px] font-semibold uppercase tracking-widest mb-1">Módulo</p>
            <h1 className="text-white font-bold text-2xl">Proveedores</h1>
            <p className="text-white/50 text-sm mt-0.5">
              {hasRealContacts
                ? `${stats.total} proveedores importados desde Odoo`
                : 'Cargá los datos desde Odoo para ver tus proveedores'}
            </p>
          </div>

          {/* Mini KPIs en hero */}
          {hasRealContacts && (
            <div className="hidden lg:flex items-center gap-6 shrink-0">
              <div className="text-center">
                <div className="text-2xl font-bold text-white">{stats.total}</div>
                <div className="text-[10px] text-white/40 uppercase tracking-wide">Total</div>
              </div>
              <div className="w-px h-8 bg-white/10" />
              <div className="text-center">
                <div className="text-2xl font-bold text-success">{stats.conProds}</div>
                <div className="text-[10px] text-white/40 uppercase tracking-wide">Con productos</div>
              </div>
              <div className="w-px h-8 bg-white/10" />
              <div className="text-center">
                <div className="text-2xl font-bold text-warning">{stats.sinCosto}</div>
                <div className="text-[10px] text-white/40 uppercase tracking-wide">Sin costo</div>
              </div>
              <div className="w-px h-8 bg-white/10" />
              <div className="text-center">
                <div className="text-2xl font-bold text-acqua">{stats.conLista}</div>
                <div className="text-[10px] text-white/40 uppercase tracking-wide">Con lista</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Tab switcher — debajo del hero */}
      <div className="border-b border-white/10 bg-header px-5 lg:px-8 xl:px-12">
        <div className="max-w-[1680px] mx-auto flex items-center gap-1">
          {[
            { key: 'gestion',       label: 'Gestión',         icon: Package },
            { key: 'inteligencia',  label: 'Inteligencia real', icon: Database },
          ].map(t => {
            const Icon = t.icon;
            return (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key as 'gestion' | 'inteligencia')}
                className={cn(
                  'flex items-center gap-1.5 px-4 py-3 text-[12px] font-semibold border-b-2 transition-colors',
                  activeTab === t.key
                    ? 'border-acqua text-white'
                    : 'border-transparent text-white/40 hover:text-white/70',
                )}
              >
                <Icon className="w-3.5 h-3.5" />
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="max-w-[1680px] mx-auto px-5 lg:px-8 xl:px-12 py-5">

        {/* Banner filtro activo */}
        {activeFilterBanner === 'issues' && (
          <div className="flex items-center gap-2 px-4 py-2.5 mb-4 bg-danger/10 border border-danger/30 rounded-xl text-sm text-danger font-medium">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>
              Filtrado desde el Socio Acqua — viendo solo <strong>{filtered.length} proveedores con problemas</strong>
              {' '}(listas vencidas, alertas o sin actualizar)
            </span>
            <button
              onClick={() => { setActiveFilterBanner(null); setIssuesOnly(false); }}
              className="ml-auto hover:bg-danger/20 rounded p-0.5 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* ── PESTAÑA INTELIGENCIA REAL ── */}
        {activeTab === 'inteligencia' && (
          <RealSupplierIntelligence />
        )}

        {activeTab === 'gestion' && (
          !hasRealContacts ? (
            /* ── ESTADO VACÍO ── */
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center mb-4">
                <Package className="w-8 h-8 text-gray-400" />
              </div>
              <h2 className="text-lg font-bold text-gray-700 mb-2">No hay proveedores cargados</h2>
              <p className="text-sm text-gray-400 max-w-sm mb-6 leading-relaxed">
                Importá el Excel de contactos desde Odoo (<code className="bg-gray-100 px-1 rounded text-[11px]">res.partner</code>)
                para ver tus proveedores acá.
              </p>
              <Link
                href="/parametros?section=datos"
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-acqua text-white font-semibold text-sm rounded-xl hover:bg-acqua-dark transition-colors"
              >
                <Upload className="w-4 h-4" />
                Ir a Parámetros → Importar
              </Link>
              <p className="text-[11px] text-gray-400 mt-4">
                También podés ir al tab <strong>Inteligencia real</strong> para ver proveedores detectados desde los productos importados.
              </p>
            </div>
          ) : (<>

          {/* Toolbar */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 mb-5">
            {/* Search */}
            <div className="relative flex-1 min-w-0">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar proveedor, rubro, teléfono…"
                className="w-full pl-9 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-acqua/30 focus:border-acqua"
              />
            </div>

            {/* Rubro filter */}
            <div className="relative">
              <select
                value={rubroFilt}
                onChange={(e) => setRubroFilt(e.target.value)}
                className="appearance-none pl-3 pr-8 py-2.5 bg-white border border-gray-200 rounded-xl text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-acqua/30 focus:border-acqua cursor-pointer"
              >
                {allRubros.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            </div>

            {/* View toggle */}
            <div className="flex bg-white border border-gray-200 rounded-xl overflow-hidden shrink-0">
              <button
                onClick={() => setView('cards')}
                className={cn('flex items-center gap-1.5 px-3 py-2.5 text-[12px] font-medium transition-colors',
                  view === 'cards' ? 'bg-gray-900 text-white' : 'text-gray-500 hover:text-gray-700')}
              >
                <LayoutGrid className="w-3.5 h-3.5" />
                Cards
              </button>
              <button
                onClick={() => setView('list')}
                className={cn('flex items-center gap-1.5 px-3 py-2.5 text-[12px] font-medium transition-colors',
                  view === 'list' ? 'bg-gray-900 text-white' : 'text-gray-500 hover:text-gray-700')}
              >
                <List className="w-3.5 h-3.5" />
                Lista
              </button>
            </div>

            {/* Filtro con problemas */}
            <button
              onClick={() => setIssuesOnly(!issuesOnly)}
              className={cn(
                'flex items-center gap-2 px-4 py-2.5 text-[12px] font-semibold rounded-xl transition-colors shrink-0 border',
                issuesOnly
                  ? 'bg-danger text-white border-danger'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-danger/40 hover:text-danger',
              )}
            >
              <AlertCircle className="w-3.5 h-3.5" />
              Con problemas
            </button>
          </div>

          {/* Result count */}
          <p className="text-[12px] text-gray-400 mb-4">
            Mostrando <span className="font-semibold text-gray-600">{filtered.length}</span> de {enrichedContacts.length} proveedores
            {rubroFilt !== 'Todos' && <> · <span className="text-acqua font-medium">{rubroFilt}</span></>}
          </p>

          {/* CARDS VIEW */}
          {view === 'cards' && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {filtered.map((c) => {
                const rubroColor = rubroColors[c.rubro] || rubroColors['default'] || 'bg-gray-100 text-gray-600';
                const hasIssues  = c.sinCosto > 0 || c.sinPrecio > 0 || c.totalProducts === 0;
                return (
                  <Link key={c.id} href={`/proveedores/${c.slug}`}
                    className="bg-white rounded-xl border border-gray-100 p-4 hover:shadow-md transition-all group">
                    <div className="flex items-start gap-2 mb-3">
                      <div className="w-10 h-10 rounded-lg bg-gray-900 flex items-center justify-center text-white font-black text-base shrink-0 overflow-hidden">
                        {getSupImg(c)
                          // eslint-disable-next-line @next/next/no-img-element
                          ? <img src={getSupImg(c)!} alt={c.name} className="w-full h-full object-cover" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                          : c.name.charAt(0)}
                      </div>
                      <div className="min-w-0">
                        <p className="text-[12px] font-bold text-gray-900 leading-tight truncate">{c.name}</p>
                        <span className={cn('inline-flex px-1.5 py-0.5 rounded text-[9px] font-bold mt-0.5', rubroColor)}>
                          {c.rubro}
                        </span>
                      </div>
                    </div>
                    {c.phone && (
                      <p className="text-[11px] text-gray-400 flex items-center gap-1 mb-2">
                        <Phone className="w-3 h-3" /> {c.phone}
                      </p>
                    )}
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="text-gray-600 font-semibold">{c.totalProducts} productos</span>
                      {hasIssues
                        ? <span className="text-danger font-semibold flex items-center gap-0.5"><AlertCircle className="w-3 h-3" /> issues</span>
                        : <span className="text-success font-semibold flex items-center gap-0.5"><CheckCircle2 className="w-3 h-3" /> OK</span>
                      }
                    </div>
                  </Link>
                );
              })}
            </div>
          )}

          {/* LIST VIEW */}
          {view === 'list' && (
            <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider border-b border-gray-100 bg-gray-50/50">
                      <th className="text-left px-5 py-3">Proveedor</th>
                      <th className="text-left px-3 py-3">Rubro / Tags</th>
                      <th className="text-left px-3 py-3">Teléfono</th>
                      <th className="text-center px-3 py-3">Prods.</th>
                      <th className="text-center px-3 py-3">Sin costo</th>
                      <th className="text-center px-3 py-3">Lista Odoo</th>
                      <th className="text-center px-3 py-3">Condición</th>
                      <th className="text-center px-3 py-3">Acción</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {filtered.map((c) => {
                      const rubroColor = rubroColors[c.rubro] || rubroColors['default'] || 'bg-gray-100 text-gray-600';
                      const hasIssues = c.sinCosto > 0 || c.sinPrecio > 0 || c.totalProducts === 0;
                      return (
                        <tr key={c.id} className="hover:bg-gray-50/50 transition-colors">
                          <td className="px-5 py-3.5">
                            <div className="flex items-center gap-3">
                              <div className="w-9 h-9 rounded-lg bg-gray-900 flex items-center justify-center text-white font-black text-sm shrink-0 overflow-hidden">
                                {getSupImg(c)
                                  // eslint-disable-next-line @next/next/no-img-element
                                  ? <img src={getSupImg(c)!} alt={c.name} className="w-full h-full object-cover" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                                  : c.name.charAt(0)}
                              </div>
                              <div className="text-[13px] font-semibold text-gray-900 leading-tight">{c.name}</div>
                            </div>
                          </td>
                          <td className="px-3 py-3.5">
                            <span className={cn('inline-flex px-2 py-0.5 rounded text-[10px] font-bold', rubroColor)}>
                              {c.rubro}
                            </span>
                          </td>
                          <td className="px-3 py-3.5">
                            {c.phone
                              ? <span className="text-[12px] text-gray-600 flex items-center gap-1"><Phone className="w-3 h-3 text-gray-400" />{c.phone}</span>
                              : <span className="text-gray-400 text-[11px]">—</span>}
                          </td>
                          <td className="px-3 py-3.5 text-center">
                            <span className={cn('text-[13px] font-bold', c.totalProducts > 0 ? 'text-gray-800' : 'text-gray-400')}>
                              {c.totalProducts || '—'}
                            </span>
                          </td>
                          <td className="px-3 py-3.5 text-center">
                            {c.sinCosto > 0
                              ? <span className="text-[12px] font-bold text-danger">{c.sinCosto}</span>
                              : <CheckCircle2 className="w-3.5 h-3.5 text-success mx-auto" />}
                          </td>
                          <td className="px-3 py-3.5 text-center">
                            <span className={cn('text-[12px] font-semibold', c.odooListCount > 0 ? 'text-gray-700' : 'text-gray-400')}>
                              {c.odooListCount > 0 ? c.odooListCount : '—'}
                            </span>
                          </td>
                          <td className="px-3 py-3.5 text-center">
                            <span className="text-[11px] text-gray-500">{c.fiscalCondition ?? '—'}</span>
                          </td>
                          <td className="px-3 py-3.5 text-center">
                            <Link
                              href={`/proveedores/${c.slug}`}
                              className="inline-flex items-center gap-1 px-3 py-1.5 bg-gray-900 text-white text-[11px] font-semibold rounded-lg hover:bg-gray-800 transition-colors"
                            >
                              Abrir
                              <ArrowRight className="w-3 h-3" />
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {filtered.length === 0 && (
                <p className="text-center py-8 text-sm text-gray-400">Sin resultados para ese filtro.</p>
              )}
            </div>
          )}
          </>)
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// INTELIGENCIA REAL — datos vivos de products.json + odoo-supplierinfo
// ─────────────────────────────────────────────────────────────────────────────

function RealSupplierIntelligence() {
  const [search, setSearch] = useState('');
  const [filterIssues, setFilterIssues] = useState(false);

  const displayed = useMemo(() => {
    let list = realSuppliers;
    if (filterIssues) list = list.filter(s => s.sinCosto > 0 || s.sinPrecio > 0);
    if (search) {
      const s = search.toLowerCase();
      list = list.filter(r => r.name.toLowerCase().includes(s));
    }
    return list;
  }, [search, filterIssues]);

  const globalStats = useMemo(() => ({
    total:    realSuppliers.length,
    issues:   realSuppliers.filter(s => s.sinCosto > 0).length,
    sinData:  realSuppliers.filter(s => !s.slug).length,
    conLista: realSuppliers.filter(s => s.odooCount > 0).length,
  }), []);

  return (
    <div className="space-y-4">
      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white rounded-xl border border-gray-100 p-4 text-center">
          <div className="text-2xl font-bold text-gray-900">{globalStats.total}</div>
          <div className="text-xs text-gray-500 mt-1">Proveedores en products.json</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-4 text-center">
          <div className="text-2xl font-bold text-danger">{globalStats.issues}</div>
          <div className="text-xs text-gray-500 mt-1">Con productos sin costo</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-4 text-center">
          <div className="text-2xl font-bold text-success">{globalStats.conLista}</div>
          <div className="text-xs text-gray-500 mt-1">Con lista de precios</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 p-4 text-center">
          <div className="text-2xl font-bold text-warning">{globalStats.sinData}</div>
          <div className="text-xs text-gray-500 mt-1">Sin ficha en sistema</div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Buscar proveedor…"
            className="w-full pl-9 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-acqua/30"
          />
        </div>
        <button
          onClick={() => setFilterIssues(!filterIssues)}
          className={cn(
            'flex items-center gap-2 px-4 py-2.5 text-[12px] font-semibold rounded-xl border transition-colors',
            filterIssues ? 'bg-danger text-white border-danger' : 'bg-white text-gray-600 border-gray-200 hover:border-danger/40 hover:text-danger',
          )}
        >
          <AlertCircle className="w-3.5 h-3.5" />
          Con problemas
        </button>
      </div>

      {/* Tabla */}
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
          <span className="text-sm font-bold text-gray-900">
            {displayed.length} proveedores reales
          </span>
          <span className="text-xs text-gray-400">Datos en vivo de products.json + odoo-supplierinfo</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider border-b border-gray-100 bg-gray-50/50">
                <th className="text-left px-5 py-3">Proveedor</th>
                <th className="text-center px-3 py-3">Prods. Odoo</th>
                <th className="text-center px-3 py-3">En sistema</th>
                <th className="text-center px-3 py-3">Sin costo</th>
                <th className="text-center px-3 py-3">Sin imagen</th>
                <th className="text-center px-3 py-3">Lista Odoo</th>
                <th className="text-center px-3 py-3">Ficha</th>
                <th className="text-center px-3 py-3">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {displayed.map(s => {
                const hasIssues = s.sinCosto > 0 || s.sinPrecio > 0;
                return (
                  <tr key={s.name} className={cn(
                    'hover:bg-gray-50/50 transition-colors',
                    hasIssues && 'bg-danger/3',
                  )}>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
                          <span className="text-[11px] font-black text-gray-500">{s.name.charAt(0)}</span>
                        </div>
                        <div>
                          <div className="text-[12px] font-semibold text-gray-900 leading-tight">{s.name}</div>
                          {s.slug && <div className="text-[10px] text-gray-400 font-mono">{s.slug}</div>}
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3.5 text-center">
                      <span className="text-[12px] font-semibold text-gray-700">{s.odooCount}</span>
                    </td>
                    <td className="px-3 py-3.5 text-center">
                      <span className="text-[12px] font-semibold text-gray-700">{s.totalProducts}</span>
                    </td>
                    <td className="px-3 py-3.5 text-center">
                      {s.sinCosto > 0 ? (
                        <span className="text-[12px] font-bold text-danger">{s.sinCosto}</span>
                      ) : (
                        <CheckCircle2 className="w-3.5 h-3.5 text-success mx-auto" />
                      )}
                    </td>
                    <td className="px-3 py-3.5 text-center">
                      <span className={cn(
                        'text-[12px] font-semibold',
                        s.sinImagen > 0 ? 'text-warning' : 'text-success',
                      )}>
                        {s.sinImagen > 0 ? s.sinImagen : '✓'}
                      </span>
                    </td>
                    <td className="px-3 py-3.5">
                      {s.odooCount > 0 ? (
                        <span className="text-[11px] font-semibold text-acqua">{s.odooCount} líneas</span>
                      ) : (
                        <span className="text-[11px] text-gray-400 italic">Sin lista</span>
                      )}
                    </td>
                    <td className="px-3 py-3.5 text-center">
                      {s.slug ? (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-success/10 text-success text-[10px] font-semibold rounded-full">
                          <CheckCircle2 className="w-3 h-3" /> Ficha
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-gray-100 text-gray-400 text-[10px] font-semibold rounded-full">
                          Sin ficha
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3.5 text-center">
                      {s.slug ? (
                        <Link
                          href={`/proveedores/${s.slug}`}
                          className="inline-flex items-center gap-1 px-3 py-1.5 bg-gray-900 text-white text-[11px] font-semibold rounded-lg hover:bg-gray-800 transition-colors"
                        >
                          Abrir <ArrowRight className="w-3 h-3" />
                        </Link>
                      ) : (
                        <button className="inline-flex items-center gap-1 px-3 py-1.5 bg-acqua text-white text-[11px] font-semibold rounded-lg hover:bg-acqua-dark transition-colors">
                          <RefreshCw className="w-3 h-3" /> Crear ficha
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {displayed.length === 0 && (
          <div className="px-5 py-8 text-center text-sm text-gray-400">No hay proveedores que coincidan.</div>
        )}
      </div>
    </div>
  );
}

