import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { api, type AppUser, type BiologicalSex, type Forecast, type Health } from './api';

const ACTIVE_USER_KEY = 'vitasense.activeUser';

interface SessionValue {
  ready: boolean;
  user: AppUser | null;
  signIn: (user: AppUser) => Promise<void>;
  signOut: () => Promise<void>;
  /** Saves which body the profile is shown with (on this device at once, then on the server). */
  setBodySex: (sex: BiologicalSex) => Promise<void>;
  health: Health | null;
  forecast: Forecast | null;
  forecastError: string | null;
  refreshForecast: () => Promise<void>;
  /** Pre-filled question handed from the dashboard to the Ask screen. */
  pendingQuestion: string | null;
  setPendingQuestion: (question: string | null) => void;
}

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<AppUser | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const [forecastError, setForecastError] = useState<string | null>(null);
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(ACTIVE_USER_KEY)
      .then((raw) => {
        if (!raw) return;
        const parsed = JSON.parse(raw) as AppUser;
        if (typeof parsed.id === 'number' && parsed.name) setUser(parsed);
      })
      .catch(() => undefined)
      .finally(() => setReady(true));
    api.health().then(setHealth).catch(() => setHealth(null));
  }, []);

  const refreshForecast = useCallback(async () => {
    if (!user) return;
    setForecastError(null);
    try {
      setForecast(await api.forecast(user.id));
    } catch (error) {
      setForecastError(error instanceof Error ? error.message : 'Could not load your forecast');
    }
  }, [user]);

  // Load the forecast whenever the active profile changes.
  useEffect(() => {
    if (!user) return;
    let alive = true;
    api
      .forecast(user.id)
      .then((next) => {
        if (!alive) return;
        setForecast(next);
        setForecastError(null);
      })
      .catch((error: unknown) => {
        if (alive) setForecastError(error instanceof Error ? error.message : 'Could not load your forecast');
      });
    return () => {
      alive = false;
    };
  }, [user]);

  const signIn = useCallback(async (next: AppUser) => {
    setForecast(null);
    setUser(next);
    await AsyncStorage.setItem(ACTIVE_USER_KEY, JSON.stringify(next)).catch(() => undefined);
  }, []);

  const setBodySex = useCallback(
    async (sex: BiologicalSex) => {
      if (!user) return;
      const next = { ...user, biological_sex: sex };
      setUser(next);
      await AsyncStorage.setItem(ACTIVE_USER_KEY, JSON.stringify(next)).catch(() => undefined);
      await api.updateUser(user.id, { biological_sex: sex }).catch(() => undefined);
    },
    [user],
  );

  const signOut = useCallback(async () => {
    setUser(null);
    setForecast(null);
    await AsyncStorage.removeItem(ACTIVE_USER_KEY).catch(() => undefined);
  }, []);

  const value = useMemo<SessionValue>(
    () => ({
      ready,
      user,
      signIn,
      signOut,
      setBodySex,
      health,
      forecast,
      forecastError,
      refreshForecast,
      pendingQuestion,
      setPendingQuestion,
    }),
    [ready, user, signIn, signOut, setBodySex, health, forecast, forecastError, refreshForecast, pendingQuestion],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionValue {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used inside SessionProvider');
  return value;
}
