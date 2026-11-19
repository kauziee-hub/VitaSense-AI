import { useCallback, useEffect, useState } from 'react';

import { api, type HealthRecord, type RecordsSummary, type TodaySchedule } from './api';
import { syncMedicineReminders } from './reminders';
import { useSession } from './session';

interface Loaded {
  userId: number;
  records: HealthRecord[];
  summary: RecordsSummary | null;
  today: TodaySchedule | null;
  error: string | null;
}

/** Uploaded records, what they add up to, and today's medicine schedule for the active profile. */
export function useRecords() {
  const { user } = useSession();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    Promise.all([api.records(user.id), api.medicationsToday(user.id)])
      .then(([records, today]) => {
        if (!alive) return;
        setLoaded({ userId: user.id, records: records.records, summary: records.summary, today, error: null });
        // Keep phone alarms in step with the current medicine list.
        void syncMedicineReminders(today.medications, today.date).catch(() => undefined);
      })
      .catch((e: unknown) => {
        if (alive) {
          setLoaded({ userId: user.id, records: [], summary: null, today: null, error: e instanceof Error ? e.message : 'Could not load records' });
        }
      });
    return () => {
      alive = false;
    };
  }, [user, version]);

  const reload = useCallback(() => setVersion((v) => v + 1), []);
  const current = loaded && user && loaded.userId === user.id ? loaded : null;

  /** Show a dose change straight away; the server answer replaces it. */
  const setToday = useCallback(
    (next: Omit<TodaySchedule, 'medications'>) =>
      setLoaded((prev) => (prev && prev.today ? { ...prev, today: { ...prev.today, ...next } } : prev)),
    [],
  );

  return {
    loading: current === null,
    records: current?.records ?? [],
    summary: current?.summary ?? null,
    today: current?.today ?? null,
    error: current?.error ?? null,
    reload,
    setToday,
  };
}
