import { useState, useCallback } from 'react';

/**
 * useColumnResize — drag handle para redimensionar columnas de tabla.
 *
 * Uso:
 *   const { widths, startResize } = useColumnResize({ nombre: 240, costo: 110, precio: 120 });
 *
 *   En el <th>:
 *     <th style={{ width: widths.nombre }}>
 *       Nombre
 *       <div className="col-resize-handle" onMouseDown={startResize('nombre')} />
 *     </th>
 */
export function useColumnResize<K extends string>(initial: Record<K, number>) {
  const [widths, setWidths] = useState<Record<K, number>>(initial);

  const startResize = useCallback(
    (col: K) => (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const startX     = e.clientX;
      const startWidth = widths[col];

      const onMove = (ev: MouseEvent) => {
        const newWidth = Math.max(48, startWidth + ev.clientX - startX);
        setWidths(prev => ({ ...prev, [col]: newWidth }));
      };

      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };

      document.body.style.cursor     = 'col-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [widths],
  );

  return { widths, startResize };
}
