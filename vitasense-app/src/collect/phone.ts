import AsyncStorage from '@react-native-async-storage/async-storage';
import { PermissionsAndroid, Platform } from 'react-native';

import { api, type AppAlertPayload, type ScreenDayPayload } from '@/lib/api';

import { addBandListener, VitasenseDevice } from '../../modules/vitasense-device';

/**
 * Android phone collectors backed by modules/vitasense-device:
 *  - phone usage: screen time, night use, unlocks and a screen-off sleep estimate;
 *  - order alerts: food, grocery and pharmacy app notifications;
 *  - fitness band: live Bluetooth heart rate, kept as daily average + resting estimate.
 * All return quietly on web / iPhone, where `phoneSupported` is false.
 */

export const phoneSupported = Platform.OS === 'android' && VitasenseDevice != null;

function dayKey(time: number | Date): string {
  const d = new Date(time);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/* ---------- phone usage ---------- */

export function usageGranted(): boolean {
  try {
    return !!VitasenseDevice?.hasUsageAccess();
  } catch {
    return false;
  }
}

export function openUsageSettings(): void {
  VitasenseDevice?.openUsageAccessSettings();
}

export async function syncUsage(userId: number): Promise<string> {
  if (!VitasenseDevice) throw new Error('Android app only');
  if (!usageGranted()) throw new Error('Usage access is off');
  const days = await VitasenseDevice.readUsageDays(14);
  const screen: ScreenDayPayload[] = days
    .filter((d) => d.screen_minutes > 0 || d.quiet_minutes)
    .map((d) => ({
      date: d.date,
      screen_minutes: Math.round(d.screen_minutes),
      late_night_minutes: Math.round(d.late_night_minutes),
      longest_session_minutes: Math.round(d.longest_session_minutes),
      unlocks: d.unlocks,
      quiet_start: d.quiet_start,
      quiet_end: d.quiet_end,
      quiet_minutes: d.quiet_minutes,
    }));
  if (!screen.length) return 'No phone use recorded yet';
  await api.collectDevice(userId, { source: 'screen_time', screen });
  const today = screen[screen.length - 1];
  const sleep = today.quiet_minutes ? ` · screen off ${(today.quiet_minutes / 60).toFixed(1)} h overnight` : '';
  return `Today ${(today.screen_minutes / 60).toFixed(1)} h screen time${sleep}`;
}

/* ---------- order alerts ---------- */

const alertsMarkKey = (userId: number) => `vitasense.alerts.uploadedUntil.${userId}`;

export function alertsGranted(): boolean {
  try {
    return !!VitasenseDevice?.hasNotificationAccess();
  } catch {
    return false;
  }
}

export function openAlertSettings(): void {
  VitasenseDevice?.openNotificationAccessSettings();
}

export async function syncAlerts(userId: number): Promise<string> {
  if (!VitasenseDevice) throw new Error('Android app only');
  if (!alertsGranted()) throw new Error('Notification access is off');
  const since = Number((await AsyncStorage.getItem(alertsMarkKey(userId))) ?? 0);
  const alerts = await VitasenseDevice.readOrderAlerts(since);
  if (!alerts.length) return 'Waiting for the next order alert';
  let orders = 0;
  for (let i = 0; i < alerts.length; i += 100) {
    const batch: AppAlertPayload[] = alerts.slice(i, i + 100).map((a) => ({
      id: a.id,
      package: a.package,
      title: a.title,
      text: a.text,
      posted_at: new Date(a.postedAt).toISOString(),
    }));
    orders += (await api.collectAppAlerts(userId, batch)).orders_found;
  }
  const until = Math.max(...alerts.map((a) => a.postedAt));
  await AsyncStorage.setItem(alertsMarkKey(userId), String(until));
  VitasenseDevice.clearOrderAlerts(until);
  return `${orders} order${orders === 1 ? '' : 's'} found in ${alerts.length} app alert${alerts.length === 1 ? '' : 's'}`;
}

/* ---------- fitness band (Bluetooth heart rate) ---------- */

const BAND_KEY = 'vitasense.band';

interface BandDay {
  sum: number;
  count: number;
  restingLow: number | null; // lowest one-minute average while worn
}

interface BandStore {
  device: { id: string; name: string } | null;
  days: Record<string, BandDay>;
}

async function loadBand(): Promise<BandStore> {
  try {
    const raw = await AsyncStorage.getItem(BAND_KEY);
    return raw ? (JSON.parse(raw) as BandStore) : { device: null, days: {} };
  } catch {
    return { device: null, days: {} };
  }
}

async function saveBand(store: BandStore): Promise<void> {
  await AsyncStorage.setItem(BAND_KEY, JSON.stringify(store)).catch(() => undefined);
}

export async function bandDevice(): Promise<{ id: string; name: string } | null> {
  return (await loadBand()).device;
}

export async function rememberBand(device: { id: string; name: string } | null): Promise<void> {
  const store = await loadBand();
  store.device = device;
  await saveBand(store);
}

export async function bandPermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  const version = typeof Platform.Version === 'number' ? Platform.Version : parseInt(String(Platform.Version), 10);
  const wanted =
    version >= 31
      ? [PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN, PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT]
      : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
  const result = await PermissionsAndroid.requestMultiple(wanted);
  return wanted.every((p) => result[p] === PermissionsAndroid.RESULTS.GRANTED);
}

export function bluetoothState(): 'unsupported' | 'off' | 'on' {
  try {
    return VitasenseDevice?.bluetoothState() ?? 'unsupported';
  } catch {
    return 'unsupported';
  }
}

export const band = {
  scan: (seconds = 15) => VitasenseDevice?.startBandScan(seconds),
  stopScan: () => VitasenseDevice?.stopBandScan(),
  connect: (id: string) => VitasenseDevice?.connectBand(id),
  disconnect: () => VitasenseDevice?.disconnectBand(),
  openBluetoothSettings: () => VitasenseDevice?.openBluetoothSettings(),
  onDevice: (fn: (d: { id: string; name: string; rssi: number }) => void) => addBandListener('onBandDevice', fn),
  onHeartRate: (fn: (r: { bpm: number; contact: boolean | null; at: number }) => void) => addBandListener('onHeartRate', fn),
  onState: (fn: (s: { state: string; id?: string; name?: string; battery?: number }) => void) => addBandListener('onBandState', fn),
};

/** Folds live readings into per-day totals; call for every reading while the band streams. */
let minute: { key: string; sum: number; count: number } | null = null;
let pending: BandStore | null = null;
export async function recordHeartRate(bpm: number, at: number, contact: boolean | null): Promise<void> {
  if (bpm < 30 || bpm > 230 || contact === false) return; // not worn or a glitch
  const store = pending ?? (pending = await loadBand());
  const day = dayKey(at);
  const entry = (store.days[day] ??= { sum: 0, count: 0, restingLow: null });
  entry.sum += bpm;
  entry.count += 1;
  const minuteKey = `${day}T${new Date(at).getHours()}:${new Date(at).getMinutes()}`;
  if (minute && minute.key !== minuteKey && minute.count >= 20) {
    const avg = minute.sum / minute.count;
    const minuteDay = minute.key.slice(0, 10);
    const m = (store.days[minuteDay] ??= { sum: 0, count: 0, restingLow: null });
    m.restingLow = m.restingLow == null ? avg : Math.min(m.restingLow, avg);
  }
  if (!minute || minute.key !== minuteKey) minute = { key: minuteKey, sum: 0, count: 0 };
  minute.sum += bpm;
  minute.count += 1;
  if (entry.count % 30 === 0) await saveBand(store);
}

export async function flushHeartRate(): Promise<void> {
  if (pending) await saveBand(pending);
}

export async function syncBand(userId: number): Promise<string> {
  await flushHeartRate();
  const store = await loadBand();
  const days = Object.entries(store.days).filter(([, d]) => d.count >= 30);
  if (!days.length) return store.device ? `Paired with ${store.device.name}; waiting for readings` : 'No band paired';
  await api.collectDevice(userId, {
    source: 'band',
    health: days.map(([date, d]) => ({
      date,
      heart_rate_avg: Math.round(d.sum / d.count),
      ...(d.restingLow != null ? { resting_heart_rate: Math.round(d.restingLow) } : {}),
    })),
  });
  // Keep only the last week of totals on the phone.
  const cutoff = dayKey(Date.now() - 7 * 86400000);
  store.days = Object.fromEntries(Object.entries(store.days).filter(([day]) => day >= cutoff));
  await saveBand(store);
  pending = null;
  const [lastDay, last] = days[days.length - 1];
  return `${lastDay === dayKey(Date.now()) ? 'Today' : lastDay}: average ${Math.round(last.sum / last.count)} bpm`;
}
