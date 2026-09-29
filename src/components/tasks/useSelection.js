import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

// Multi-selection over an ordered list of ids, with Shift range selection.
// Ids that are no longer visible are dropped so bulk actions never touch hidden tasks.
export function useSelection(orderedIds) {
  const [selected, setSelected] = useState(() => new Set());
  const anchor = useRef(null);

  useEffect(() => {
    setSelected(prev => {
      if (!prev.size) return prev;
      const visible = new Set(orderedIds);
      const next = [...prev].filter(id => visible.has(id));
      return next.length === prev.size ? prev : new Set(next);
    });
  }, [orderedIds]);

  const toggle = useCallback((id, { range = false } = {}) => {
    setSelected(prev => {
      const next = new Set(prev);
      const from = anchor.current ? orderedIds.indexOf(anchor.current) : -1;
      const to = orderedIds.indexOf(id);
      if (range && from >= 0 && to >= 0) {
        const [a, b] = from < to ? [from, to] : [to, from];
        const select = !prev.has(id);
        orderedIds.slice(a, b + 1).forEach(x => (select ? next.add(x) : next.delete(x)));
      } else if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    anchor.current = id;
  }, [orderedIds]);

  const setMany = useCallback((ids, value) => setSelected(prev => {
    const next = new Set(prev);
    ids.forEach(id => (value ? next.add(id) : next.delete(id)));
    return next;
  }), []);

  const clear = useCallback(() => { setSelected(new Set()); anchor.current = null; }, []);
  const ids = useMemo(() => [...selected], [selected]);

  return { selected, ids, count: selected.size, isSelected: id => selected.has(id), toggle, setMany, clear };
}
