import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { ArrowLeft, Bluetooth, BluetoothOff, HeartPulse, RefreshCw, Unplug, Watch } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text as RNText, useWindowDimensions, View } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Polyline } from 'react-native-svg';

import { ORGAN_ART } from '@/body/art';
import {
  band,
  bandDevice,
  bandPermissions,
  bluetoothState,
  flushHeartRate,
  phoneSupported,
  recordHeartRate,
  rememberBand,
} from '@/collect/phone';
import { setSourceEnabled, syncSources } from '@/collect/sync';
import { useSession } from '@/lib/session';
import { breakpoint, color, font, pastel, radius } from '@/theme/tokens';
import { Badge, Button, Card, IconButton, type PressState, Text } from '@/ui/primitives';

const BRAND_TIPS = [
  { brand: 'Xiaomi / Redmi band', how: 'Mi Fitness → your band → Heart rate sharing (or “Discoverable”) on' },
  { brand: 'Amazfit', how: 'Zepp app → Profile → your device → Heart rate sharing on' },
  { brand: 'Garmin, Coros, Polar, Wahoo', how: 'On the watch: Broadcast heart rate / HR broadcast' },
  { brand: 'Chest straps', how: 'Wear it: they broadcast as soon as they touch skin' },
  { brand: 'boAt, Noise, Fire-Boltt, Samsung, Fitbit', how: 'They don’t broadcast; connect them through Health Connect in Profile' },
];

type Phase = 'idle' | 'scanning' | 'connecting' | 'streaming' | 'disconnected' | 'no_heart_rate';

export default function BandScreen() {
  const { width } = useWindowDimensions();
  const wide = width >= breakpoint.wide;
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useSession();
  const [phase, setPhase] = useState<Phase>('idle');
  const [devices, setDevices] = useState<{ id: string; name: string; rssi: number }[]>([]);
  const [paired, setPaired] = useState<{ id: string; name: string } | null>(null);
  const [bpm, setBpm] = useState<number | null>(null);
  const [battery, setBattery] = useState<number | null>(null);
  const [trace, setTrace] = useState<number[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const deviceName = useRef<string>('');

  useEffect(() => {
    void bandDevice().then(setPaired);
    const subs = [
      band.onDevice((d) => setDevices((list) => (list.some((x) => x.id === d.id) ? list : [...list, d].sort((a, b) => b.rssi - a.rssi)))),
      band.onHeartRate((r) => {
        setBpm(r.bpm);
        setTrace((t) => [...t.slice(-59), r.bpm]);
        void recordHeartRate(r.bpm, r.at, r.contact);
      }),
      band.onState((s) => {
        if (s.state === 'battery' && s.battery != null) setBattery(s.battery);
        if (s.state === 'scanning') setPhase('scanning');
        if (s.state === 'scan_done') setPhase((p) => (p === 'scanning' ? 'idle' : p));
        if (s.state === 'connecting') setPhase('connecting');
        if (s.state === 'streaming') setPhase('streaming');
        if (s.state === 'no_heart_rate') setPhase('no_heart_rate');
        if (s.state === 'disconnected') setPhase('disconnected');
        if (s.state === 'scan_failed') setProblem('Bluetooth scan failed. Turn Bluetooth off and on, then try again.');
      }),
    ];
    return () => {
      subs.forEach((sub) => sub?.remove());
      band.stopScan();
      void flushHeartRate();
    };
  }, []);

  const scan = async () => {
    setProblem(null);
    if (!(await bandPermissions())) {
      setProblem('VitaSense needs “Nearby devices” permission to find your band.');
      return;
    }
    if (bluetoothState() !== 'on') {
      setProblem('Bluetooth is off.');
      return;
    }
    setDevices([]);
    band.scan(15);
  };

  const connect = async (device: { id: string; name: string }) => {
    if (!user) return;
    deviceName.current = device.name;
    await rememberBand(device);
    setPaired(device);
    await setSourceEnabled(user.id, 'band', true);
    band.connect(device.id);
  };

  const disconnect = async () => {
    band.disconnect();
    setPhase('disconnected');
    if (user) await syncSources(user.id, { force: true, only: 'band' }).catch(() => undefined);
  };

  const forget = async () => {
    band.disconnect();
    await rememberBand(null);
    setPaired(null);
    setBpm(null);
    setPhase('idle');
    if (user) await setSourceEnabled(user.id, 'band', false);
  };

  const live = phase === 'streaming';

  return (
    <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: wide ? 24 : insets.top + 12, paddingBottom: wide ? 32 : 130 }}>
      <View style={{ width: '100%', maxWidth: 820, alignSelf: 'center', gap: 16 }}>
        <View style={styles.header}>
          <IconButton label="Back" onPress={() => (router.canGoBack() ? router.back() : router.navigate('/profile'))}>
            <ArrowLeft size={18} color={color.ink} />
          </IconButton>
          <View style={{ flex: 1 }}>
            <Text variant="title">Fitness band</Text>
            <Text variant="small">Live heart rate over Bluetooth</Text>
          </View>
          {live && <Badge label="Live" tone="good" dot />}
        </View>

        <View style={[styles.hero, { backgroundColor: pastel.sky }]}>
          <View style={{ flex: 1, gap: 6, zIndex: 2 }}>
            <Text variant="label">{paired ? paired.name.toUpperCase() : 'NO BAND PAIRED'}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <BeatingHeart beating={live} />
              <RNText style={styles.bpm}>{bpm ?? '--'}</RNText>
              <RNText style={styles.bpmUnit}>bpm</RNText>
            </View>
            <Text variant="small" style={{ color: color.inkSoft }}>
              {phase === 'streaming'
                ? `Streaming${battery != null ? ` · battery ${battery}%` : ''}`
                : phase === 'connecting'
                  ? 'Connecting…'
                  : phase === 'no_heart_rate'
                    ? 'Connected, but this device doesn’t share heart rate.'
                    : phase === 'disconnected'
                      ? 'Disconnected. Readings so far are saved.'
                      : 'Wear your band and turn on heart-rate broadcast.'}
            </Text>
            {trace.length > 3 && <Trace values={trace} />}
          </View>
          <Image source={ORGAN_ART.band} style={styles.heroArt} contentFit="contain" />
        </View>

        {!phoneSupported ? (
          <Card style={{ gap: 6 }}>
            <Text variant="heading">Available in the Android app</Text>
            <Text variant="body">
              {Platform.OS === 'web'
                ? 'Browsers can’t keep a band connected. Install the VitaSense Android app to stream heart rate.'
                : 'This build doesn’t include the Bluetooth reader.'}
            </Text>
          </Card>
        ) : (
          <Card style={{ gap: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Text variant="heading" style={{ flex: 1 }}>
                {phase === 'scanning' ? 'Looking for bands…' : 'Nearby heart-rate devices'}
              </Text>
              {paired && live ? (
                <Button label="Disconnect" kind="secondary" compact icon={<Unplug size={14} color={color.ink} />} onPress={() => void disconnect()} />
              ) : (
                <Button
                  label={phase === 'scanning' ? 'Scanning…' : 'Scan'}
                  compact
                  disabled={phase === 'scanning'}
                  icon={<RefreshCw size={14} color="#FFFFFF" />}
                  onPress={() => void scan()}
                />
              )}
            </View>
            {problem && (
              <View style={styles.problem}>
                <BluetoothOff size={16} color={color.risk} />
                <Text variant="small" style={{ flex: 1, color: color.ink }}>
                  {problem}
                </Text>
                {problem.includes('Bluetooth is off') && <Button label="Turn on" kind="soft" compact onPress={band.openBluetoothSettings} />}
              </View>
            )}
            {devices.length === 0 && phase !== 'scanning' && (
              <Text variant="small">Tap Scan with your band nearby. Only devices that broadcast heart rate appear.</Text>
            )}
            {devices.map((d) => (
              <Pressable
                key={d.id}
                onPress={() => void connect(d)}
                style={({ hovered }: PressState) => [styles.device, hovered && { backgroundColor: color.surfaceSoft }]}>
                <View style={styles.deviceIcon}>
                  <Watch size={18} color={color.ink} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text variant="bodyStrong">{d.name}</Text>
                  <Text variant="small">Signal {d.rssi > -60 ? 'strong' : d.rssi > -80 ? 'good' : 'weak'}</Text>
                </View>
                <Bluetooth size={16} color={color.inkMuted} />
              </Pressable>
            ))}
            {paired && (
              <Pressable onPress={() => void forget()}>
                <Text variant="small" style={{ color: color.risk }}>
                  Forget {paired.name} and stop recording
                </Text>
              </Pressable>
            )}
          </Card>
        )}

        <Card style={{ gap: 10 }}>
          <Text variant="heading">Turn on heart-rate broadcast</Text>
          {BRAND_TIPS.map((tip) => (
            <View key={tip.brand} style={styles.tip}>
              <HeartPulse size={15} color={color.risk} />
              <View style={{ flex: 1 }}>
                <Text variant="bodyStrong" style={{ fontSize: 13 }}>
                  {tip.brand}
                </Text>
                <Text variant="small">{tip.how}</Text>
              </View>
            </View>
          ))}
          <Text variant="small">
            VitaSense keeps a daily average and a resting estimate from these readings. Steps, sleep and SpO₂ come from Health Connect.
          </Text>
        </Card>
      </View>
    </ScrollView>
  );
}

function BeatingHeart({ beating }: { beating: boolean }) {
  const scale = useSharedValue(1);
  useEffect(() => {
    scale.value = beating
      ? withRepeat(withSequence(withTiming(1.22, { duration: 160, easing: Easing.out(Easing.quad) }), withTiming(1, { duration: 520 })), -1)
      : withTiming(1);
  }, [beating, scale]);
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  return (
    <Animated.View style={[styles.heartDot, style]}>
      <HeartPulse size={20} color="#FFFFFF" />
    </Animated.View>
  );
}

function Trace({ values }: { values: number[] }) {
  const w = 220;
  const h = 44;
  const lo = Math.min(...values) - 3;
  const hi = Math.max(...values) + 3;
  const points = values.map((v, i) => `${(i / Math.max(1, values.length - 1)) * w},${h - ((v - lo) / (hi - lo || 1)) * h}`).join(' ');
  return (
    <Svg width={w} height={h} style={{ marginTop: 4 }}>
      <Polyline points={points} fill="none" stroke={color.ink} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
    </Svg>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  hero: { flexDirection: 'row', borderRadius: radius.xl, padding: 20, minHeight: 190, overflow: 'hidden' },
  heroArt: { position: 'absolute', right: -10, bottom: -10, width: 170, height: 200, opacity: 0.95 },
  bpm: { fontFamily: font.bold, fontSize: 56, lineHeight: 62, letterSpacing: -2, color: color.ink },
  bpmUnit: { fontFamily: font.medium, fontSize: 15, color: color.inkSoft, marginTop: 18 },
  heartDot: { width: 38, height: 38, borderRadius: 19, backgroundColor: color.risk, alignItems: 'center', justifyContent: 'center' },
  problem: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: radius.md, backgroundColor: color.riskSoft },
  device: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: radius.md, borderWidth: 1, borderColor: color.line },
  deviceIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: pastel.mint, alignItems: 'center', justifyContent: 'center' },
  tip: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
});
