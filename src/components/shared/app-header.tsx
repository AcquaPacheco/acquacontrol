'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Image from 'next/image';
import {
  LayoutDashboard, Users, Package, TrendingUp,
  Tag, FileSpreadsheet, ShoppingCart, MessageSquare, History,
  Settings, Bell, ChevronDown, Menu, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useState } from 'react';
import { DeployButton } from '@/components/shared/deploy-button';

const primaryNavItems = [
  { label: 'Control',       href: '/',            icon: LayoutDashboard },
  { label: 'Proveedores',   href: '/proveedores',  icon: Users           },
  { label: 'Productos',     href: '/productos',    icon: Package         },
  { label: 'Rentabilidad',  href: '/rentabilidad', icon: TrendingUp      },
  { label: 'Promos',        href: '/promos',       icon: Tag             },
  { label: 'Historial',     href: '/historial',    icon: History         },
  { label: 'Parámetros',    href: '/parametros',   icon: Settings        },
];

const specialNavItems = [
  { label: 'Export Odoo',  href: '/export-odoo',  className: 'bg-odoo hover:bg-odoo-light text-white', logoText: 'odoo', icon: FileSpreadsheet },
  { label: 'MercadoLibre', href: '/mercadolibre', className: 'bg-meli hover:bg-meli/90 text-meli-dark font-bold', icon: ShoppingCart },
];

const moreItems = [
  { label: 'Consultor', href: '/consultor', icon: MessageSquare },
];

// Ítems que aparecen en la barra inferior de mobile
const bottomNavItems = [
  { label: 'Control',     href: '/',           icon: LayoutDashboard },
  { label: 'Productos',   href: '/productos',  icon: Package         },
  { label: 'Proveedores', href: '/proveedores',icon: Users           },
  { label: 'Consultor',   href: '/consultor',  icon: MessageSquare   },
  { label: 'Más',         href: '__menu__',    icon: Menu            },
];

export function AppHeader() {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  };

  const moreIsActive = moreItems.some(i => isActive(i.href));

  return (
    <>
      {/* ─── TOP BAR ─── */}
      <header className="sticky top-0 z-50 bg-header border-b border-white/10">
        <div className="mx-auto px-3 lg:px-4">
          <div className="flex items-center h-12 gap-0.5">

            {/* Logo */}
            <Link href="/" className="flex items-center mr-3 shrink-0 gap-2">
              <Image
                src="/brand/acqua-logo-white.png"
                alt="ACQUA"
                width={92}
                height={30}
                style={{ width: 92, height: 'auto' }}
                priority
              />
              <span className="text-white/30 text-[10px] font-semibold uppercase tracking-widest hidden sm:block border-l border-white/15 pl-2">
                CONTROL OS
              </span>
            </Link>

            {/* Nav — Desktop only */}
            <nav className="hidden lg:flex items-center gap-0.5 flex-1 min-w-0">
              {primaryNavItems.map((item) => {
                const Icon = item.icon;
                const active = isActive(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      'flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition-all duration-150 whitespace-nowrap shrink-0',
                      active ? 'bg-acqua text-white' : 'text-white/65 hover:text-white hover:bg-white/10'
                    )}
                  >
                    <Icon className="w-3 h-3" />
                    {item.label}
                  </Link>
                );
              })}

              {/* Más dropdown */}
              <div className="relative shrink-0 ml-0.5">
                <button
                  onClick={() => setMoreOpen(!moreOpen)}
                  onBlur={() => setTimeout(() => setMoreOpen(false), 150)}
                  className={cn(
                    'flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition-all duration-150 whitespace-nowrap',
                    moreIsActive ? 'bg-acqua text-white' : 'text-white/45 hover:text-white/70 hover:bg-white/10'
                  )}
                >
                  Más
                  <ChevronDown className={cn('w-3 h-3 transition-transform', moreOpen && 'rotate-180')} />
                </button>
                {moreOpen && (
                  <div className="absolute top-full left-0 mt-1.5 bg-[#1a1a1a] border border-white/10 rounded-xl py-1.5 min-w-[150px] shadow-2xl z-50">
                    {moreItems.map((item) => {
                      const Icon = item.icon;
                      const active = isActive(item.href);
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          className={cn(
                            'flex items-center gap-2.5 px-4 py-2 text-[12px] font-medium transition-colors',
                            active ? 'text-acqua' : 'text-white/70 hover:text-white hover:bg-white/5'
                          )}
                        >
                          <Icon className="w-3.5 h-3.5" />
                          {item.label}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="w-px h-5 bg-white/10 mx-1.5 shrink-0" />

              <DeployButton />

              {specialNavItems.map((item) => {
                const Icon = item.icon;
                const active = isActive(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      'flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-all duration-150 whitespace-nowrap shrink-0',
                      active ? 'ring-2 ring-white/30' : '',
                      item.className
                    )}
                  >
                    {item.logoText ? (
                      <>
                        <span className="font-bold text-[11px] italic">{item.logoText}</span>
                        <span className="ml-0.5 hidden xl:inline">Export</span>
                      </>
                    ) : (
                      <>
                        <Icon className="w-3 h-3" />
                        <span className="hidden xl:inline">{item.label}</span>
                        <span className="xl:hidden">ML</span>
                      </>
                    )}
                  </Link>
                );
              })}
            </nav>

            {/* Right side */}
            <div className="flex items-center gap-1 ml-auto">
              <button className="relative flex items-center justify-center w-8 h-8 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors">
                <Bell className="w-4 h-4" />
                <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-danger text-white text-[10px] font-bold rounded-full flex items-center justify-center">3</span>
              </button>
              <button className="hidden sm:flex items-center gap-1.5 pl-2 pr-1 py-1 rounded-lg hover:bg-white/10 transition-colors">
                <div className="w-6 h-6 rounded-full bg-acqua/30 border border-acqua/50 flex items-center justify-center">
                  <span className="text-white text-[10px] font-bold">EP</span>
                </div>
                <span className="hidden xl:block text-white/80 text-[12px] font-medium">Enrico Pacheco</span>
                <ChevronDown className="w-3 h-3 text-white/40 hidden xl:block" />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* ─── MOBILE BOTTOM NAV ─── */}
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-header border-t border-white/10 safe-area-bottom">
        <div className="flex items-stretch h-16">
          {bottomNavItems.map((item) => {
            const Icon = item.icon;
            const isMenu = item.href === '__menu__';
            const active = !isMenu && isActive(item.href);

            if (isMenu) {
              return (
                <button
                  key="menu"
                  onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                  className={cn(
                    'flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors',
                    mobileMenuOpen ? 'text-acqua' : 'text-white/50'
                  )}
                >
                  {mobileMenuOpen
                    ? <X className="w-5 h-5" />
                    : <Menu className="w-5 h-5" />}
                  <span className="text-[9px] font-semibold">Más</span>
                </button>
              );
            }

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex-1 flex flex-col items-center justify-center gap-0.5 transition-colors',
                  active ? 'text-acqua' : 'text-white/50 hover:text-white/80'
                )}
              >
                <Icon className="w-5 h-5" />
                <span className="text-[9px] font-semibold leading-none">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>

      {/* ─── MOBILE FULL MENU (slide up) ─── */}
      {mobileMenuOpen && (
        <div className="lg:hidden fixed inset-0 z-40 bg-black/60" onClick={() => setMobileMenuOpen(false)}>
          <div
            className="absolute bottom-16 left-0 right-0 bg-[#0D1B2A] border-t border-white/10 rounded-t-2xl px-4 pt-4 pb-6"
            onClick={e => e.stopPropagation()}
          >
            <div className="w-10 h-1 bg-white/20 rounded-full mx-auto mb-4" />
            <p className="text-[10px] font-bold text-white/30 uppercase tracking-widest mb-2 px-1">Módulos</p>
            <div className="grid grid-cols-3 gap-2 mb-4">
              {[...primaryNavItems, ...moreItems].map((item) => {
                const Icon = item.icon;
                const active = isActive(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileMenuOpen(false)}
                    className={cn(
                      'flex flex-col items-center gap-1.5 px-2 py-3 rounded-xl text-[11px] font-semibold transition-colors',
                      active ? 'bg-acqua text-white' : 'bg-white/5 text-white/70 hover:bg-white/10'
                    )}
                  >
                    <Icon className="w-5 h-5" />
                    <span className="text-center leading-tight">{item.label}</span>
                  </Link>
                );
              })}
            </div>
            <p className="text-[10px] font-bold text-white/30 uppercase tracking-widest mb-2 px-1">Integrations</p>
            <div className="flex gap-2">
              {specialNavItems.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileMenuOpen(false)}
                    className={cn(
                      'flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-[12px] font-semibold',
                      item.className
                    )}
                  >
                    {item.logoText
                      ? <span className="font-bold italic">{item.logoText} Export</span>
                      : <><Icon className="w-4 h-4" />{item.label}</>}
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
