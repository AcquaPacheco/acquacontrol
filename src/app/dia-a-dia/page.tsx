'use client';

import { MetricCard } from '@/components/shared/metric-card';
import { StatusBadge } from '@/components/shared/status-badge';
import { cn } from '@/lib/utils';
import {
  CalendarDays,
  AlertTriangle,
  Package,
  TrendingDown,
  ShoppingCart,
  ArrowRight,
  Clock,
  CheckCircle2,
  Circle,
  Zap,
  Lightbulb,
  DollarSign,
  Users,
} from 'lucide-react';

const urgencias = [
  { id: '1', title: '5 productos con stock crítico', module: 'Stock', priority: 'alta' as const, desc: 'Lavandina, Pastillas de Cloro y 3 más están por debajo del mínimo' },
  { id: '2', title: '26 alertas de costo pendientes', module: 'Costos', priority: 'alta' as const, desc: 'Costos actualizados sin aprobar. Pueden generar venta por debajo del margen' },
  { id: '3', title: 'Lista Clorox vencida hace 66 días', module: 'Proveedores', priority: 'media' as const, desc: 'La lista de CLOROX ARGENTINA venció el 15/03. Contactar para actualización' },
];

const oportunidades = [
  { id: '1', title: 'Sahumerio Saphirus — margen 55%', desc: 'Stock alto + margen alto. Ideal para promoción o combo MercadoLibre.', action: 'Crear promo' },
  { id: '2', title: 'Detergente Concentrado — baja de costo', desc: 'El proveedor bajó el costo. Ganaste 3 puntos de margen extra.', action: 'Aprovechar' },
  { id: '3', title: 'Kit Decantador — ventas ML subiendo', desc: '18 ventas en 30 días. Considerar stock y ajuste de precio ML.', action: 'Ver en ML Lab' },
];

const tareasDia = [
  { id: '1', title: 'Aprobar costos LAMBDA CHEMICAL', done: false, priority: 'alta' as const },
  { id: '2', title: 'Subir CSV stock actualizado', done: false, priority: 'alta' as const },
  { id: '3', title: 'Revisar export Odoo pendiente', done: false, priority: 'media' as const },
  { id: '4', title: 'Contactar CLOROX por lista nueva', done: false, priority: 'media' as const },
  { id: '5', title: 'Verificar publicaciones ML pausadas', done: true, priority: 'baja' as const },
  { id: '6', title: 'Revisar promo Sahumerios', done: true, priority: 'baja' as const },
];

const priorityColors = {
  alta: 'text-danger',
  media: 'text-warning',
  baja: 'text-info',
};

export default function DiaADiaPage() {
  return (
    <div className="min-h-screen max-w-[1680px] mx-auto">
      {/* Header */}
      <div className="px-4 lg:px-8 pt-6 pb-2">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-acqua/10 flex items-center justify-center">
            <CalendarDays className="w-5 h-5 text-acqua" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Día a Día</h1>
            <p className="text-sm text-gray-500">Pantalla de decisión diaria — Prioridades, urgencias y oportunidades</p>
          </div>
        </div>
      </div>

      <div className="px-4 lg:px-8 mt-4 mb-8 space-y-6">
        {/* Urgencias */}
        <div>
          <h2 className="text-sm font-bold text-gray-900 mb-3 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-danger" />
            Urgencias del día
          </h2>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            {urgencias.map((u) => (
              <div key={u.id} className={cn(
                'bg-white rounded-xl border p-4',
                u.priority === 'alta' ? 'border-danger/20' : 'border-warning/20'
              )}>
                <div className="flex items-start justify-between mb-2">
                  <StatusBadge status={u.priority} label={u.priority === 'alta' ? 'Urgente' : 'Atención'} variant={u.priority === 'alta' ? 'danger' : 'warning'} />
                  <span className="text-[10px] text-gray-400">{u.module}</span>
                </div>
                <h3 className="text-sm font-semibold text-gray-900 mb-1">{u.title}</h3>
                <p className="text-xs text-gray-500 leading-relaxed mb-3">{u.desc}</p>
                <button className="flex items-center gap-1 text-xs font-semibold text-acqua hover:text-acqua-dark">
                  Resolver ahora <ArrowRight className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* Two columns: Tasks + Opportunities */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Tasks */}
          <div>
            <h2 className="text-sm font-bold text-gray-900 mb-3 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-acqua" />
              Tareas del día
            </h2>
            <div className="bg-white rounded-xl border border-gray-100 divide-y divide-gray-50">
              {tareasDia.map((t) => (
                <div key={t.id} className="flex items-center gap-3 px-4 py-3 hover:bg-gray-50/50 transition-colors">
                  {t.done ? (
                    <CheckCircle2 className="w-5 h-5 text-acqua shrink-0" />
                  ) : (
                    <Circle className="w-5 h-5 text-gray-400 shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <span className={cn('text-sm', t.done ? 'text-gray-400 line-through' : 'text-gray-900')}>
                      {t.title}
                    </span>
                    <span className={cn('text-[10px] font-semibold ml-2', priorityColors[t.priority])}>
                      {t.priority}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Opportunities */}
          <div>
            <h2 className="text-sm font-bold text-gray-900 mb-3 flex items-center gap-2">
              <Zap className="w-4 h-4 text-info" />
              Oportunidades detectadas
            </h2>
            <div className="space-y-3">
              {oportunidades.map((o) => (
                <div key={o.id} className="bg-white rounded-xl border border-info/20 p-4">
                  <h3 className="text-sm font-semibold text-gray-900 mb-1">{o.title}</h3>
                  <p className="text-xs text-gray-500 leading-relaxed mb-3">{o.desc}</p>
                  <button className="flex items-center gap-1 text-xs font-semibold text-info hover:text-blue-700">
                    {o.action} <ArrowRight className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Quick actions */}
        <div>
          <h2 className="text-sm font-bold text-gray-900 mb-3">Acciones rápidas</h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { label: 'Subir stock CSV', icon: Package, color: 'bg-acqua/10 text-acqua' },
              { label: 'Cargar lista proveedor', icon: Users, color: 'bg-success/10 text-success' },
              { label: 'Revisar costos', icon: DollarSign, color: 'bg-warning/10 text-warning' },
              { label: 'Exportar a Odoo', icon: ShoppingCart, color: 'bg-odoo/10 text-odoo' },
            ].map((a, i) => (
              <button key={i} className="flex items-center gap-3 bg-white rounded-xl border border-gray-100 p-4 hover:bg-gray-50 transition-colors">
                <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center', a.color)}>
                  <a.icon className="w-5 h-5" />
                </div>
                <span className="text-sm font-medium text-gray-700">{a.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
