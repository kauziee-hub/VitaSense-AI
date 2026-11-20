import AsyncStorage from '@react-native-async-storage/async-storage';
import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';

import { syncSources } from './sync';

/**
 * Keeps collecting while the app is closed: Android WorkManager (iOS BGTaskScheduler) wakes this
 * task roughly every 30 minutes when battery and network allow, and it runs the same sync as
 * opening the app (each source still respects its own interval and on/off switch).
 * Must be imported at startup so the task is defined before the OS calls it.
 */

export const SYNC_TASK = 'vitasense-background-sync';
const ACTIVE_USER_KEY = 'vitasense.activeUser';
const supported = Platform.OS === 'android' || Platform.OS === 'ios';

if (supported && !TaskManager.isTaskDefined(SYNC_TASK)) {
  TaskManager.defineTask(SYNC_TASK, async () => {
    try {
      const raw = await AsyncStorage.getItem(ACTIVE_USER_KEY);
      const user = raw ? (JSON.parse(raw) as { id?: number }) : null;
      if (typeof user?.id === 'number') await syncSources(user.id);
      return BackgroundTask.BackgroundTaskResult.Success;
    } catch {
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
}

/** Register (or keep) the periodic sync. Safe to call on every launch. */
export async function startBackgroundSync(): Promise<boolean> {
  if (!supported) return false;
  try {
    if ((await BackgroundTask.getStatusAsync()) !== BackgroundTask.BackgroundTaskStatus.Available) return false;
    if (!(await TaskManager.isTaskRegisteredAsync(SYNC_TASK))) {
      await BackgroundTask.registerTaskAsync(SYNC_TASK, { minimumInterval: 30 });
    }
    return true;
  } catch {
    return false;
  }
}

export async function stopBackgroundSync(): Promise<void> {
  if (!supported) return;
  try {
    if (await TaskManager.isTaskRegisteredAsync(SYNC_TASK)) await BackgroundTask.unregisterTaskAsync(SYNC_TASK);
  } catch {
    // nothing registered
  }
}
