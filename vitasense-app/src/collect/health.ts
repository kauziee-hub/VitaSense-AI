import type { HealthDayPayload } from '@/lib/api';

/**
 * Phone health data. Android reads Health Connect (health.android.ts). iPhone (Apple Health)
 * and the web have no reader yet; the Connected data screen says so instead of pretending.
 */

export const healthSupported = false;
export const healthSourceKey = 'health_connect' as const;

export async function healthAvailable(): Promise<'available' | 'needs_install' | 'unsupported'> {
  return 'unsupported';
}

export async function connectHealth(): Promise<boolean> {
  return false;
}

export async function healthConnected(): Promise<boolean> {
  return false;
}

export async function readHealthDays(_days = 14): Promise<HealthDayPayload[]> {
  void _days;
  return [];
}

export function openHealthSettings(): void {}
