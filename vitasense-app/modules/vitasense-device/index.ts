import { type EventSubscription, NativeModule, requireOptionalNativeModule } from 'expo';

export interface UsageDay {
  date: string;
  screen_minutes: number;
  late_night_minutes: number;
  longest_session_minutes: number;
  unlocks: number;
  first_use: string | null;
  last_use: string | null;
  /** Longest screen-off stretch in the night ending that morning (a sleep estimate). */
  quiet_start: string | null;
  quiet_end: string | null;
  quiet_minutes: number | null;
}

export interface OrderAlert {
  id: string;
  package: string;
  title: string;
  text: string;
  postedAt: number;
}

export type BandEvents = {
  onBandDevice: (event: { id: string; name: string; rssi: number }) => void;
  onHeartRate: (event: { bpm: number; contact: boolean | null; at: number }) => void;
  onBandState: (event: { state: string; id?: string; name?: string; battery?: number; code?: number }) => void;
};

declare class VitasenseDeviceModule extends NativeModule<BandEvents> {
  hasUsageAccess(): boolean;
  openUsageAccessSettings(): void;
  readUsageDays(days: number): Promise<UsageDay[]>;
  hasNotificationAccess(): boolean;
  openNotificationAccessSettings(): void;
  watchedApps(): string[];
  readOrderAlerts(sinceMs: number): Promise<OrderAlert[]>;
  clearOrderAlerts(untilMs: number): void;
  bluetoothState(): 'unsupported' | 'off' | 'on';
  openBluetoothSettings(): void;
  startBandScan(seconds: number): void;
  stopBandScan(): void;
  connectBand(address: string): void;
  disconnectBand(): void;
}

/** Android only, and only in builds that include the native code; null elsewhere (web, iPhone, Expo Go). */
export const VitasenseDevice = requireOptionalNativeModule<VitasenseDeviceModule>('VitasenseDevice');

export function addBandListener<E extends keyof BandEvents>(event: E, listener: BandEvents[E]): EventSubscription | null {
  return VitasenseDevice ? VitasenseDevice.addListener(event, listener) : null;
}
