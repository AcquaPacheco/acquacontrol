'use client';

import { useState, useMemo } from 'react';
import { SocioAcquaPanel } from '@/components/shared/socio-acqua-panel';
import { cn } from '@/lib/utils';
import {
  DollarSign,
  FileSpreadsheet,
  Users,
  AlertTriangle,
  CheckCircle2,
  Circle,
  ArrowRight,
  Package,
  TrendingDown,
  ChevronRight,
  Lightbulb,
  RefreshCw,
  XCircle,
  Database,
  Upload,
} from 'lucide-react';
import Link from 'next/link';
import productsData    from '@/data/products.json';
import odooSupData     from '@/data/odoo-supplierinfo.json';
import suppliersContacts from '@/data/suppliers.json';

// ─── Tipos ────────────────────────────────────────────────────────────────────
interface RawProduct {
  id: string; sku: string | null; name: string;
  cost: number; price: number; margin: number | null;
  status: string; supplierName: string | null; odooId: number | null;
}

interface OdooSup { name: string; slug: string; count: number }

// ─── Data en vivo ─────────────────────────────────────────────────────────────
const products      = productsData   as unknown as RawProduct[];
const odooSup       = odooSupData    as unknown as OdooSup[];
const contacts      = suppliersContacts as unknown as { id: string; name: string }[];

// ─── Stats reales ─────────────────────────────────────────────────────────────
function computeStats() {
  const totalProducts     = products.length;
  const sinCosto          = products.filter(p => !p.cost || p.cost === 0).length;
  const sinPrecio         = products.filter(p => !p.price || p.price === 0).length;
  const margenCritico     = products.filter(p =>
    p.cost > 0 && p.price > 0 &&
    (p.margin === null || p.margin < 35)
  ).length;
  const supplierNames     = new Set(products.filter(p => p.supplierName).map(p => p.supplierName!));
  const uniqueSuppliers   = supplierNames.size;
  const totalContacts     = contacts.length;
  const conLista          = odooSup.filter(s => s.count > 0).length;
  const sinLista          = uniqueSuppliers > 0 ? uniqueSuppliers - conLista : 0;
  const totalOdooProds    = odooSup.reduce((a, s) => a + s.count, 0);

  // Proveedores sin precios recientes (sin lista cargada en supplierinfo)
  const supSinLista = Array.from(supplierNames)
    .filter(n => !odooSup.some(s => s.name === n || s.slug === n))
    .length;

  return {
    totalProducts, sinCosto, sinPrecio, margenCritico,
    uniqueSuppliers, totalContacts, conLista, sinLista: supSinLista,
    totalOdooProds, hasData: totalProducts > 0,
  };
}

const stats = computeStats();

// ─── Helpers ──────────────────────────────────────────────────────────────────
const today = new Date().toLocaleDateString('es-AR', {
  weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
});

// ─── Alertas generadas desde datos reales ─────────────────────────────────────
interface Alerta {
  id: string;
  prioridad: 'alta' | 'media' | 'baja';
  titulo: string;
  dato: string;
  lectura: string;
  accion: string;
  modulo: string;
  href: string;
}

function buildAlertas(): Alerta[] {
  const out: Alerta[] = [];

  if (stats.sinCosto > 0) {
    out.push({
      id: 'sin-costo',
      prioridad: 'alta',
      titulo: `${stats.sinCosto} productos sin costo actualizado`,
      dato: `Hay ${stats.sinCosto} productos con costo $0 en el sistema. Las listas de precios pueden no haberse aplicado.`,
      lectura: 'Sin costo real, el margen calculado es incorrecto. Revisá los proveedores con listas pendientes.',
      accion: 'Ir a Costos',
      modulo: 'Costos',
      href: '/costos',
    });
  }

  if (stats.margenCritico > 0) {
    out.push({
      id: 'margen-critico',
      prioridad: stats.margenCritico > 20 ? 'alta' : 'media',
      titulo: `${stats.margenCritico} productos con margen crítico (< 35%)`,
      dato: `${stats.margenCritico} de ${stats.totalProducts} productos tienen margen menor al 35%. Pueden estar vendiendo con pérdida.`,
      lectura: 'Revisá si el costo está actualizado. Si el costo subió y no ajustaste precio, perdés margen.',
      accion: 'Ver rentabilidad',
      modulo: 'Rentabilidad',
      href: '/rentabilidad',
    });
  }

  if (stats.sinLista > 0) {
    out.push({
      id: 'sin-lista',
      prioridad: 'media',
      titulo: `${stats.sinLista} proveedores sin lista de precios cargada`,
      dato: `Proveedores en productos.json que no tienen lista en supplierinfo. Sus costos pueden estar desactualizados.`,
      lectura: 'Sin lista cargada no podés comparar si el proveedor actualizó sus precios.',
      accion: 'Ir a Proveedores',
      modulo: 'Proveedores',
      href: '/proveedores',
    });
  }

  if (stats.sinPrecio > 0) {
    out.push({
      id: 'sin-precio',
      prioridad: 'media',
      titulo: `${stats.sinPrecio} productos sin precio de venta`,
      dato: `${stats.sinPrecio} productos tienen precio $0. No se pueden calcular márgenes correctamente.`,
      lectura: 'Definí el precio de venta para que el sistema pueda calcular rentabilidad y generar el export a Odoo.',
      accion: 'Ir a Productos',
      modulo: 'Productos',
      href: '/productos',
    });
  }

  return out;
}

// ─── KPIs reales ──────────────────────────────────────────────────────────────
function buildKpis() {
  return [
    {
      label: 'Costos a revisar',
      value: String(stats.sinCosto),
      sub: 'productos con costo $0',
      icon: DollarSign,
      color: stats.sinCosto > 0 ? 'bg-danger/10 text-danger' : 'bg-success/10 text-success',
      href: '/costos',
    },
    {
      label: 'Listas cargadas',
      value: String(stats.conLista),
      sub: `de ${stats.uniqueSuppliers} proveedores activos`,
      icon: FileSpreadsheet,
      color: 'bg-acqua/10 text-acqua',
      href: '/proveedores',
    },
    {
      label: 'Proveedores',
      value: String(stats.totalContacts || stats.uniqueSuppliers),
      sub: 'importados de Odoo',
      icon: Users,
      color: 'bg-gray-100 text-gray-600',
      href: '/proveedores',
    },
    {
      label: 'Margen crítico',
      value: String(stats.margenCritico),
      sub: 'productos con margen < 35%',
      icon: TrendingDown,
      color: stats.margenCritico > 0 ? 'bg-danger/10 text-danger' : 'bg-success/10 text-success',
      href: '/rentabilidad',
    },
  ];
}

// ─── Tareas del día (persistidas en localStorage) ────────────────────────────
interface Tarea { id: string; titulo: string; prioridad: 'alta' | 'media' | 'baja'; done: boolean }

function buildTareas(): Tarea[] {
  const out: Tarea[] = [];
  if (stats.sinCosto > 0) out.push({ id: 'tc1', titulo: `Actualizar costos — ${stats.sinCosto} productos sin costo`, prioridad: 'alta', done: false });
  if (stats.margenCritico > 0) out.push({ id: 'tc2', titulo: `Revisar ${stats.margenCritico} productos con margen crítico`, prioridad: 'alta', done: false });
  if (stats.sinLista > 0) out.push({ id: 'tc3', titulo: `Cargar lista de ${stats.sinLista} proveedores sin datos`, prioridad: 'media', done: false });
  if (stats.sinPrecio > 0) out.push({ id: 'tc4', titulo: `Definir precio para ${stats.sinPrecio} productos sin precio`, prioridad: 'media', done: false });
  if (out.length === 0) out.push({ id: 'tc5', titulo: 'Todo al día — sin pendientes urgentes', prioridad: 'baja', done: true });
  return out;
}

// ─── Estado del sistema ────────────────────────────────────────────────────────
function buildEstado() {
  return [
    {
      label: 'Productos en sistema',
      value: stats.totalProducts > 0 ? `${stats.totalProducts} productos` : 'Sin datos',
      status: (stats.totalProducts > 0 ? 'ok' : 'warning') as 'ok' | 'warning',
    },
    {
      label: 'Proveedores importados',
      value: stats.totalContacts > 0 ? `${stats.totalContacts} contactos Odoo` : 'Sin datos',
      status: (stats.totalContacts > 0 ? 'ok' : 'warning') as 'ok' | 'warning',
    },
    {
      label: 'Listas de precios',
      value: stats.conLista > 0 ? `${stats.conLista} proveedores con lista` : 'Sin listas',
      status: (stats.conLista > 0 ? 'ok' : 'warning') as 'ok' | 'warning',
    },
    {
      label: 'Artículos en listas',
      value: stats.totalOdooProds > 0 ? `${stats.totalOdooProds} artículos` : 'Sin datos',
      status: (stats.totalOdooProds > 0 ? 'ok' : 'warning') as 'ok' | 'warning',
    },
  ];
}

const priorityLabel: Record<string, string> = {
  alta: 'Alta prioridad', media: 'Prioridad media', baja: 'Prioridad baja',
};
const priorityColor: Record<string, string> = {
  alta: 'text-danger', media: 'text-warning', baja: 'text-gray-400',
};

// ─── ONBOARDING — si no hay datos cargados ─────────────────────────────────────
function OnboardingFlow() {
  const steps = [
    {
      num: 1, done: stats.totalContacts > 0,
      title: 'Importar proveedores desde Odoo',
      desc: 'Exportá el archivo de contactos (res.partner) desde Odoo y cargalo en Parámetros → Importar.',
      href: '/parametros',
      cta: 'Ir a Parámetros',
    },
    {
      num: 2, done: stats.totalProducts > 0,
      title: 'Importar lista de productos',
      desc: 'Exportá el archivo product.template desde Odoo con costos, precios y proveedores asignados.',
      href: '/parametros',
      cta: 'Importar productos',
    },
    {
      num: 3, done: stats.conLista > 0,
      title: 'Cargar lista de precios de cada proveedor',
      desc: 'Entrá al detalle de cada proveedor y subí su lista de precios en Excel. El sistema detecta el formato automáticamente.',
      href: '/proveedores',
      cta: 'Ir a Proveedores',
    },
  ];

  return (
    <div className="max-w-2xl mx-auto py-16 px-4">
      <div className="text-center mb-10">
        <div className="w-16 h-16 rounded-2xl bg-acqua/10 flex items-center justify-center mx-auto mb-4">
          <Database className="w-8 h-8 text-acqua" />
        </div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">Bienvenido a Acqua Control OS</h2>
        <p className="text-gray-500 text-sm leading-relaxed max-w-md mx-auto">
          Para empezar, seguí estos 3 pasos para cargar tus datos desde Odoo.
          Una vez que tenés proveedores y productos cargados, el sistema empieza a calcular márgenes y alertas automáticamente.
        </p>
      </div>

      <div className="space-y-4">
        {steps.map((step, i) => (
          <div key={step.num}
            className={cn(
              'bg-white rounded-2xl border p-6 flex items-start gap-5 transition-all',
              step.done ? 'border-success/30 bg-success/3' : 'border-gray-200',
            )}
          >
            {/* Número / check */}
            <div className={cn(
              'w-10 h-10 rounded-xl flex items-center justify-center text-base font-black shrink-0',
              step.done ? 'bg-success text-white' : 'bg-gray-100 text-gray-500',
            )}>
              {step.done ? <CheckCircle2 className="w-5 h-5" /> : step.num}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <h3 className={cn('text-sm font-bold', step.done ? 'text-success' : 'text-gray-900')}>
                  {step.title}
                </h3>
                {step.done && (
                  <span className="text-[10px] font-bold text-success bg-success/10 px-2 py-0.5 rounded-full">
                    Completado
                  </span>
                )}
              </div>
              <p className="text-[12px] text-gray-500 leading-relaxed mb-3">{step.desc}</p>
              {!step.done && (
                <Link href={step.href}
                  className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-acqua hover:text-acqua-dark transition-colors"
                >
                  {step.cta} <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              )}
            </div>

            {/* Connector line */}
            {i < steps.length - 1 && (
              <div className="absolute left-[52px] mt-16 w-0.5 h-4 bg-gray-200" />
            )}
          </div>
        ))}
      </div>

      <div className="mt-8 p-4 bg-acqua/5 border border-acqua/20 rounded-xl text-center">
        <p className="text-[12px] text-acqua font-medium">
          💡 Una vez completados los 3 pasos, el dashboard mostrará alertas reales de costos, márgenes y listas de proveedores.
        </p>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function ControlPage() {
  const alertas = useMemo(() => buildAlertas(), []);
  const kpis    = useMemo(() => buildKpis(),    []);
  const tareas  = useMemo(() => buildTareas(),  []);
  const estado  = useMemo(() => buildEstado(),  []);

  const [tasksDone, setTasksDone] = useState<Set<string>>(
    new Set(tareas.filter(t => t.done).map(t => t.id))
  );

  const toggleTask = (id: string) => {
    setTasksDone(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // Socio Acqua message — generado desde datos reales
  const socioMsg = stats.totalProducts === 0
    ? 'Para empezar necesitás importar productos y proveedores desde Odoo. Seguí los pasos de bienvenida.'
    : stats.sinCosto > 0
    ? `Hay ${stats.sinCosto} productos sin costo. Subí la lista del proveedor correspondiente para que el sistema pueda calcular márgenes.`
    : stats.margenCritico > 0
    ? `Hay ${stats.margenCritico} productos con margen menor al 35%. Revisá si los precios están actualizados después del último aumento de costos.`
    : `Todo se ve bien — ${stats.totalProducts} productos con costos y precios cargados. Recordá mantener las listas de proveedores actualizadas.`;

  return (
    <div className="min-h-screen">
    <div className="max-w-[1680px] mx-auto">

      {/* ── HERO BANNER ───────────────────────────────────────────── */}
      <div className="px-4 lg:px-6 pt-4">
        <div className="relative rounded-2xl overflow-hidden min-h-[140px] bg-gradient-to-r from-gray-950 via-gray-900 to-gray-800">
          <div className="absolute inset-0 opacity-20"
            style={{ backgroundImage: 'radial-gradient(circle at 70% 50%, #0EA5E9 0%, transparent 60%)' }} />
          <div className="relative z-10 flex items-center justify-between h-full px-8 py-6">
            <div>
              <p className="text-white/40 text-xs font-medium mb-1 uppercase tracking-widest">
                Centro de Control
              </p>
              <h1 className="text-3xl lg:text-4xl font-bold text-white tracking-tight">
                Acqua Control OS
              </h1>
              <p className="text-white/50 text-sm mt-1 capitalize">{today}</p>
            </div>
            <div className="hidden md:flex items-center gap-3">
              <SocioAcquaPanel message={socioMsg} className="w-[380px]" />
            </div>
          </div>
        </div>
      </div>

      {/* Si no hay datos: mostrar onboarding */}
      {!stats.hasData && (
        <OnboardingFlow />
      )}

      {/* Si hay datos: mostrar dashboard real */}
      {stats.hasData && (<>

      {/* ── KPI CARDS ─────────────────────────────────────────────── */}
      <div className="px-4 lg:px-6 mt-4">
        <div className="md:hidden mb-4">
          <SocioAcquaPanel message={socioMsg} />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {kpis.map((kpi, i) => {
            const Icon = kpi.icon;
            return (
              <a key={i} href={kpi.href}
                className="bg-white rounded-xl border border-gray-100 p-5 card-hover group cursor-pointer block">
                <div className="flex items-center justify-between mb-3">
                  <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center', kpi.color)}>
                    <Icon className="w-4.5 h-4.5" />
                  </div>
                  <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-gray-500 transition-colors" />
                </div>
                <div className="text-2xl lg:text-3xl font-bold text-gray-900 tracking-tight">{kpi.value}</div>
                <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider mt-1">{kpi.label}</div>
                <div className="text-[10px] text-gray-400 mt-0.5">{kpi.sub}</div>
              </a>
            );
          })}
        </div>
      </div>

      {/* ── MAIN CONTENT ──────────────────────────────────────────── */}
      <div className="px-4 lg:px-6 mt-6 mb-10">
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">

          {/* LEFT: Alertas */}
          <div className="xl:col-span-2 space-y-6">

            <section>
              <h2 className="text-sm font-bold text-gray-900 mb-3 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-danger" />
                Alertas del sistema
                <span className="ml-auto text-[10px] text-gray-400 font-normal">Generadas desde datos reales</span>
              </h2>

              {alertas.length === 0 ? (
                <div className="bg-white rounded-xl border border-success/20 p-6 text-center">
                  <CheckCircle2 className="w-8 h-8 text-success mx-auto mb-2" />
                  <p className="text-sm font-bold text-gray-900">Sin alertas activas</p>
                  <p className="text-xs text-gray-400 mt-1">
                    Todos los productos tienen costos, precios y márgenes dentro del rango esperado.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {alertas.map((u) => (
                    <div key={u.id} className={cn(
                      'bg-white rounded-xl border p-4',
                      u.prioridad === 'alta' ? 'border-danger/20' : 'border-warning/20'
                    )}>
                      <div className="flex items-center gap-2 mb-2">
                        {u.prioridad === 'alta'
                          ? <XCircle className="w-4 h-4 text-danger shrink-0" />
                          : <AlertTriangle className="w-4 h-4 text-warning shrink-0" />
                        }
                        <span className={cn(
                          'text-[10px] font-bold uppercase tracking-wider',
                          u.prioridad === 'alta' ? 'text-danger' : 'text-warning',
                        )}>
                          {u.prioridad === 'alta' ? 'Urgente' : 'Atención'} · {u.modulo}
                        </span>
                      </div>
                      <h3 className="text-sm font-semibold text-gray-900 leading-snug mb-2">{u.titulo}</h3>
                      <div className="bg-gray-50 rounded-lg px-3 py-2 mb-2">
                        <span className="text-[10px] text-gray-400 font-semibold uppercase">Dato</span>
                        <p className="text-xs text-gray-700 mt-0.5">{u.dato}</p>
                      </div>
                      <div className="flex items-start gap-1.5 mb-3">
                        <Lightbulb className="w-3.5 h-3.5 text-warning mt-0.5 shrink-0" />
                        <p className="text-xs text-gray-500 italic">{u.lectura}</p>
                      </div>
                      <a href={u.href}
                        className="inline-flex items-center gap-1.5 text-xs font-semibold text-acqua hover:text-acqua-dark transition-colors">
                        {u.accion} <ArrowRight className="w-3 h-3" />
                      </a>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Accesos rápidos */}
            <section>
              <h2 className="text-sm font-bold text-gray-900 mb-3">Accesos rápidos</h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                  { label: 'Proveedores', icon: Users,          href: '/proveedores', color: 'bg-acqua/10 text-acqua' },
                  { label: 'Productos',   icon: Package,         href: '/productos',   color: 'bg-info/10 text-info' },
                  { label: 'Costos',      icon: DollarSign,      href: '/costos',      color: 'bg-warning/10 text-warning' },
                  { label: 'Export Odoo', icon: FileSpreadsheet, href: '/export-odoo', color: 'bg-odoo/10 text-odoo' },
                ].map((a, i) => (
                  <a key={i} href={a.href}
                    className="bg-white border border-gray-100 rounded-xl flex flex-col items-center gap-2 py-5 px-3 hover:shadow-md transition-all group card-hover">
                    <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center', a.color)}>
                      <a.icon className="w-5 h-5" />
                    </div>
                    <span className="text-[12px] font-semibold text-gray-700 group-hover:text-gray-900">{a.label}</span>
                    <ChevronRight className="w-3.5 h-3.5 text-gray-400" />
                  </a>
                ))}
              </div>
            </section>

          </div>

          {/* RIGHT: Tareas + Estado del sistema */}
          <div className="space-y-4">

            {/* Tareas derivadas de alertas */}
            <div className="bg-white rounded-xl border border-gray-100">
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-50">
                <h3 className="text-sm font-bold text-gray-900">Pendientes</h3>
                <span className="text-xs text-gray-400">
                  {tasksDone.size}/{tareas.length} hechos
                </span>
              </div>
              <div className="h-1 bg-gray-100">
                <div
                  className="h-1 bg-acqua rounded-full transition-all duration-500"
                  style={{ width: `${(tasksDone.size / tareas.length) * 100}%` }}
                />
              </div>
              <div className="divide-y divide-gray-50">
                {tareas.map((t) => {
                  const done = tasksDone.has(t.id);
                  return (
                    <button key={t.id} onClick={() => toggleTask(t.id)}
                      className="flex items-start gap-3 px-5 py-3 w-full text-left hover:bg-gray-50/70 transition-colors"
                    >
                      {done
                        ? <CheckCircle2 className="w-4 h-4 text-acqua mt-0.5 shrink-0" />
                        : <Circle className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                      }
                      <div className="flex-1 min-w-0">
                        <p className={cn('text-xs leading-snug', done ? 'text-gray-400 line-through' : 'text-gray-900')}>
                          {t.titulo}
                        </p>
                        {!done && (
                          <span className={cn('text-[10px] font-semibold', priorityColor[t.prioridad])}>
                            {priorityLabel[t.prioridad]}
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Estado del sistema */}
            <div className="bg-white rounded-xl border border-gray-100">
              <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-50">
                <RefreshCw className="w-4 h-4 text-gray-400" />
                <h3 className="text-sm font-bold text-gray-900">Estado del sistema</h3>
              </div>
              <div className="divide-y divide-gray-50">
                {estado.map((e, i) => (
                  <div key={i} className="flex items-center justify-between px-5 py-3">
                    <div>
                      <div className="text-xs text-gray-500">{e.label}</div>
                      <div className="text-xs font-semibold text-gray-900 mt-0.5">{e.value}</div>
                    </div>
                    <div className="flex justify-end mt-0.5">
                      {e.status === 'ok'
                        ? <span className="w-1.5 h-1.5 rounded-full bg-success inline-block" />
                        : <span className="w-1.5 h-1.5 rounded-full bg-warning inline-block" />
                      }
                    </div>
                  </div>
                ))}
              </div>

              {/* Importar datos */}
              <div className="px-5 pb-4 pt-2">
                <Link href="/parametros"
                  className="flex items-center gap-2 w-full px-4 py-2.5 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-xl text-xs font-semibold text-gray-600 transition-colors"
                >
                  <Upload className="w-3.5 h-3.5" />
                  Importar datos desde Odoo
                </Link>
              </div>
            </div>

          </div>
        </div>
      </div>

      </>)}
    </div>
    </div>
  );
}
