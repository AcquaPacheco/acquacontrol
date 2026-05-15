'use client';

import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import {
  Settings, Package, Users, FileSpreadsheet,
  CheckCircle2, ArrowRight, ChevronRight,
  DollarSign, TrendingDown, AlertTriangle,
  XCircle, Lightbulb, Circle,
} from 'lucide-react';
import Link from 'next/link';
import productsData    from '@/data/products.json';
import odooSupData     from '@/data/odoo-supplierinfo.json';
import suppliersData   from '@/data/suppliers.json';
import stockData       from '@/data/stock.json';

// ─── Tipos ────────────────────────────────────────────────────────────────────
interface RawProduct {
  id: string; sku: string | null; name: string;
  cost: number; price: number; margin: number | null;
  supplierName: string | null; odooId: number | null;
}
interface OdooSup { name: string; slug: string; count: number }

const products  = productsData  as unknown as RawProduct[];
const odooSup   = odooSupData   as unknown as OdooSup[];
const suppliers = suppliersData as unknown as { id: string; name: string }[];
const stock     = stockData     as unknown as { id: string }[];

// ─── Checklist de pasos ───────────────────────────────────────────────────────
function useSteps() {
  return useMemo(() => {
    const hasParams    = true; // parámetros siempre están (tienen defaults)
    const hasSuppliers = suppliers.length > 0;
    const hasProducts  = products.length > 0;
    const hasStock     = stock.length > 0;
    const hasLists     = odooSup.some(s => s.count > 0);

    // Calcular stats reales si hay datos
    const sinCosto       = products.filter(p => !p.cost || p.cost === 0).length;
    const margenCritico  = products.filter(p => p.cost > 0 && p.price > 0 && (p.margin === null || p.margin < 35)).length;
    const supplierNames  = new Set(products.filter(p => p.supplierName).map(p => p.supplierName!));
    const conLista       = odooSup.filter(s => s.count > 0).length;

    return {
      hasParams, hasSuppliers, hasProducts, hasStock, hasLists,
      sinCosto, margenCritico, conLista,
      totalProducts: products.length,
      totalSuppliers: suppliers.length,
      totalLists: odooSup.length,
      totalStock: stock.length,
      suppliersWithProds: supplierNames.size,
      allDone: hasSuppliers && hasProducts && hasLists,
    };
  }, []);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const today = new Date().toLocaleDateString('es-AR', {
  weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
});

// ─── Onboarding step card ─────────────────────────────────────────────────────
function StepCard({
  num, done, active, title, subtitle, desc, href, cta, children,
}: {
  num: number; done: boolean; active: boolean;
  title: string; subtitle?: string; desc: string;
  href: string; cta: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={cn(
      'bg-white rounded-2xl border p-6 transition-all',
      done    ? 'border-success/30' :
      active  ? 'border-acqua/40 shadow-lg shadow-acqua/5 ring-1 ring-acqua/20' :
                'border-gray-200 opacity-60',
    )}>
      <div className="flex items-start gap-4">
        {/* Número / check */}
        <div className={cn(
          'w-10 h-10 rounded-xl flex items-center justify-center text-sm font-black shrink-0 mt-0.5',
          done   ? 'bg-success text-white' :
          active ? 'bg-acqua text-white' :
                   'bg-gray-100 text-gray-400',
        )}>
          {done ? <CheckCircle2 className="w-5 h-5" /> : num}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <h3 className={cn(
              'text-sm font-bold',
              done ? 'text-success' : active ? 'text-gray-900' : 'text-gray-500',
            )}>
              {title}
            </h3>
            {subtitle && (
              <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">{subtitle}</span>
            )}
            {done && (
              <span className="text-[10px] font-bold text-success bg-success/10 px-2 py-0.5 rounded-full ml-auto">
                ✓ Completado
              </span>
            )}
            {active && !done && (
              <span className="text-[10px] font-bold text-acqua bg-acqua/10 px-2 py-0.5 rounded-full ml-auto animate-pulse">
                ← Próximo paso
              </span>
            )}
          </div>
          <p className="text-[12px] text-gray-500 leading-relaxed mb-3">{desc}</p>
          {children && <div className="mb-3">{children}</div>}
          {!done && active && (
            <Link href={href}
              className="inline-flex items-center gap-2 px-4 py-2 bg-acqua text-white text-[12px] font-bold rounded-xl hover:bg-acqua-dark transition-colors"
            >
              {cta} <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          )}
          {done && (
            <Link href={href}
              className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-success hover:text-success/80 transition-colors"
            >
              Ver / editar <ArrowRight className="w-3 h-3" />
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Dashboard cuando ya hay datos ────────────────────────────────────────────
function Dashboard({ s }: { s: ReturnType<typeof useSteps> }) {
  const kpis = [
    {
      label: 'Productos',
      value: String(s.totalProducts),
      sub: `${s.sinCosto > 0 ? s.sinCosto + ' sin costo' : 'todos con costo'}`,
      icon: Package,
      color: s.sinCosto > 0 ? 'bg-warning/10 text-warning' : 'bg-success/10 text-success',
      href: '/productos',
    },
    {
      label: 'Proveedores',
      value: String(s.totalSuppliers),
      sub: `${s.conLista} con lista cargada`,
      icon: Users,
      color: 'bg-acqua/10 text-acqua',
      href: '/proveedores',
    },
    {
      label: 'Margen crítico',
      value: String(s.margenCritico),
      sub: 'productos con margen < 35%',
      icon: TrendingDown,
      color: s.margenCritico > 0 ? 'bg-danger/10 text-danger' : 'bg-success/10 text-success',
      href: '/rentabilidad',
    },
    {
      label: 'Costos a revisar',
      value: String(s.sinCosto),
      sub: 'productos con costo $0',
      icon: DollarSign,
      color: s.sinCosto > 0 ? 'bg-danger/10 text-danger' : 'bg-success/10 text-success',
      href: '/costos',
    },
  ];

  const alertas = [];
  if (s.sinCosto > 0) alertas.push({
    prioridad: 'alta' as const,
    titulo: `${s.sinCosto} productos sin costo`,
    dato: `Hay ${s.sinCosto} productos con costo $0. Subí la lista del proveedor para actualizarlos.`,
    href: '/costos', cta: 'Ir a Costos',
  });
  if (s.margenCritico > 0) alertas.push({
    prioridad: 'media' as const,
    titulo: `${s.margenCritico} productos con margen < 35%`,
    dato: `Revisá si el costo fue actualizado. Si subió el costo y no ajustaste precio, perdés margen.`,
    href: '/rentabilidad', cta: 'Ver Rentabilidad',
  });
  if (!s.hasStock) alertas.push({
    prioridad: 'media' as const,
    titulo: 'Sin stock cargado',
    dato: 'Importá el archivo de stock desde Odoo para ver cantidades disponibles.',
    href: '/parametros', cta: 'Importar stock',
  });

  return (
    <div className="px-4 lg:px-6 mt-4 mb-10">
      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {kpis.map((kpi, i) => {
          const Icon = kpi.icon;
          return (
            <a key={i} href={kpi.href}
              className="bg-white rounded-xl border border-gray-100 p-5 card-hover group cursor-pointer block">
              <div className="flex items-center justify-between mb-3">
                <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center', kpi.color)}>
                  <Icon className="w-4.5 h-4.5" />
                </div>
                <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-gray-600 transition-colors" />
              </div>
              <div className="text-2xl lg:text-3xl font-bold text-gray-900 tracking-tight">{kpi.value}</div>
              <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mt-1">{kpi.label}</div>
              <div className="text-[10px] text-gray-400 mt-0.5">{kpi.sub}</div>
            </a>
          );
        })}
      </div>

      {/* Alertas + accesos rápidos */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 space-y-3">
          <h2 className="text-sm font-bold text-gray-900 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-danger" />
            Alertas del sistema
          </h2>
          {alertas.length === 0 ? (
            <div className="bg-white rounded-xl border border-success/20 p-6 text-center">
              <CheckCircle2 className="w-8 h-8 text-success mx-auto mb-2" />
              <p className="text-sm font-bold text-gray-900">Sin alertas activas</p>
              <p className="text-xs text-gray-400 mt-1">Todos los datos están en orden.</p>
            </div>
          ) : alertas.map((a, i) => (
            <div key={i} className={cn(
              'bg-white rounded-xl border p-4',
              a.prioridad === 'alta' ? 'border-danger/20' : 'border-warning/20',
            )}>
              <div className="flex items-center gap-2 mb-2">
                {a.prioridad === 'alta'
                  ? <XCircle className="w-4 h-4 text-danger" />
                  : <AlertTriangle className="w-4 h-4 text-warning" />}
                <span className={cn('text-[10px] font-bold uppercase tracking-wider',
                  a.prioridad === 'alta' ? 'text-danger' : 'text-warning')}>
                  {a.prioridad === 'alta' ? 'Urgente' : 'Atención'}
                </span>
              </div>
              <h3 className="text-sm font-semibold text-gray-900 mb-2">{a.titulo}</h3>
              <div className="flex items-start gap-1.5 mb-3">
                <Lightbulb className="w-3.5 h-3.5 text-warning mt-0.5 shrink-0" />
                <p className="text-xs text-gray-500 italic">{a.dato}</p>
              </div>
              <a href={a.href}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-acqua hover:text-acqua-dark">
                {a.cta} <ArrowRight className="w-3 h-3" />
              </a>
            </div>
          ))}
        </div>

        {/* Accesos rápidos */}
        <div className="space-y-3">
          <h2 className="text-sm font-bold text-gray-900">Módulos</h2>
          {[
            { label: 'Proveedores',  icon: Users,          href: '/proveedores', sub: `${s.totalSuppliers} importados` },
            { label: 'Productos',    icon: Package,         href: '/productos',   sub: `${s.totalProducts} productos` },
            { label: 'Costos',       icon: DollarSign,      href: '/costos',      sub: `${s.sinCosto} sin costo` },
            { label: 'Rentabilidad', icon: TrendingDown,    href: '/rentabilidad',sub: `${s.margenCritico} críticos` },
            { label: 'Export Odoo',  icon: FileSpreadsheet, href: '/export-odoo', sub: 'Exportar a Odoo' },
            { label: 'Parámetros',   icon: Settings,        href: '/parametros',  sub: 'Configuración' },
          ].map((m, i) => {
            const Icon = m.icon;
            return (
              <a key={i} href={m.href}
                className="flex items-center gap-3 bg-white border border-gray-100 rounded-xl px-4 py-3 hover:shadow-md transition-all group card-hover">
                <div className="w-8 h-8 rounded-lg bg-gray-50 flex items-center justify-center shrink-0 group-hover:bg-acqua/10 transition-colors">
                  <Icon className="w-4 h-4 text-gray-500 group-hover:text-acqua transition-colors" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] font-bold text-gray-900">{m.label}</div>
                  <div className="text-[10px] text-gray-400">{m.sub}</div>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-gray-500 transition-colors" />
              </a>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function ControlPage() {
  const s = useSteps();

  // Detectar primer paso activo (sin hacer)
  const steps = [
    { key: 'params',    done: s.hasParams },
    { key: 'import',    done: s.hasSuppliers && s.hasProducts },
    { key: 'lists',     done: s.hasLists },
  ];
  const firstActiveIdx = steps.findIndex(st => !st.done);

  return (
    <div className="min-h-screen">
    <div className="max-w-[1680px] mx-auto">

      {/* ── HERO ──────────────────────────────────────────────────── */}
      <div className="px-4 lg:px-6 pt-4">
        <div className="relative rounded-2xl overflow-hidden min-h-[120px] bg-gradient-to-r from-gray-950 via-gray-900 to-gray-800">
          <div className="absolute inset-0 opacity-20"
            style={{ backgroundImage: 'radial-gradient(circle at 70% 50%, #0EA5E9 0%, transparent 60%)' }} />
          <div className="relative z-10 px-8 py-6">
            <p className="text-white/40 text-xs font-medium mb-1 uppercase tracking-widest">Centro de Control</p>
            <h1 className="text-3xl lg:text-4xl font-bold text-white tracking-tight">Acqua Control OS</h1>
            <p className="text-white/50 text-sm mt-1 capitalize">{today}</p>
          </div>
        </div>
      </div>

      {/* ── ONBOARDING — mientras no haya todos los datos ─────────── */}
      {!s.allDone && (
        <div className="px-4 lg:px-6 mt-5 mb-10">
          <div className="max-w-2xl">
            <div className="mb-5">
              <h2 className="text-base font-bold text-gray-900 mb-1">Configuración inicial</h2>
              <p className="text-[13px] text-gray-500">
                Seguí estos pasos en orden para que el sistema empiece a calcular márgenes y alertas reales.
              </p>
            </div>

            <div className="space-y-3">

              {/* PASO 1 — Parámetros */}
              <StepCard
                num={1}
                done={false}
                active={firstActiveIdx === 0}
                title="Configurar parámetros"
                subtitle="Tipo de cambio · Markups · Listas de precios"
                desc="Configurá el dólar operativo, los porcentajes de markup por lista (A, B, Profesional) y los medios de pago. Esto define cómo se calculan los precios en todo el sistema."
                href="/parametros"
                cta="Ir a Parámetros"
              />

              {/* PASO 2 — Importar */}
              <StepCard
                num={2}
                done={s.hasSuppliers && s.hasProducts}
                active={firstActiveIdx === 1}
                title="Importar desde Odoo"
                subtitle="Proveedores · Productos · Stock"
                desc="Exportá los tres archivos desde Odoo e importálos acá. El sistema los cruza automáticamente: cada producto queda vinculado a su proveedor con costo y precio."
                href="/parametros"
                cta="Importar datos"
              >
                {/* Sub-checklist */}
                <div className="space-y-1.5 mt-1">
                  {[
                    {
                      label: 'Proveedores (res.partner)',
                      done: s.hasSuppliers,
                      count: s.hasSuppliers ? `${s.totalSuppliers} importados` : 'Exportar de Odoo → Contactos → Proveedores',
                    },
                    {
                      label: 'Productos (product.template)',
                      done: s.hasProducts,
                      count: s.hasProducts ? `${s.totalProducts} importados` : 'Exportar de Odoo → Inventario → Productos',
                    },
                    {
                      label: 'Stock (stock.quant)',
                      done: s.hasStock,
                      count: s.hasStock ? `${s.totalStock} registros` : 'Exportar de Odoo → Inventario → Stock actual',
                    },
                  ].map((item, i) => (
                    <div key={i} className={cn(
                      'flex items-center gap-2.5 px-3 py-2 rounded-lg text-[12px]',
                      item.done ? 'bg-success/5' : 'bg-gray-50',
                    )}>
                      {item.done
                        ? <CheckCircle2 className="w-3.5 h-3.5 text-success shrink-0" />
                        : <Circle className="w-3.5 h-3.5 text-gray-300 shrink-0" />
                      }
                      <span className={cn('font-semibold', item.done ? 'text-success' : 'text-gray-700')}>
                        {item.label}
                      </span>
                      <span className="text-gray-400 ml-auto text-[11px]">{item.count}</span>
                    </div>
                  ))}
                </div>
              </StepCard>

              {/* PASO 3 — Listas de precios */}
              <StepCard
                num={3}
                done={s.hasLists}
                active={firstActiveIdx === 2}
                title="Cargar listas de precios"
                subtitle="Por proveedor · Detecta formato automáticamente"
                desc="Entrá al detalle de cada proveedor y subí su lista de precios (Excel, PDF o imagen). El sistema detecta el formato, compara con los costos actuales y te muestra qué subió, qué bajó y qué es promo."
                href="/proveedores"
                cta="Ir a Proveedores"
              >
                {s.hasSuppliers && (
                  <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg text-[12px]">
                    <span className="text-gray-600 font-semibold">{s.totalSuppliers} proveedores listos</span>
                    <span className="text-gray-400">·</span>
                    <span className={cn('font-semibold', s.conLista > 0 ? 'text-success' : 'text-gray-400')}>
                      {s.conLista} con lista cargada
                    </span>
                  </div>
                )}
              </StepCard>

            </div>

            {/* Tip */}
            <div className="mt-4 flex items-start gap-2 px-4 py-3 bg-acqua/5 border border-acqua/20 rounded-xl">
              <Lightbulb className="w-4 h-4 text-acqua mt-0.5 shrink-0" />
              <p className="text-[12px] text-acqua leading-relaxed">
                <strong>Una sola vez:</strong> una vez que importás los datos de Odoo, el sistema los recuerda.
                Las actualizaciones futuras solo requieren subir la lista nueva del proveedor — el resto es automático.
              </p>
            </div>
          </div>

          {/* Si ya tienen proveedores/productos aunque no todo completo, mostrar accesos */}
          {(s.hasSuppliers || s.hasProducts) && (
            <div className="mt-8 max-w-2xl">
              <h3 className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-3">Acceso rápido</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {[
                  { label: 'Proveedores', icon: Users,          href: '/proveedores', sub: `${s.totalSuppliers}` },
                  { label: 'Productos',   icon: Package,         href: '/productos',   sub: `${s.totalProducts}` },
                  { label: 'Costos',      icon: DollarSign,      href: '/costos',      sub: '' },
                  { label: 'Parámetros',  icon: Settings,        href: '/parametros',  sub: '' },
                  { label: 'Rentabilidad',icon: TrendingDown,    href: '/rentabilidad',sub: '' },
                  { label: 'Export Odoo', icon: FileSpreadsheet, href: '/export-odoo', sub: '' },
                ].map((a, i) => {
                  const Icon = a.icon;
                  return (
                    <a key={i} href={a.href}
                      className="flex items-center gap-2 bg-white border border-gray-100 rounded-xl px-3 py-2.5 hover:border-acqua/30 hover:shadow-sm transition-all group">
                      <div className="w-7 h-7 rounded-lg bg-gray-50 flex items-center justify-center shrink-0 group-hover:bg-acqua/10 transition-colors">
                        <Icon className="w-3.5 h-3.5 text-gray-500 group-hover:text-acqua transition-colors" />
                      </div>
                      <div>
                        <div className="text-[12px] font-semibold text-gray-800">{a.label}</div>
                        {a.sub && <div className="text-[10px] text-gray-400">{a.sub}</div>}
                      </div>
                    </a>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── DASHBOARD — cuando ya hay todos los datos ──────────────── */}
      {s.allDone && <Dashboard s={s} />}

    </div>
    </div>
  );
}
