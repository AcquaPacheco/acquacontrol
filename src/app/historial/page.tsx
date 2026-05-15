'use client';

import { StatusBadge } from '@/components/shared/status-badge';
import {
  History,
  DollarSign,
  FileSpreadsheet,
  Package,
  Users,
  CheckCircle2,
  Upload,
  AlertTriangle,
  TrendingUp,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const mockHistory = [
  { id: '1', type: 'export', icon: FileSpreadsheet, color: 'bg-odoo', title: 'Export Producto Odoo generado', desc: '8 productos exportados a product.template', time: '20/05 10:45', module: 'Export Odoo' },
  { id: '2', type: 'cost', icon: DollarSign, color: 'bg-warning', title: 'Costos aprobados — LAMBDA CHEMICAL', desc: '12 productos con costo final aprobado', time: '20/05 10:30', module: 'Costos' },
  { id: '3', type: 'price', icon: TrendingUp, color: 'bg-success', title: 'Precios actualizados', desc: 'Lista A recalculada para 143 productos', time: '20/05 09:15', module: 'Rentabilidad' },
  { id: '4', type: 'list', icon: Upload, color: 'bg-acqua', title: 'Lista cargada — OPPIZZI SERGIO', desc: 'Excel con 35 productos procesado exitosamente', time: '20/05 09:00', module: 'Proveedores' },
  { id: '5', type: 'error', icon: AlertTriangle, color: 'bg-danger', title: 'Error detectado en export', desc: '2 productos sin ID Odoo bloquearon export', time: '19/05 17:30', module: 'Export Odoo' },
  { id: '6', type: 'product', icon: Package, color: 'bg-info', title: 'Producto nuevo vinculado', desc: 'Carbón Vegetal x 4kg vinculado a Odoo ID 4570', time: '19/05 16:00', module: 'Productos' },
  { id: '7', type: 'supplier', icon: Users, color: 'bg-emerald-500', title: 'Proveedor actualizado — VULCANO S.A.', desc: 'Descuento cambiado de 15% a 20%', time: '19/05 14:20', module: 'Proveedores' },
  { id: '8', type: 'task', icon: CheckCircle2, color: 'bg-acqua', title: 'Tarea completada', desc: 'Revisar precios actualizados — marcada como hecha', time: '19/05 12:00', module: 'Día a Día' },
  { id: '9', type: 'export', icon: FileSpreadsheet, color: 'bg-odoo', title: 'Export Supplierinfo generado', desc: '6 registros supplierinfo exportados', time: '18/05 16:45', module: 'Export Odoo' },
  { id: '10', type: 'list', icon: Upload, color: 'bg-acqua', title: 'Lista cargada — D AGNILLO', desc: 'CSV con 22 productos procesado con 1 error', time: '18/05 11:00', module: 'Proveedores' },
];

export default function HistorialPage() {
  return (
    <div className="min-h-screen max-w-[1680px] mx-auto">
      {/* Header */}
      <div className="px-4 lg:px-8 pt-6 pb-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-gray-100 flex items-center justify-center">
            <History className="w-5 h-5 text-gray-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Historial</h1>
            <p className="text-sm text-gray-500">Registro de todos los cambios importantes — Timeline de auditoría</p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="px-4 lg:px-8 mb-4">
        <div className="flex items-center gap-2 flex-wrap">
          {['Todos', 'Costos', 'Precios', 'Exports', 'Proveedores', 'Productos', 'Tareas', 'Errores'].map((f, i) => (
            <button
              key={f}
              className={cn(
                'px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                i === 0 ? 'bg-gray-900 text-white' : 'bg-white border border-gray-200 text-gray-500 hover:bg-gray-50'
              )}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Timeline */}
      <div className="px-4 lg:px-8 mb-8">
        <div className="relative">
          {/* Vertical line */}
          <div className="absolute left-[19px] top-0 bottom-0 w-px bg-gray-200" />

          <div className="space-y-0">
            {mockHistory.map((event, i) => {
              const Icon = event.icon;
              return (
                <div key={event.id} className="relative flex gap-4 pb-6">
                  {/* Icon */}
                  <div className={cn(
                    'relative z-10 w-10 h-10 rounded-full flex items-center justify-center shrink-0 ring-4 ring-surface',
                    event.color
                  )}>
                    <Icon className="w-4 h-4 text-white" />
                  </div>

                  {/* Content */}
                  <div className="flex-1 bg-white rounded-xl border border-gray-100 p-4 hover:shadow-sm transition-shadow">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h3 className="text-sm font-semibold text-gray-900">{event.title}</h3>
                        <p className="text-xs text-gray-500 mt-0.5">{event.desc}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-xs text-gray-400">{event.time}</div>
                        <span className="text-[10px] text-gray-400 font-medium">{event.module}</span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
