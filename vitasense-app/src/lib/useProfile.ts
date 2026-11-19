import { useCallback, useEffect, useState } from 'react';

import { api } from './api';
import { useSession } from './session';

export type ProfileTables = Record<string, Record<string, unknown>>;

interface Loaded {
  userId: number;
  tables: ProfileTables | null;
  error: string | null;
}

export function useProfile() {
  const { user } = useSession();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    api
      .setupContext(user.id)
      .then((r) => alive && setLoaded({ userId: user.id, tables: r.tables, error: null }))
      .catch(
        (e: unknown) =>
          alive && setLoaded({ userId: user.id, tables: null, error: e instanceof Error ? e.message : 'Could not load your profile' }),
      );
    return () => {
      alive = false;
    };
  }, [user, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  // Ignore a result that belongs to a previously selected profile.
  const current = loaded && user && loaded.userId === user.id ? loaded : null;
  return { tables: current?.tables ?? null, error: current?.error ?? null, reload };
}

export function listField(tables: ProfileTables | null, table: string, field: string): string[] {
  const value = tables?.[table]?.[field];
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0 && !/^no major history/i.test(v));
}

export function textField(tables: ProfileTables | null, table: string, field: string): string | null {
  const value = tables?.[table]?.[field];
  return typeof value === 'string' && value.trim() ? value : null;
}
