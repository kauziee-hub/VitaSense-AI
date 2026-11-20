import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';

import { api } from '@/lib/api';

import { calendarPermission, calendarSupported, readCalendarDays } from './calendar';
import { validGmailToken } from './gmail';
import { healthConnected, healthSourceKey, healthSupported, readHealthDays } from './health';
import { syncAlerts, syncBand, syncUsage } from './phone';

/**
 * Background-ish collection: runs when the app opens or returns to the foreground, for each
 * source the user switched on, no more often than its interval. Nothing here asks for a
 * permission: switching a source on (Connected data screen) is where permission is asked.
 */

export type SourceId = 'location' | 'health' | 'calendar' | 'gmail' | 'usage' | 'alerts' | 'band';

export interface SourcePrefs {
  enabled: boolean;
  lastSync?: number;
  lastError?: string | null;
  summary?: string;
}

export type AllPrefs = Record<SourceId, SourcePrefs>;

const INTERVAL_MS: Record<SourceId, number> = {
  location: 3 * 60 * 60 * 1000,
  health: 60 * 60 * 1000,
  calendar: 6 * 60 * 60 * 1000,
  gmail: 6 * 60 * 60 * 1000,
  usage: 3 * 60 * 60 * 1000,
  alerts: 30 * 60 * 1000,
  band: 30 * 60 * 1000,
};

const DEFAULTS: AllPrefs = {
  location: { enabled: false },
  health: { enabled: false },
  calendar: { enabled: false },
  gmail: { enabled: false },
  usage: { enabled: false },
  alerts: { enabled: false },
  band: { enabled: false },
};

/** Sync source -> the factor catalogue's source id (collect/factors.py). */
export const FACTOR_SOURCE: Record<SourceId, string> = {
  location: 'location',
  health: 'health_connect',
  calendar: 'calendar',
  gmail: 'gmail',
  usage: 'phone_usage',
  alerts: 'notifications',
  band: 'band',
};

export async function enabledFactorSources(userId: number): Promise<string[]> {
  const prefs = await loadPrefs(userId);
  return (Object.keys(prefs) as SourceId[]).filter((id) => prefs[id]?.enabled).map((id) => FACTOR_SOURCE[id]);
}

const prefsKey = (userId: number) => `vitasense.sources.${userId}`;

export async function loadPrefs(userId: number): Promise<AllPrefs> {
  try {
    const raw = await AsyncStorage.getItem(prefsKey(userId));
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<AllPrefs>) } : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

export async function savePrefs(userId: number, prefs: AllPrefs): Promise<void> {
  await AsyncStorage.setItem(prefsKey(userId), JSON.stringify(prefs)).catch(() => undefined);
}

export async function setSourceEnabled(userId: number, source: SourceId, enabled: boolean): Promise<AllPrefs> {
  const prefs = await loadPrefs(userId);
  prefs[source] = { ...prefs[source], enabled, lastError: null, ...(enabled ? {} : { lastSync: undefined, summary: undefined }) };
  await savePrefs(userId, prefs);
  return prefs;
}

async function syncLocation(userId: number): Promise<string> {
  const permission = await Location.getForegroundPermissionsAsync();
  if (!permission.granted) throw new Error('Location permission is off');
  const recent = await Location.getLastKnownPositionAsync({ maxAge: 30 * 60 * 1000 }).catch(() => null);
  const position = recent ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
  const result = await api.collectEnvironment(userId, position.coords.latitude, position.coords.longitude);
  const aqi = result.today.aqi != null ? ` · AQI ${result.today.aqi}` : '';
  return `${result.place.label}${aqi}`;
}

async function syncHealth(userId: number): Promise<string> {
  if (!healthSupported) throw new Error('Not available on this device');
  if (!(await healthConnected())) throw new Error('Health Connect access is off');
  const days = await readHealthDays(14);
  if (!days.length) return 'No data in Health Connect yet';
  await api.collectDevice(userId, { source: healthSourceKey, health: days });
  const last = days[days.length - 1];
  return last.sleep_minutes ? `Last night ${(last.sleep_minutes / 60).toFixed(1)} h sleep` : `${days.length} days synced`;
}

async function syncCalendar(userId: number): Promise<string> {
  if (!calendarSupported) throw new Error('Phone app only');
  if (!(await calendarPermission(false))) throw new Error('Calendar permission is off');
  const days = await readCalendarDays(14);
  await api.collectDevice(userId, { source: 'calendar', calendar: days });
  const today = days[days.length - 1];
  return today ? `Today ${today.event_count} events, ${(today.busy_minutes / 60).toFixed(1)} h busy` : 'Synced';
}

async function syncGmail(userId: number, token?: string): Promise<string> {
  const accessToken = token ?? (await validGmailToken(userId));
  if (!accessToken) throw new Error('Sign in to Gmail again to sync');
  const result = await api.collectGmail(userId, accessToken);
  const reports = result.reports_added ? `, ${result.reports_added} lab reports` : '';
  return `${result.orders_found} orders found in ${result.emails_read} new emails${reports}`;
}

const RUNNERS: Record<SourceId, (userId: number) => Promise<string>> = {
  location: syncLocation,
  health: syncHealth,
  calendar: syncCalendar,
  gmail: (userId) => syncGmail(userId),
  usage: syncUsage,
  alerts: syncAlerts,
  band: syncBand,
};

let running: Promise<boolean> | null = null;

/**
 * Sync every enabled source that is due (or all enabled ones with `force`).
 * Returns true if anything new reached the server, so the caller can refresh the forecast.
 */
export function syncSources(userId: number, { force = false, only }: { force?: boolean; only?: SourceId } = {}): Promise<boolean> {
  if (running && !only) return running;
  const task = (async () => {
    const prefs = await loadPrefs(userId);
    let changed = false;
    for (const source of Object.keys(RUNNERS) as SourceId[]) {
      if (only && source !== only) continue;
      const state = prefs[source];
      if (!state.enabled) continue;
      if (!force && state.lastSync && Date.now() - state.lastSync < INTERVAL_MS[source]) continue;
      try {
        const summary = await RUNNERS[source](userId);
        prefs[source] = { ...state, lastSync: Date.now(), lastError: null, summary };
        changed = true;
      } catch (error) {
        prefs[source] = { ...state, lastError: error instanceof Error ? error.message : 'Sync failed' };
      }
    }
    await savePrefs(userId, prefs);
    return changed;
  })();
  if (!only) {
    running = task.finally(() => {
      running = null;
    });
    return running;
  }
  return task;
}

/** Gmail right after sign-in, with the fresh token. */
export async function syncGmailNow(userId: number, token: string): Promise<AllPrefs> {
  const prefs = await loadPrefs(userId);
  try {
    const summary = await syncGmail(userId, token);
    prefs.gmail = { enabled: true, lastSync: Date.now(), lastError: null, summary };
  } catch (error) {
    prefs.gmail = { ...prefs.gmail, enabled: true, lastError: error instanceof Error ? error.message : 'Sync failed' };
  }
  await savePrefs(userId, prefs);
  return prefs;
}
