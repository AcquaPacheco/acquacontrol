'use client';

import { cn } from '@/lib/utils';
import { type LucideIcon, AlertCircle, Clock, Package, TrendingUp, ChevronRight } from 'lucide-react';

interface ContextItem {
  value: number;
  label: string;
  sublabel: string;
  icon: LucideIcon;
  color: 'danger' | 'warning' | 'success' | 'info';
  href?: string;
}

interface ContextCardProps {
  title?: string;
  subtitle?: string;
  items?: ContextItem[];
  className?: string;
}

const colorMap = {
  danger: 'bg-danger/10 text-danger',
  warning: 'bg-warning/10 text-warning',
  success: 'bg-success/10 text-success',
  info: 'bg-info/10 text-info',
};

export function ContextCard({
  title = 'Contexto Acqua',
  subtitle = 'Insights y prioridades detectadas',
  items,
  className,
}: ContextCardProps) {
  const defaultItems: ContextItem[] = items || [
    { value: 26, label: 'Alertas de costo', sublabel: 'Acciones necesarias', icon: AlertCircle, color: 'danger' },
    { value: 8, label: 'Listas por vencer', sublabel: 'Próximos 30 días', icon: Clock, color: 'warning' },
    { value: 14, label: 'Productos sin costo', sublabel: 'Sin margen definido', icon: Package, color: 'success' },
    { value: 6, label: 'Oportunidades', sublabel: 'Mejorar rentabilidad', icon: TrendingUp, color: 'info' },
  ];

  return (
    <div className={cn('bg-white rounded-xl border border-gray-100 p-5', className)}>
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {defaultItems.map((item, i) => {
          const Icon = item.icon;
          return (
            <button
              key={i}
              className="flex items-center gap-3 p-3 rounded-lg bg-gray-50 hover:bg-gray-100 transition-colors text-left group"
            >
              <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center shrink-0', colorMap[item.color])}>
                <Icon className="w-4.5 h-4.5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-xl font-bold text-gray-900">{item.value}</div>
                <div className="text-[11px] font-semibold text-gray-700 truncate">{item.label}</div>
                <div className="text-[10px] text-gray-400 truncate">{item.sublabel}</div>
              </div>
              <ChevronRight className="w-3.5 h-3.5 text-gray-400 group-hover:text-gray-500 shrink-0" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
