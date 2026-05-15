'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { MessageSquare, ChevronDown, ChevronUp, X } from 'lucide-react';

interface SocioAcquaPanelProps {
  message: string;
  context?: string;
  className?: string;
  defaultOpen?: boolean;
}

export function SocioAcquaPanel({ message, context, className, defaultOpen = false }: SocioAcquaPanelProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className={cn(
          'flex items-center gap-2 bg-gradient-to-r from-gray-900 to-gray-800 text-white rounded-xl px-4 py-3 hover:from-gray-800 hover:to-gray-700 transition-all shadow-lg',
          className
        )}
      >
        <div className="w-8 h-8 rounded-full bg-acqua/20 border border-acqua/40 flex items-center justify-center shrink-0">
          <MessageSquare className="w-4 h-4 text-acqua" />
        </div>
        <div className="text-left">
          <div className="text-[10px] text-white/50 font-medium">Mensaje de nuestro socio</div>
          <div className="text-sm font-semibold">Socio Acqua</div>
        </div>
        <ChevronDown className="w-4 h-4 text-white/40 ml-auto" />
      </button>
    );
  }

  return (
    <div className={cn(
      'bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 rounded-xl p-5 text-white shadow-xl border border-white/5',
      className
    )}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-acqua" />
          <span className="text-[11px] text-white/50 font-medium">Mensaje de nuestro socio</span>
        </div>
        <button
          onClick={() => setIsOpen(false)}
          className="text-white/40 hover:text-white/80 transition-colors"
        >
          <ChevronUp className="w-4 h-4" />
        </button>
      </div>

      <div className="flex gap-4">
        <div className="w-14 h-14 rounded-full bg-acqua/20 border-2 border-acqua/40 flex items-center justify-center shrink-0">
          <span className="text-acqua font-bold text-lg">SA</span>
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-bold mb-1">Socio Acqua</h3>
          <p className="text-sm text-white/70 leading-relaxed">{message}</p>
          {context && (
            <p className="text-xs text-white/40 mt-2">{context}</p>
          )}
        </div>
      </div>
    </div>
  );
}
