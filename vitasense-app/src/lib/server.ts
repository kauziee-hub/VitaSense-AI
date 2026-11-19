import Constants from 'expo-constants';
import { Platform } from 'react-native';

/**
 * Where the VitaSense server lives.
 *
 * - `EXPO_PUBLIC_API_URL` (vitasense-app/.env or the EAS build profile) always wins. Release builds
 *   must set it to the hosted HTTPS server.
 * - Website: the server on this computer (127.0.0.1:8888).
 * - Phone or emulator during development: the app tries, in parallel, the computer that serves the
 *   JavaScript bundle (works when the server listens on the network), the emulator's alias for the
 *   computer (10.0.2.2) and 127.0.0.1 (a USB phone after `npm run phone:usb`), and keeps the first
 *   one that answers.
 */

const PORT = 8888;
const PROBE_MS = 3000;

const configured = process.env.EXPO_PUBLIC_API_URL?.trim().replace(/\/+$/, '') || null;

/** Host name of the computer running Metro, e.g. "192.168.1.20" from hostUri "192.168.1.20:8081". */
function bundlerHost(): string | null {
  const hostUri = Constants.expoConfig?.hostUri;
  if (!hostUri) return null;
  const withoutPath = hostUri.split('/')[0];
  const colon = withoutPath.lastIndexOf(':');
  const host = (colon > 0 ? withoutPath.slice(0, colon) : withoutPath).replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host === '127.0.0.1' || host === '::1') return null;
  return host.includes(':') ? `[${host}]` : host;
}

export function serverCandidates(): string[] {
  if (configured) return [configured];
  if (Platform.OS === 'web') return [`http://127.0.0.1:${PORT}`];

  const list: string[] = [];
  const host = bundlerHost();
  if (host) list.push(`http://${host}:${PORT}`);
  if (Platform.OS === 'android') list.push(`http://10.0.2.2:${PORT}`);
  list.push(`http://127.0.0.1:${PORT}`);
  return [...new Set(list)];
}

async function answers(base: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_MS);
  try {
    const response = await fetch(`${base}/health`, { signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Resolves with the first candidate whose /health answers, or null when none do. */
function firstAnswering(candidates: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    let left = candidates.length;
    for (const candidate of candidates) {
      void answers(candidate).then((ok) => {
        if (ok) resolve(candidate);
        else if (--left === 0) resolve(null);
      });
    }
  });
}

let found: string | null = null;
let searching: Promise<string> | null = null;

/** Base URL of the server, e.g. "http://10.0.2.2:8888". */
export async function serverUrl(): Promise<string> {
  if (found) return found;
  const candidates = serverCandidates();
  if (candidates.length === 1) {
    found = candidates[0];
    return found;
  }
  searching ??= firstAnswering(candidates).then((winner) => {
    searching = null;
    if (winner) found = winner;
    // Nothing answered: use the first guess for this request and search again next time.
    return winner ?? candidates[0];
  });
  return searching;
}

/** Call after a network failure so the next request looks for the server again (Wi-Fi changed, server moved). */
export function forgetServer(): void {
  if (serverCandidates().length > 1) found = null;
}
