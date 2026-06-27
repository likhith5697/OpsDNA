import { useState, useRef, useCallback } from 'react';

/**
 * Drag-to-resize a panel's pixel width.
 * sign=1 for a panel anchored on the left (dragging right grows it),
 * sign=-1 for a panel anchored on the right (dragging left grows it).
 */
export function useResizablePanel(initial: number, min: number, max: number, sign: 1 | -1) {
  const [width, setWidth] = useState(initial);
  const startX = useRef(0);
  const startWidth = useRef(initial);

  const onMouseMove = useCallback(
    (e: MouseEvent) => {
      const delta = (e.clientX - startX.current) * sign;
      setWidth(Math.min(max, Math.max(min, startWidth.current + delta)));
    },
    [sign, min, max]
  );

  const onMouseUp = useCallback(() => {
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
  }, [onMouseMove]);

  const startDrag = useCallback(
    (e: React.MouseEvent) => {
      startX.current = e.clientX;
      startWidth.current = width;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    },
    [width, onMouseMove, onMouseUp]
  );

  return { width, startDrag };
}
