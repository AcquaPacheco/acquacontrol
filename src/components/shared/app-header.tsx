'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Image from 'next/image';
import {
  LayoutDashboard, Users, Package, TrendingUp,
  Tag, FileSpreadsheet, MessageSquare, History,
  Settings, Bell, ChevronDown, Menu, X, FileText,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useState } from 'react';
import { DeployButton } from '@/components/shared/deploy-button';

const primaryNavItems = [
  { label: 'Control',      href: '/',             icon: LayoutDashboard },
  { label: 'Proveedores',  href: '/proveedores',   icon: Users           },
  { label: 'Productos',    href: '/productos',     icon: Package         },
  { label: 'Rentabilidad', href: '/rentabilidad',  icon: TrendingUp      },
  { label: 'Promos',       href: '/promos',        icon: Tag             },
  { label: 'Historial',    href: '/historial',     icon: History         },
  { label: 'Parámetros',   href: '/parametros',    icon: Settings        },
];

const moreItems = [
  { label: 'Consultor',     href: '/consultor',     icon: MessageSquare },
  { label: 'Lista Precios', href: '/lista-precios', icon: FileText      },
];

const bottomNavItems = [
  { label: 'Control',     href: '/',            icon: LayoutDashboard },
  { label: 'Productos',   href: '/productos',   icon: Package         },
  { label: 'Proveedores', href: '/proveedores', icon: Users           },
  { label: 'Consultor',   href: '/consultor',   icon: MessageSquare   },
  { label: 'Más',         href: '__menu__',     icon: Menu            },
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
      <header className="sticky top-0 z-50 bg-header border-b border-white/8">
        <div className="h-[2px] bg-gradient-to-r from-transparent via-acqua/50 to-transparent" />

        <div className="flex items-center h-14 px-4 gap-4">

          {/* ── LOGO ── */}
          <Link href="/" className="flex items-center gap-3 shrink-0">
            <Image
              src="/brand/acqua-logo-white.png"
              alt="ACQUA"
              width={96}
              height={32}
              style={{ width: 96, height: 'auto' }}
              priority
            />
            <div className="hidden sm:flex flex-col leading-none border-l border-white/15 pl-3">
              <span className="text-white/30 text-[9px] font-bold uppercase tracking-[0.2em]">CONTROL</span>
              <span className="text-white/55 text-[9px] font-bold uppercase tracking-[0.2em]">OS</span>
            </div>
          </Link>

          {/* ── NAV CENTRAL ── */}
          <nav className="hidden lg:flex items-center justify-center flex-1 min-w-0 gap-2">

            {/* Módulos */}
            <div className="flex items-center gap-0.5 bg-white/[0.06] rounded-xl px-2 py-1.5">
              {primaryNavItems.map((item) => {
                const Icon = item.icon;
                const active = isActive(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all duration-150 whitespace-nowrap',
                      active
                        ? 'bg-acqua text-white shadow-sm shadow-acqua/40'
                        : 'text-white/60 hover:text-white hover:bg-white/10'
                    )}
                  >
                    <Icon className="w-3.5 h-3.5 shrink-0" />
                    <span className="hidden xl:inline">{item.label}</span>
                  </Link>
                );
              })}

              {/* Más dropdown */}
              <div className="relative ml-0.5">
                <button
                  onClick={() => setMoreOpen(!moreOpen)}
                  onBlur={() => setTimeout(() => setMoreOpen(false), 150)}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all duration-150',
                    moreIsActive
                      ? 'bg-acqua text-white'
                      : 'text-white/45 hover:text-white hover:bg-white/10'
                  )}
                >
                  <span>Más</span>
                  <ChevronDown className={cn('w-3.5 h-3.5 transition-transform duration-200', moreOpen && 'rotate-180')} />
                </button>
                {moreOpen && (
                  <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 bg-[#111c2b] border border-white/10 rounded-xl py-1.5 min-w-[170px] shadow-2xl shadow-black/60 z-50">
                    <div className="w-2 h-2 bg-[#111c2b] border-l border-t border-white/10 rotate-45 absolute -top-1 left-1/2 -translate-x-1/2" />
                    {moreItems.map((item) => {
                      const Icon = item.icon;
                      const active = isActive(item.href);
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          className={cn(
                            'flex items-center gap-2.5 px-4 py-2.5 text-[13px] font-medium transition-colors',
                            active ? 'text-acqua bg-acqua/10' : 'text-white/70 hover:text-white hover:bg-white/5'
                          )}
                        >
                          <Icon className="w-4 h-4" />
                          {item.label}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Separador */}
            <div className="w-px h-7 bg-white/10 mx-1 shrink-0" />

            {/* Integraciones */}
            <div className="flex items-center gap-2">

              {/* Odoo */}
              <Link
                href="/export-odoo"
                className={cn(
                  'flex items-center gap-2 px-3.5 py-2 rounded-xl text-[12px] font-bold transition-all duration-150 whitespace-nowrap border',
                  isActive('/export-odoo')
                    ? 'bg-odoo border-odoo/60 text-white shadow-sm shadow-odoo/30'
                    : 'bg-odoo/15 border-odoo/25 text-odoo-light hover:bg-odoo/30 hover:border-odoo/50'
                )}
              >
                <FileSpreadsheet className="w-3.5 h-3.5 shrink-0" />
                <span className="italic">odoo</span>
              </Link>

              {/* MercadoLibre — siempre visible y amarillo */}
              <Link
                href="/mercadolibre"
                className={cn(
                  'flex items-center gap-2 px-3.5 py-2 rounded-xl text-[12px] font-bold transition-all duration-150 whitespace-nowrap border',
                  isActive('/mercadolibre')
                    ? 'bg-meli border-meli text-meli-dark shadow-sm shadow-meli/40'
                    : 'bg-meli/20 border-meli/40 text-meli hover:bg-meli hover:border-meli hover:text-meli-dark'
                )}
              >
                <Image
                  src="/ml-logo.png"
                  alt="ML"
                  width={16}
                  height={16}
                  style={{ width: 16, height: 16, objectFit: 'contain' }}
                />
                <span>Mercado Libre</span>
              </Link>
            </div>
          </nav>

          {/* ── ACCIONES DERECHA ── */}
          <div className="flex items-center gap-1.5 ml-auto lg:ml-0 shrink-0">

            <DeployButton />

            <div className="w-px h-6 bg-white/10 mx-1 hidden lg:block" />

            {/* Bell */}
            <button className="relative flex items-center justify-center w-9 h-9 rounded-lg text-white/50 hover:text-white hover:bg-white/10 transition-colors">
              <Bell className="w-4 h-4" />
              <span className="absolute top-1 right-1 w-4 h-4 bg-danger text-white text-[9px] font-bold rounded-full flex items-center justify-center leading-none">3</span>
            </button>

            {/* Usuario */}
            <button className="hidden sm:flex items-center gap-2 pl-2 pr-2.5 py-1.5 rounded-xl hover:bg-white/10 transition-colors">
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-acqua/60 to-acqua/20 border border-acqua/50 flex items-center justify-center shrink-0">
                <span className="text-white text-[11px] font-bold">EP</span>
              </div>
              <div className="hidden xl:flex flex-col items-start leading-none">
                <span className="text-white/85 text-[12px] font-semibold">Enrico</span>
                <span className="text-white/35 text-[10px]">Pacheco</span>
              </div>
              <ChevronDown className="w-3.5 h-3.5 text-white/30 hidden xl:block" />
            </button>

            {/* Hamburguesa mobile */}
            <button
              className="lg:hidden flex items-center justify-center w-9 h-9 rounded-lg text-white/60 hover:text-white hover:bg-white/10 transition-colors"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
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
                  {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
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

      {/* ─── MOBILE FULL MENU ─── */}
      {mobileMenuOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
          onClick={() => setMobileMenuOpen(false)}
        >
          <div
            className="absolute bottom-16 left-0 right-0 bg-[#0D1B2A] border-t border-white/10 rounded-t-2xl px-4 pt-4 pb-6"
            onClick={e => e.stopPropagation()}
          >
            <div className="w-10 h-1 bg-white/20 rounded-full mx-auto mb-4" />

            <p className="text-[9px] font-bold text-white/25 uppercase tracking-[0.15em] mb-2 px-1">Módulos</p>
            <div className="grid grid-cols-4 gap-1.5 mb-4">
              {[...primaryNavItems, ...moreItems].map((item) => {
                const Icon = item.icon;
                const active = isActive(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMobileMenuOpen(false)}
                    className={cn(
                      'flex flex-col items-center gap-1.5 px-1 py-3 rounded-xl text-[10px] font-semibold transition-colors',
                      active ? 'bg-acqua text-white' : 'bg-white/5 text-white/65 hover:bg-white/10'
                    )}
                  >
                    <Icon className="w-5 h-5" />
                    <span className="text-center leading-tight">{item.label}</span>
                  </Link>
                );
              })}
            </div>

            <p className="text-[9px] font-bold text-white/25 uppercase tracking-[0.15em] mb-2 px-1">Integraciones</p>
            <div className="flex gap-2">
              <Link
                href="/export-odoo"
                onClick={() => setMobileMenuOpen(false)}
                className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-[12px] font-bold bg-odoo/20 border border-odoo/30 text-odoo-light"
              >
                <FileSpreadsheet className="w-4 h-4" />
                <span className="italic">odoo Export</span>
              </Link>
              <Link
                href="/mercadolibre"
                onClick={() => setMobileMenuOpen(false)}
                className="flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-[13px] font-bold bg-meli/20 border border-meli/40 text-meli"
              >
                <Image src="/ml-logo.png" alt="ML" width={18} height={18} style={{ width: 18, height: 18 }} />
                Mercado Libre
              </Link>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
