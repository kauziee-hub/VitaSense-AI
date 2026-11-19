import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { Bell, RefreshCw } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text as RNText, useWindowDimensions, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BodyMap } from '@/body/BodyMap';
import { SYSTEM_LOOK } from '@/body/art';
import {
  CarePlanCard,
  ComparisonCard,
  InsightsCard,
  MarkersCard,
  NarrativeCard,
  ReadinessRing,
  useAskNavigator,
  ZoomControls,
} from '@/dashboard/parts';
import { SystemCarousel, SystemHero, SystemList, systemScores } from '@/dashboard/organs';
import { useSession } from '@/lib/session';
import { buildSystemView, mostConcerning, type SystemKey } from '@/lib/systems';
import { breakpoint, color, font, radius } from '@/theme/tokens';
import { Badge, Button, Card, IconButton, Text } from '@/ui/primitives';

function greeting(date = new Date()) {
  const h = date.getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function readinessWord(score: number | null | undefined) {
  if (score == null) return 'Reading your signals';
  if (score >= 75) return 'Ready for a full day';
  if (score >= 55) return 'Steady, pace yourself';
  return 'Take it easy today';
}

export default function DashboardScreen() {
  const { width, height } = useWindowDimensions();
  const wide = width >= breakpoint.wide;
  const { user, forecast, forecastError, refreshForecast } = useSession();
  const [selected, setSelected] = useState<SystemKey | null>(null);
  const [zoom, setZoom] = useState(1);
  const [stageHeight, setStageHeight] = useState(0);
  const ask = useAskNavigator();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  // Until the user picks one, show the system that needs the most attention.
  const key = selected ?? (forecast ? mostConcerning(forecast) : 'heart');
  const view = useMemo(() => buildSystemView(forecast, key), [forecast, key]);
  const scores = useMemo(() => systemScores(forecast), [forecast]);
  const firstName = user?.name.split(' ')[0] ?? '';
  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
  const select = (next: SystemKey) => {
    setSelected(next);
    setZoom(1);
  };

  if (wide) {
    const bodyHeight = stageHeight ? Math.max(380, Math.min(stageHeight - 150, 760)) : 0;
    return (
      <View style={styles.wideRoot}>
        <ScrollView style={styles.leftCol} contentContainerStyle={{ padding: 20, paddingRight: 8, gap: 14 }}>
          <View style={{ gap: 2, paddingHorizontal: 4 }}>
            <Text variant="heading" style={{ fontSize: 17 }}>
              Your body
            </Text>
            <Text variant="small">Tap a system or an organ on the body.</Text>
          </View>
          <SystemList forecast={forecast} selected={key} onSelect={select} />
          <InsightsCard forecast={forecast} onAsk={ask} />
        </ScrollView>

        <View style={styles.stage} onLayout={(e) => setStageHeight(e.nativeEvent.layout.height)}>
          <StageBackdrop tint={SYSTEM_LOOK[key].fill} />
          <View style={styles.stageTop}>
            <Animated.View entering={FadeInDown.duration(500)} style={{ flex: 1, gap: 4 }}>
              <Text variant="small">{today}</Text>
              <Text variant="hero">
                {greeting()},{'\n'}
                {firstName}
              </Text>
            </Animated.View>
            <Card style={styles.readinessCard}>
              <ReadinessRing score={forecast?.readiness_score ?? null} size={74} />
              <View style={{ gap: 2, maxWidth: 130 }}>
                <Text variant="label">TODAY</Text>
                <Text variant="bodyStrong" style={{ fontSize: 13, lineHeight: 17 }}>
                  {readinessWord(forecast?.readiness_score)}
                </Text>
              </View>
            </Card>
          </View>
          <View style={styles.bodyWrap} pointerEvents="box-none">
            {bodyHeight > 0 && (
              <BodyMap height={bodyHeight} selected={key} onSelect={select} scores={scores} zoom={zoom} callout={zoom === 1} />
            )}
          </View>
          <View style={styles.stageBottomRight}>
            <ZoomControls zoom={zoom} setZoom={setZoom} />
          </View>
        </View>

        <ScrollView style={styles.panel} contentContainerStyle={styles.panelContent}>
          {renderPanel(true)}
        </ScrollView>
      </View>
    );
  }

  return renderMobile();

  // Plain render helpers (not components) so state below them survives re-renders.
  function renderPanel(isWide: boolean) {
    if (!forecast) return <LoadingOrError error={forecastError} onRetry={() => void refreshForecast()} />;
    return (
      <>
        <SystemHero view={view} compact={!isWide} />
        <View style={styles.row}>
          <ComparisonCard forecast={forecast} view={view} />
          <NarrativeCard view={view} onAsk={ask} />
        </View>
        <MarkersCard forecast={forecast} view={view} columns={isWide ? 2 : 1} />
        <CarePlanCard view={view} columns={1} />
      </>
    );
  }

  function renderMobile() {
    const bodyHeight = Math.min(470, Math.max(360, height * 0.5));
    const initials = firstName.slice(0, 2).toUpperCase();
    return (
      <ScrollView style={{ backgroundColor: color.canvas }} contentContainerStyle={{ paddingTop: insets.top + 10, paddingBottom: 130, gap: 16 }}>
        <View style={styles.mobileHeader}>
          <Pressable accessibilityLabel="Profile" onPress={() => router.navigate('/profile')} style={styles.mobileAvatar}>
            <RNText style={{ fontFamily: font.bold, fontSize: 15, color: color.ink }}>{initials}</RNText>
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text variant="small">{greeting()}</Text>
            <Text variant="title" numberOfLines={1}>
              {firstName}
            </Text>
          </View>
          <IconButton label="Refresh" onPress={() => void refreshForecast()}>
            <RefreshCw size={17} color={color.ink} />
          </IconButton>
          <IconButton label="Medicines and reminders" onPress={() => router.navigate('/records')}>
            <Bell size={17} color={color.ink} />
          </IconButton>
        </View>

        <Animated.View entering={FadeInDown.duration(450)} style={{ paddingHorizontal: 16 }}>
          <View style={styles.readyDark}>
            <ReadinessRing score={forecast?.readiness_score ?? null} size={70} dark />
            <View style={{ flex: 1, gap: 4 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text variant="label" style={{ color: 'rgba(255,255,255,0.6)' }}>
                  NEXT 48 HOURS
                </Text>
                {forecast?.data_mode === 'demo' && <Badge label="Demo data" tone="watch" />}
              </View>
              <RNText style={styles.readyHeadline} numberOfLines={4}>
                {forecast?.headline ?? readinessWord(null)}
              </RNText>
            </View>
          </View>
        </Animated.View>

        <View style={styles.mobileStage}>
          <StageBackdrop tint={SYSTEM_LOOK[key].fill} />
          <View style={{ alignItems: 'center', paddingVertical: 18 }}>
            <BodyMap height={bodyHeight} selected={key} onSelect={select} scores={scores} zoom={zoom} callout={zoom === 1} />
          </View>
          <View style={{ position: 'absolute', right: 12, bottom: 12 }}>
            <ZoomControls zoom={zoom} setZoom={setZoom} />
          </View>
          <View style={{ position: 'absolute', left: 16, top: 14 }}>
            <Text variant="label">YOUR BODY TODAY</Text>
          </View>
        </View>

        <SystemCarousel forecast={forecast} selected={key} onSelect={select} />

        <View style={{ paddingHorizontal: 16, gap: 14 }}>{renderPanel(false)}</View>
      </ScrollView>
    );
  }
}

/** Soft spotlight behind the body, tinted with the selected system's pastel. */
function StageBackdrop({ tint }: { tint: string }) {
  return (
    <View style={[StyleSheet.absoluteFill, { borderRadius: radius.xl, overflow: 'hidden' }]} pointerEvents="none">
      <LinearGradient colors={['#FBFBF9', '#F1F1ED']} style={StyleSheet.absoluteFill} />
      <Animated.View key={tint} entering={FadeIn.duration(600)} style={[styles.stageHalo, { backgroundColor: tint }]} />
      <View style={styles.stageHaloWhite} />
    </View>
  );
}

function LoadingOrError({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  if (error) {
    return (
      <Card style={{ gap: 10 }}>
        <Text variant="heading">Couldn’t load your forecast</Text>
        <Text variant="body">{error}. Check that the VitaSense server is running, then try again.</Text>
        <Button label="Try again" onPress={onRetry} style={{ alignSelf: 'flex-start' }} />
      </Card>
    );
  }
  return (
    <Card style={{ alignItems: 'center', paddingVertical: 40, gap: 12 }}>
      <ActivityIndicator color={color.ink} />
      <Text variant="body">Reading your last 30 days of signals…</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  wideRoot: { flex: 1, flexDirection: 'row' },
  leftCol: { width: 290, flexGrow: 0 },
  stage: { flex: 1.15, marginVertical: 16, marginHorizontal: 8, borderRadius: radius.xl, overflow: 'hidden', minWidth: 380 },
  stageHalo: {
    position: 'absolute',
    width: 560,
    height: 560,
    borderRadius: 280,
    alignSelf: 'center',
    top: '16%',
    opacity: 0.55,
    filter: 'blur(80px)',
  },
  stageHaloWhite: {
    position: 'absolute',
    width: 300,
    height: 300,
    borderRadius: 150,
    alignSelf: 'center',
    top: '30%',
    backgroundColor: '#FFFFFF',
    opacity: 0.7,
    filter: 'blur(60px)',
  },
  stageTop: { flexDirection: 'row', alignItems: 'flex-start', padding: 24, gap: 16, zIndex: 2 },
  readinessCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, paddingRight: 16, borderRadius: 26 },
  bodyWrap: { position: 'absolute', left: 0, right: 0, bottom: 22, alignItems: 'center' },
  stageBottomRight: { position: 'absolute', right: 18, bottom: 18, zIndex: 3 },
  panel: { flex: 1 },
  panelContent: { padding: 16, paddingLeft: 8, gap: 14 },
  row: { flexDirection: 'row', gap: 14, flexWrap: 'wrap' },
  mobileHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16 },
  mobileAvatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#F7C7B2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  readyDark: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    padding: 16,
    borderRadius: radius.xl,
    backgroundColor: color.ink,
  },
  readyHeadline: { fontFamily: font.medium, fontSize: 15, lineHeight: 21, color: '#FFFFFF' },
  mobileStage: { marginHorizontal: 16, borderRadius: radius.xl, overflow: 'hidden', minHeight: 380 },
});
