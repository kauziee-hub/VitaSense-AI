import { useEffect } from 'react';
import { AppState } from 'react-native';

import { useSession } from '@/lib/session';

import { syncSources } from './sync';

/** Collect from switched-on sources when the app opens and whenever it comes back to the foreground. */
export function useAutoSync() {
  const { user, refreshForecast } = useSession();

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const run = () =>
      syncSources(user.id)
        .then((changed) => {
          if (changed && !cancelled) void refreshForecast();
        })
        .catch(() => undefined);
    void run();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void run();
    });
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, [user, refreshForecast]);
}
