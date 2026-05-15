'use client';

import { cn } from '@/lib/utils';
import { Search, LayoutGrid, List, Columns3, Download } from 'lucide-react';

interface FilterBarProps {
  searchPlaceholder?: string;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  filterOptions?: { label: string; value: string }[];
  filterValue?: string;
  onFilterChange?: (value: string) => void;
  view?: 'cards' | 'list' | 'kanban';
  onViewChange?: (view: 'cards' | 'list' | 'kanban') => void;
  showViews?: boolean;
  showExport?: boolean;
  className?: string;
}

export function FilterBar({
  searchPlaceholder = 'Buscar...',
  searchValue,
  onSearchChange,
  filterOptions,
  filterValue,
  onFilterChange,
  view = 'cards',
  onViewChange,
  showViews = true,
  showExport = false,
  className,
}: FilterBarProps) {
  return (
    <div className={cn('flex flex-col sm:flex-row items-stretch sm:items-center gap-3', className)}>
      {/* Search */}
      <div className="relative flex-1 max-w-xl">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="text"
          placeholder={searchPlaceholder}
          value={searchValue || ''}
          onChange={(e) => onSearchChange?.(e.target.value)}
          className="w-full pl-10 pr-4 py-2.5 rounded-lg border border-gray-200 bg-white text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-acqua/30 focus:border-acqua transition-all"
        />
      </div>

      {/* Filter */}
      {filterOptions && (
        <select
          value={filterValue || ''}
          onChange={(e) => onFilterChange?.(e.target.value)}
          className="px-3 py-2.5 rounded-lg border border-gray-200 bg-white text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-acqua/30 focus:border-acqua"
        >
          {filterOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      )}

      {/* View toggle */}
      {showViews && (
        <div className="flex items-center rounded-lg border border-gray-200 bg-white overflow-hidden">
          <button
            onClick={() => onViewChange?.('cards')}
            className={cn(
              'flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors',
              view === 'cards' ? 'bg-acqua text-white' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
            )}
          >
            <LayoutGrid className="w-4 h-4" />
            <span className="hidden sm:inline">Cards</span>
          </button>
          <button
            onClick={() => onViewChange?.('list')}
            className={cn(
              'flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors border-l border-gray-200',
              view === 'list' ? 'bg-acqua text-white' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
            )}
          >
            <List className="w-4 h-4" />
            <span className="hidden sm:inline">Lista</span>
          </button>
          <button
            onClick={() => onViewChange?.('kanban')}
            className={cn(
              'flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition-colors border-l border-gray-200',
              view === 'kanban' ? 'bg-acqua text-white' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'
            )}
          >
            <Columns3 className="w-4 h-4" />
            <span className="hidden sm:inline">Kanban</span>
          </button>
        </div>
      )}

      {/* Export */}
      {showExport && (
        <button className="flex items-center gap-1.5 px-3 py-2.5 rounded-lg border border-gray-200 bg-white text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors">
          <Download className="w-4 h-4" />
          Exportar
        </button>
      )}
    </div>
  );
}
