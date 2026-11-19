import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import { Platform } from 'react-native';

import type { Medication } from './api';

/**
 * Medicine reminders as local notifications: one daily alarm per medicine time.
 * Phones only; the web app shows the schedule but cannot ring.
 */

const TAG = 'vitasense-med';

export const remindersSupported = Platform.OS !== 'web';

if (remindersSupported) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

export async function ensureReminderPermission(): Promise<boolean> {
  if (!remindersSupported) return false;
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  const asked = await Notifications.requestPermissionsAsync();
  return asked.granted;
}

const FOOD_NOTE: Record<string, string> = {
  before_food: 'before food',
  after_food: 'after food',
  with_food: 'with food',
  empty_stomach: 'on an empty stomach',
};

/** Replace all VitaSense medicine alarms with the current schedule. Returns how many were set. */
export async function syncMedicineReminders(medications: Medication[], today: string): Promise<number> {
  if (!remindersSupported) return 0;
  if (!(await ensureReminderPermission())) return 0;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('medicines', {
      name: 'Medicine reminders',
      importance: AndroidImportance.HIGH,
    });
  }

  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled
      .filter((n) => (n.content.data as { tag?: string } | undefined)?.tag === TAG)
      .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)),
  );

  // Group medicines that share a time into one alarm.
  const byTime = new Map<string, Medication[]>();
  for (const med of medications) {
    if (!med.active || med.as_needed) continue;
    if (med.end_date && med.end_date < today) continue;
    for (const time of med.times) byTime.set(time, [...(byTime.get(time) ?? []), med]);
  }

  let count = 0;
  for (const [time, meds] of byTime) {
    const [hour, minute] = time.split(':').map(Number);
    const names = meds.map((m) => [m.name, m.strength].filter(Boolean).join(' ')).join(', ');
    const notes = [...new Set(meds.map((m) => FOOD_NOTE[m.food_timing ?? ''] ?? '').filter(Boolean))];
    await Notifications.scheduleNotificationAsync({
      content: {
        title: meds.length === 1 ? `Time for ${meds[0].name}` : `Time for ${meds.length} medicines`,
        body: notes.length ? `${names} · ${notes.join(', ')}` : names,
        data: { tag: TAG, time },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DAILY,
        hour,
        minute,
        channelId: Platform.OS === 'android' ? 'medicines' : undefined,
      },
    });
    count += 1;
  }
  return count;
}
