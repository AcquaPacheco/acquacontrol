'use client';

import { cn } from '@/lib/utils';

type BadgeVariant = 'success' | 'warning' | 'danger' | 'info' | 'neutral' | 'acqua' | 'odoo' | 'meli';

const variantStyles: Record<BadgeVariant, string> = {
  success: 'bg-success text-white',
  warning: 'bg-warning text-white',
  danger: 'bg-danger text-white',
  info: 'bg-info text-white',
  neutral: 'bg-gray-400 text-white',
  acqua: 'bg-acqua text-white',
  odoo: 'bg-odoo text-white',
  meli: 'bg-meli text-meli-dark',
};

const statusToVariant: Record<string, BadgeVariant> = {
  // Supplier statuses
  actualizado: 'success',
  rentable: 'success',
  lista_cargada: 'info',
  cambios_detectados: 'warning',
  falta_actualizar: 'warning',
  falta_supplierinfo: 'warning',
  falta_producto_odoo: 'warning',
  lista_vencida: 'danger',
  revisar_errores: 'danger',
  pendiente: 'warning',
  atencion: 'warning',
  // Product statuses
  activo: 'success',
  sin_stock: 'danger',
  stock_bajo: 'warning',
  critico: 'danger',
  revisar: 'warning',
  archivado: 'neutral',
  nuevo: 'info',
  // Export statuses
  listo: 'acqua',
  exportado: 'success',
  error: 'danger',
  alerta: 'warning',
  // Cost statuses
  sin_cambios: 'success',
  aumento_leve: 'warning',
  aumento_fuerte: 'danger',
  baja_costo: 'success',
  oportunidad: 'info',
  aprobado: 'success',
  esperar: 'neutral',
  // Task
  hecho: 'success',
  en_revision: 'info',
  listo_odoo: 'acqua',
  descartado: 'neutral',
  // Operations
  confirmada: 'success',
  actualizado_op: 'acqua',
};

const statusLabels: Record<string, string> = {
  actualizado: 'Actualizado',
  rentable: 'Rentable',
  lista_cargada: 'Lista cargada',
  cambios_detectados: 'Cambios detectados',
  falta_actualizar: 'Falta actualizar',
  falta_supplierinfo: 'Falta supplierinfo',
  falta_producto_odoo: 'Falta producto Odoo',
  lista_vencida: 'Lista vencida',
  revisar_errores: 'Revisar errores',
  pendiente: 'Pendiente',
  atencion: 'Atención',
  activo: 'Activo',
  sin_stock: 'Sin stock',
  stock_bajo: 'Stock bajo',
  critico: 'Crítico',
  revisar: 'Revisar',
  archivado: 'Archivado',
  nuevo: 'Nuevo',
  listo: 'Listo',
  exportado: 'Exportado',
  error: 'Error',
  alerta: 'Alerta',
  sin_cambios: 'Sin cambios',
  aumento_leve: 'Aumento leve',
  aumento_fuerte: 'Aumento fuerte',
  baja_costo: 'Baja de costo',
  oportunidad: 'Oportunidad',
  aprobado: 'Aprobado',
  esperar: 'Esperar',
  hecho: 'Hecho',
  en_revision: 'En revisión',
  listo_odoo: 'Listo Odoo',
  descartado: 'Descartado',
  confirmada: 'CONFIRMADA',
  actualizado_op: 'ACTUALIZADO',
};

interface StatusBadgeProps {
  status: string;
  label?: string;
  variant?: BadgeVariant;
  size?: 'sm' | 'md';
  className?: string;
}

export function StatusBadge({ status, label, variant, size = 'sm', className }: StatusBadgeProps) {
  const resolvedVariant = variant || statusToVariant[status] || 'neutral';
  const resolvedLabel = label || statusLabels[status] || status.replace(/_/g, ' ');

  return (
    <span
      className={cn(
        'inline-flex items-center font-semibold rounded-md whitespace-nowrap',
        size === 'sm' ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-xs',
        variantStyles[resolvedVariant],
        className
      )}
    >
      {resolvedLabel}
    </span>
  );
}
