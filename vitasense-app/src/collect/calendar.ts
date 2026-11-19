import * as Calendar from 'expo-calendar';
import { Platform } from 'react-native';

import type { CalendarDayPayload } from '@/lib/api';

/**
 * Calendar load per day, computed on the phone. Only counts and flags leave the device;
 * event titles are read here to spot travel and exams and then dropped.
 */

export const calendarSupported = Platform.OS === 'ios' || Platform.OS === 'android';

const TRAVEL = /\b(flight|train|bus to|trip|travel|airport|check[- ]?in|boarding|pnr|irctc|indigo|vistara|air india)\b|✈/i;
const EXAM = /\b(exam|test|viva|quiz|mid[- ]?term|finals?|assessment|interview)\b/i;

export async function calendarPermission(ask: boolean): Promise<boolean> {
  if (!calendarSupported) return false;
  const current = await Calendar.getCalendarPermissions();
  if (current.granted || !ask) return current.granted;
  return (await Calendar.requestCalendarPermissions()).granted;
}

function dayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Busy minutes per day from overlapping intervals, so a double-booked hour counts once. */
function mergedMinutes(intervals: [number, number][]): number {
  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  let total = 0;
  let current: [number, number] | null = null;
  for (const [start, end] of sorted) {
    if (!current || start > current[1]) {
      if (current) total += current[1] - current[0];
      current = [start, end];
    } else {
      current[1] = Math.max(current[1], end);
    }
  }
  if (current) total += current[1] - current[0];
  return Math.round(total / 60000);
}

export async function readCalendarDays(days = 14): Promise<CalendarDayPayload[]> {
  if (!(await calendarPermission(false))) return [];
  const end = new Date();
  const start = new Date(end);
  start.setDate(start.getDate() - (days - 1));
  start.setHours(0, 0, 0, 0);

  const calendars = await Calendar.getCalendars(Calendar.EntityTypes.EVENT);
  if (!calendars.length) return [];
  const events = await Calendar.listEvents(calendars, start, end);

  const byDay = new Map<string, { intervals: [number, number][]; count: number; late: number; early: number; travel: boolean; exam: boolean }>();
  for (const event of events) {
    const begins = new Date(event.startDate);
    const ends = new Date(event.endDate);
    const key = dayKey(begins);
    const bucket = byDay.get(key) ?? { intervals: [], count: 0, late: 0, early: 0, travel: false, exam: false };
    const title = `${event.title ?? ''} ${event.location ?? ''}`;
    bucket.count += 1;
    bucket.travel ||= TRAVEL.test(title);
    bucket.exam ||= EXAM.test(title);
    const allDay = (event as unknown as { allDay?: boolean }).allDay;
    if (!allDay) {
      bucket.intervals.push([begins.getTime(), Math.max(begins.getTime(), ends.getTime())]);
      if (begins.getHours() >= 22) bucket.late += 1;
      if (begins.getHours() < 7) bucket.early += 1;
    }
    byDay.set(key, bucket);
  }

  const out: CalendarDayPayload[] = [];
  for (let i = 0; i < days; i += 1) {
    const day = new Date(start);
    day.setDate(start.getDate() + i);
    const bucket = byDay.get(dayKey(day));
    out.push({
      date: dayKey(day),
      event_count: bucket?.count ?? 0,
      busy_minutes: bucket ? Math.min(24 * 60, mergedMinutes(bucket.intervals)) : 0,
      late_events: bucket?.late ?? 0,
      early_events: bucket?.early ?? 0,
      travel: bucket?.travel ?? false,
      exam: bucket?.exam ?? false,
    });
  }
  return out;
}
