import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Google from 'expo-auth-session/providers/google';
import * as SecureStore from 'expo-secure-store';
import { Mail } from 'lucide-react-native';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import { color } from '@/theme/tokens';
import { Button } from '@/ui/primitives';

/**
 * Read-only Gmail access through Google sign-in. The access token stays on this device for its
 * one-hour life and is sent to the VitaSense server only for a sync, which searches mail from
 * order, pharmacy, lab and travel senders and never stores the token.
 *
 * Needs OAuth client IDs from Google Cloud (see README): EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
 * EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID, EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID.
 */

export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

const CLIENT_IDS = {
  webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID,
  androidClientId: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID,
  iosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
};

export const gmailConfigured = !!(Platform.OS === 'web'
  ? CLIENT_IDS.webClientId
  : Platform.OS === 'android'
    ? CLIENT_IDS.androidClientId
    : CLIENT_IDS.iosClientId);

const tokenKey = (userId: number) => `vitasense.gmail.${userId}`;

/** Phones keep the token in the Android Keystore / iOS Keychain, never in plain app storage. */
const tokenStore =
  Platform.OS === 'web'
    ? {
        get: (key: string) => AsyncStorage.getItem(key),
        set: (key: string, value: string) => AsyncStorage.setItem(key, value),
        remove: (key: string) => AsyncStorage.removeItem(key),
      }
    : {
        get: (key: string) => SecureStore.getItemAsync(key),
        set: (key: string, value: string) =>
          SecureStore.setItemAsync(key, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY }),
        remove: (key: string) => SecureStore.deleteItemAsync(key),
      };

export async function saveGmailToken(userId: number, token: string, expiresInSeconds: number | undefined) {
  const expiresAt = Date.now() + Math.max(60, (expiresInSeconds ?? 3600) - 120) * 1000;
  await tokenStore.set(tokenKey(userId), JSON.stringify({ token, expiresAt }));
}

/** A still-valid token, or null when the user has to tap Sync to sign in again. */
export async function validGmailToken(userId: number): Promise<string | null> {
  try {
    const raw = await tokenStore.get(tokenKey(userId));
    if (!raw) return null;
    const { token, expiresAt } = JSON.parse(raw) as { token: string; expiresAt: number };
    return Date.now() < expiresAt ? token : null;
  } catch {
    return null;
  }
}

export async function forgetGmailToken(userId: number) {
  await tokenStore.remove(tokenKey(userId)).catch(() => undefined);
}

/** Only render when `gmailConfigured`: the Google hook throws without a client ID for this platform. */
export function GmailSignInButton({
  userId,
  label,
  onToken,
  disabled,
}: {
  userId: number;
  label: string;
  onToken: (token: string) => void;
  disabled?: boolean;
}) {
  const [request, response, promptAsync] = Google.useAuthRequest({
    ...CLIENT_IDS,
    scopes: ['openid', 'email', GMAIL_SCOPE],
    selectAccount: true,
  });

  useEffect(() => {
    if (response?.type !== 'success') return;
    const token = response.authentication?.accessToken ?? response.params?.access_token;
    if (!token) return;
    void saveGmailToken(userId, token, response.authentication?.expiresIn).then(() => onToken(token));
  }, [response, userId, onToken]);

  return (
    <Button
      label={label}
      compact
      icon={<Mail size={14} color="#FFFFFF" />}
      disabled={disabled || !request}
      onPress={() => void promptAsync()}
      style={{ backgroundColor: color.navy }}
    />
  );
}
