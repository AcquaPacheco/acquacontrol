'use client';

import { cn } from '@/lib/utils';
import { Supplier } from '@/types';
import { rubroColors, statusConfig } from '@/data/mock-suppliers';
import { ArrowRight, AlertCircle, Phone, Calendar } from 'lucide-react';
import Link from 'next/link';

interface SupplierCardProps {
  supplier: Supplier;
  className?: string;
}

export function SupplierCard({ supplier, className }: SupplierCardProps) {
  const gradient = supplier.headerColor || 'from-zinc-700 to-zinc-900';
  const rubroColor = rubroColors[supplier.rubro] || rubroColors['default'];
  const st = statusConfig[supplier.status] || statusConfig['pendiente'];
  const alerts = (supplier.alertProducts || 0) + (supplier.pendingProducts || 0);

  // Días desde última actualización
  const daysSince = supplier.lastListDate
    ? Math.floor((Date.now() - new Date(supplier.lastListDate).getTime()) / 86400000)
    : null;

  return (
    <div className={cn('bg-white rounded-xl border border-gray-100 overflow-hidden card-hover group flex flex-col', className)}>

      {/* Header band — 56px con gradiente */}
      <div className={cn('relative h-14 bg-gradient-to-br shrink-0', gradient)}>
        {/* Status dot */}
        <span className={cn('absolute top-2.5 right-2.5 w-2 h-2 rounded-full ring-2 ring-white/40', st.dot)} />

        {/* Logo avatar — solapando el borde inferior */}
        <div className="absolute -bottom-5 left-4">
          <div className="w-10 h-10 rounded-lg bg-white border-2 border-white shadow flex items-center justify-center">
            {supplier.logo ? (
              <img src={supplier.logo} alt={supplier.name} className="w-8 h-8 object-contain" />
            ) : (
              <span className="text-base font-black text-gray-700 leading-none">
                {supplier.name.charAt(0)}
              </span>
            )}
          </div>
        </div>

        {/* Rubro badge — top left */}
        <div className="absolute top-2 left-2">
          <span className={cn('inline-flex px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wide', rubroColor)}>
            {supplier.rubro}
          </span>
        </div>
      </div>

      {/* Body */}
      <div className="pt-7 px-4 pb-4 flex flex-col flex-1">
        {/* Name */}
        <h3 className="font-bold text-[13px] text-gray-900 leading-tight truncate">{supplier.name}</h3>

        {/* Contact info */}
        <div className="flex items-center gap-2 mt-1">
          {supplier.contact && (
            <span className="text-[11px] text-gray-400 truncate">{supplier.contact}</span>
          )}
          {supplier.whatsapp && (
            <a href={`https://wa.me/${supplier.whatsapp.replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer"
               className="text-green-500 hover:text-green-600 transition-colors shrink-0">
              <Phone className="w-3 h-3" />
            </a>
          )}
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-gray-100">
          <div className="text-center">
            <div className="text-base font-bold text-gray-900">{supplier.productCount}</div>
            <div className="text-[9px] text-gray-400 font-medium uppercase tracking-wide">productos</div>
          </div>
          <div className="text-center">
            <div className={cn(
              'text-base font-bold',
              !supplier.avgMargin ? 'text-gray-400' :
              supplier.avgMargin >= 45 ? 'text-success' :
              supplier.avgMargin >= 35 ? 'text-warning' : 'text-danger'
            )}>
              {supplier.avgMargin ? `${supplier.avgMargin}%` : '—'}
            </div>
            <div className="text-[9px] text-gray-400 font-medium uppercase tracking-wide">margen</div>
          </div>
          <div className="text-center">
            <div className="text-base font-bold text-acqua">1ra</div>
            <div className="text-[9px] text-gray-400 font-medium uppercase tracking-wide">lista</div>
          </div>
        </div>

        {/* Last update + alerts */}
        <div className="flex items-center justify-between mt-2.5">
          <div className="flex items-center gap-1 text-[10px] text-gray-400">
            <Calendar className="w-3 h-3" />
            {daysSince !== null ? (
              daysSince === 0 ? 'Hoy' :
              daysSince === 1 ? 'Ayer' :
              `Hace ${daysSince} días`
            ) : '—'}
          </div>
          {alerts > 0 && (
            <div className="flex items-center gap-1">
              <AlertCircle className="w-3 h-3 text-danger" />
              <span className="text-[10px] font-bold text-danger">{alerts}</span>
            </div>
          )}
        </div>

        {/* CTA */}
        <Link
          href={`/proveedores/${supplier.id}`}
          className="flex items-center justify-center gap-1.5 w-full mt-3 px-3 py-2 bg-gray-900 text-white text-[12px] font-semibold rounded-lg hover:bg-gray-800 transition-colors group/btn"
        >
          Abrir proveedor
          <ArrowRight className="w-3.5 h-3.5 group-hover/btn:translate-x-0.5 transition-transform" />
        </Link>
      </div>
    </div>
  );
}
