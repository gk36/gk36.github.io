import { useEffect, useRef, useState } from 'preact/hooks';
import { liveQuery } from 'dexie';

/** Subscribes to a Dexie query; re-renders whenever the underlying tables change. */
export function useLive<T>(query: () => Promise<T> | T, deps: readonly unknown[], initial: T): T {
  const [value, setValue] = useState<T>(initial);
  useEffect(() => {
    let alive = true;
    const sub = liveQuery(query).subscribe({
      next: (v) => { if (alive) setValue(v); },
      error: (e: unknown) => console.error('liveQuery failed', e),
    });
    return () => { alive = false; sub.unsubscribe(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return value;
}

/** Resolves a promise into state (undefined while loading). */
export function useAsync<T>(fn: () => Promise<T>, deps: readonly unknown[]): T | undefined {
  const [v, setV] = useState<T | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    fn().then((r) => { if (alive) setV(r); }).catch((e: unknown) => console.error(e));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return v;
}

let idSeq = 0;
export function useId(prefix = 'id'): string {
  const ref = useRef<string>();
  if (!ref.current) ref.current = `${prefix}-${++idSeq}`;
  return ref.current;
}
