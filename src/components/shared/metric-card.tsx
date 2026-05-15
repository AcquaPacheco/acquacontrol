'use client';

import { cn } from '@/lib/utils';
import { ArrowUpRight, ArrowDownRight, ArrowRight } from 'lucide-react';
import { type LucideIcon } from 'lucide-react';

interface MetricCardProps {
  label: string;
  value: string;
  change?: number;
  changeLabel?: string;
  icon?: LucideIcon;
  color?: 'acqua' | 'success' | 'warning' | 'danger' | 'info' | 'neutral';
  href?: string;
  sparkline?: boolean;
  className?: string;
}

const iconBgColors = {
  acqua: 'bg-acqua/10 text-acqua',
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
  danger: 'bg-danger/10 text-danger',
  info: 'bg-info/10 text-info',
  neutral: 'bg-gray-100 text-gray-500',
};

export function MetricCard({
  label,
  value,
  change,
  changeLabel,
  icon: Icon,
  color = 'acqua',
  href,
  className,
}: MetricCardProps) {
  const isPositive = change !== undefined && change >= 0;

  return (
    <div
      className={cn(
        'bg-white rounded-xl border border-gray-100 p-5 flex flex-col gap-3 card-hover cursor-default',
        href && 'cursor-pointer',
        className
      )}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {Icon && (
            <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center', iconBgColors[color])}>
              <Icon className="w-5 h-5" />
            </div>
          )}
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{label}</span>
        </div>
        {href && (
          <ArrowRight className="w-4 h-4 text-gray-400" />
        )}
      </div>

      <div className="flex items-end justify-between">
        <div>
          <div className="text-2xl lg:text-3xl font-bold text-gray-900 tracking-tight">{value}</div>
          {change !== undefined && (
            <div className="flex items-center gap-1 mt-1">
              {isPositive ? (
                <ArrowUpRight className="w-3.5 h-3.5 text-success" />
              ) : (
                <ArrowDownRight className="w-3.5 h-3.5 text-danger" />
              )}
              <span className={cn('text-sm font-semibold', isPositive ? 'text-success' : 'text-danger')}>
                {isPositive ? '+' : ''}{change}%
              </span>
              {changeLabel && (
                <span className="text-xs text-gray-400 ml-1">{changeLabel}</span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Mini sparkline placeholder */}
      <div className="h-8 w-full opacity-30">
        <svg viewBox="0 0 100 30" className="w-full h-full" preserveAspectRatio="none">
          <polyline
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className={cn(
              color === 'acqua' && 'text-acqua',
              color === 'success' && 'text-success',
              color === 'warning' && 'text-warning',
              color === 'danger' && 'text-danger',
              color === 'info' && 'text-info',
              color === 'neutral' && 'text-gray-400'
            )}
            points="0,25 10,22 20,24 30,18 40,20 50,15 60,12 70,14 80,8 90,5 100,3"
          />
        </svg>
      </div>
    </div>
  );
}
