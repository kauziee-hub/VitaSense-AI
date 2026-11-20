import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from '@expo-google-fonts/inter';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import * as WebBrowser from 'expo-web-browser';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';

// Defines the background sync task at startup, before the OS can call it.
import '@/collect/background';
import { SessionProvider } from '@/lib/session';
import { color } from '@/theme/tokens';

SplashScreen.preventAutoHideAsync();
// Closes the Google sign-in popup on web and hands its result back to the app.
WebBrowser.maybeCompleteAuthSession();

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) SplashScreen.hideAsync();
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SessionProvider>
      <StatusBar style="dark" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: color.canvas } }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="welcome" />
      </Stack>
    </SessionProvider>
  );
}
