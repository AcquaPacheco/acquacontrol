'use client';

import { cn } from '@/lib/utils';
import { Calendar } from 'lucide-react';

interface HeroBannerProps {
  title: string;
  subtitle?: string;
  date?: string;
  className?: string;
  children?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
}

export function HeroBanner({ title, subtitle, date, className, children, size = 'md' }: HeroBannerProps) {
  const today = date || new Date().toLocaleDateString('es-AR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  return (
    <div
      className={cn(
        'relative w-full rounded-xl overflow-hidden',
        size === 'sm' && 'min-h-[120px]',
        size === 'md' && 'min-h-[180px]',
        size === 'lg' && 'min-h-[240px]',
        className
      )}
    >
      {/* Background image placeholder - uses a gradient as fallback */}
      <div className="absolute inset-0 bg-gradient-to-r from-gray-900 via-gray-800 to-gray-700">
        {/* When user provides a real image, it goes here */}
        <div className="absolute inset-0 hero-overlay" />
      </div>

      {/* Content */}
      <div className="relative z-10 flex flex-col justify-end h-full p-6 lg:p-8">
        <div className="flex items-end justify-between gap-4">
          <div className="flex-1">
            <h1 className={cn(
              'text-white font-bold tracking-tight',
              size === 'sm' && 'text-2xl',
              size === 'md' && 'text-3xl lg:text-4xl',
              size === 'lg' && 'text-4xl lg:text-5xl',
            )}>
              {title}
            </h1>
            {subtitle && (
              <p className="text-white/70 text-sm lg:text-base mt-1 max-w-xl">{subtitle}</p>
            )}
          </div>

          <div className="hidden sm:flex items-center gap-2 bg-white/10 backdrop-blur-sm rounded-lg px-4 py-2 border border-white/10">
            <Calendar className="w-4 h-4 text-white/70" />
            <span className="text-white/90 text-sm font-medium capitalize">{today}</span>
          </div>
        </div>

        {children && <div className="mt-4">{children}</div>}
      </div>
    </div>
  );
}
