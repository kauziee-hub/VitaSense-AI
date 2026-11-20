import { LinearGradient } from 'expo-linear-gradient';
import { Redirect, useRouter } from 'expo-router';
import { TabList, TabSlot, TabTrigger, type TabTriggerSlotProps, Tabs } from 'expo-router/ui';
import type { LucideIcon } from 'lucide-react-native';
import { Bell, ClipboardCheck, FileText, LayoutDashboard, MessageCircle, RefreshCw, UserRound } from 'lucide-react-native';
import type { ComponentRef, Ref } from 'react';
import { Pressable, StyleSheet, Text as RNText, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAutoSync } from '@/collect/useAutoSync';
import { useSession } from '@/lib/session';
import { Logo } from '@/shell/Logo';
import { breakpoint, color, font, radius, shadow } from '@/theme/tokens';
import { Badge, Glass, IconButton, type PressState } from '@/ui/primitives';

const NAV: { name: string; href: string; label: string; short: string; icon: LucideIcon; desktop: boolean }[] = [
  { name: 'index', href: '/', label: 'Dashboard', short: 'Home', icon: LayoutDashboard, desktop: true },
  { name: 'ask', href: '/ask', label: 'Ask VitaSense', short: 'Ask', icon: MessageCircle, desktop: true },
  { name: 'checkin', href: '/checkin', label: 'Check-in', short: 'Check-in', icon: ClipboardCheck, desktop: true },
  { name: 'records', href: '/records', label: 'Records', short: 'Records', icon: FileText, desktop: true },
  { name: 'profile', href: '/profile', label: 'Profile', short: 'Profile', icon: UserRound, desktop: false },
];

/** Screens without a bar button: opened from chat answers, records and each other. */
const HIDDEN_ROUTES = [
  { name: 'report', href: '/report', label: 'Doctor report' },
  { name: 'doctors', href: '/doctors', label: 'Doctors nearby' },
  { name: 'factors', href: '/factors', label: 'Health factors' },
  { name: 'band', href: '/band', label: 'Fitness band' },
];

export default function TabsLayout() {
  const { ready, user } = useSession();
  const { width } = useWindowDimensions();
  const wide = width >= breakpoint.wide;
  const framed = width >= breakpoint.framed;
  useAutoSync();

  if (!ready) return null;
  if (!user) return <Redirect href="/welcome" />;

  return (
    <Tabs style={{ flex: 1 }}>
      {wide ? (
        <View style={styles.backdrop}>
          <LinearGradient
            colors={['#EFEAE6', color.backdrop, '#E2DCD7']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          {/* Glows live in their own clipped layer so the frame never becomes scrollable. */}
          <View pointerEvents="none" style={[StyleSheet.absoluteFill, { overflow: 'hidden' }]}>
            <View style={styles.glowA} />
            <View style={styles.glowB} />
          </View>
          <View style={[styles.frame, framed ? styles.frameFloating : styles.frameFull]}>
            <DesktopTopBar />
            <View style={{ flex: 1 }}>
              <TabSlot style={{ flex: 1 }} />
            </View>
          </View>
        </View>
      ) : (
        <View style={{ flex: 1, backgroundColor: color.canvas }}>
          <TabSlot style={{ flex: 1 }} />
          <MobileTabBar />
        </View>
      )}

      {/* Route registry for the custom bars above, plus screens reached from inside the app. */}
      <TabList style={{ display: 'none' }}>
        {[...NAV, ...HIDDEN_ROUTES].map((item) => (
          <TabTrigger key={item.name} name={item.name} href={item.href as never}>
            <RNText>{item.label}</RNText>
          </TabTrigger>
        ))}
      </TabList>
    </Tabs>
  );
}

function DesktopTopBar() {
  const { user, forecast, refreshForecast, health } = useSession();
  const router = useRouter();
  const parts = (user?.name ?? '?').trim().split(/\s+/);
  const initials = (parts.length > 1 ? parts[0][0] + parts[1][0] : parts[0].slice(0, 2)).toUpperCase();
  const demo = forecast?.data_mode === 'demo';
  return (
    <View style={styles.topBar}>
      <Logo size={32} />
      <View style={styles.navGroup}>
        {NAV.filter((n) => n.desktop).map((item) => (
          <TabTrigger key={item.name} name={item.name} asChild>
            <DesktopNavButton icon={item.icon} label={item.label} />
          </TabTrigger>
        ))}
      </View>
      <View style={styles.topActions}>
        {demo && <Badge label="Demo data" tone="watch" dot />}
        {health && !health.ai && <Badge label="AI offline" tone="risk" dot />}
        <IconButton label="Refresh forecast" onPress={() => void refreshForecast()}>
          <RefreshCw size={17} color={color.inkSoft} />
        </IconButton>
        <IconButton label="Medicines and reminders" onPress={() => router.navigate('/records')}>
          <Bell size={17} color={color.inkSoft} />
        </IconButton>
        <TabTrigger name="profile" asChild>
          <AvatarButton initials={initials} />
        </TabTrigger>
      </View>
    </View>
  );
}

type PressableRef = Ref<ComponentRef<typeof Pressable>>;

function DesktopNavButton({
  icon: Icon,
  label,
  isFocused,
  ref,
  ...props
}: TabTriggerSlotProps & { icon: LucideIcon; label: string; ref?: PressableRef }) {
    return (
      <Pressable
        ref={ref}
        {...props}
        style={({ hovered }: PressState) => [
          styles.navButton,
          isFocused && styles.navButtonActive,
          hovered && !isFocused && { backgroundColor: color.surfaceSunken },
        ]}>
        <Icon size={15} color={isFocused ? '#FFFFFF' : color.inkSoft} />
        <RNText style={[styles.navLabel, isFocused && { color: '#FFFFFF' }]}>{label}</RNText>
      </Pressable>
    );
}

function AvatarButton({ initials, isFocused, ref, ...props }: TabTriggerSlotProps & { initials: string; ref?: PressableRef }) {
  return (
    <Pressable ref={ref} {...props} accessibilityLabel="Profile" style={[styles.avatar, isFocused && { borderColor: color.ink }]}>
      <RNText style={styles.avatarLabel}>{initials}</RNText>
    </Pressable>
  );
}

function MobileTabBar() {
  const insets = useSafeAreaInsets();
  return (
    <View pointerEvents="box-none" style={[styles.mobileBarWrap, { paddingBottom: Math.max(insets.bottom, 12) }]}>
      <Glass dark style={styles.mobileBar} intensity={60}>
        {NAV.map((item) => (
          <TabTrigger key={item.name} name={item.name} asChild>
            <MobileNavButton icon={item.icon} label={item.short} />
          </TabTrigger>
        ))}
      </Glass>
    </View>
  );
}

function MobileNavButton({
  icon: Icon,
  label,
  isFocused,
  ref,
  ...props
}: TabTriggerSlotProps & { icon: LucideIcon; label: string; ref?: PressableRef }) {
    return (
      <Pressable ref={ref} {...props} style={[styles.mobileItem, isFocused && { flexGrow: 1.9 }]} accessibilityLabel={label}>
        <View style={[styles.mobileIcon, isFocused && styles.mobileIconActive]}>
          <Icon size={19} color={isFocused ? color.ink : 'rgba(255,255,255,0.62)'} />
          {isFocused && (
            <RNText numberOfLines={1} style={styles.mobileLabel}>
              {label}
            </RNText>
          )}
        </View>
      </Pressable>
    );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, overflow: 'hidden' },
  glowA: {
    position: 'absolute',
    width: 720,
    height: 720,
    borderRadius: 360,
    left: -220,
    top: -300,
    backgroundColor: '#F6CDB9',
    opacity: 0.55,
    filter: 'blur(110px)',
  },
  glowB: {
    position: 'absolute',
    width: 640,
    height: 640,
    borderRadius: 320,
    right: -180,
    bottom: -260,
    backgroundColor: '#BFDDE8',
    opacity: 0.6,
    filter: 'blur(110px)',
  },
  frame: { flex: 1, backgroundColor: color.canvas, overflow: 'hidden' },
  frameFloating: { margin: 28, borderRadius: radius.frame, boxShadow: shadow.frame, maxWidth: 1560, width: '100%', alignSelf: 'center' },
  frameFull: {},
  topBar: {
    height: 78,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 28,
    gap: 16,
  },
  navGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    padding: 5,
    borderRadius: radius.pill,
    backgroundColor: color.surface,
    marginHorizontal: 'auto',
    boxShadow: shadow.card,
  },
  navButton: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 40, paddingHorizontal: 18, borderRadius: radius.pill },
  navButtonActive: { backgroundColor: color.ink },
  navLabel: { fontFamily: font.medium, fontSize: 13, color: color.inkSoft },
  topActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#F7C7B2',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  avatarLabel: { fontFamily: font.bold, fontSize: 13, color: color.navyDeep },
  mobileBarWrap: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 14 },
  mobileBar: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 6,
    borderRadius: 32,
    boxShadow: '0px 14px 34px rgba(17,17,17,0.28)',
    borderColor: 'rgba(255,255,255,0.08)',
  },
  mobileItem: { flex: 1, flexBasis: 0, alignItems: 'center' },
  mobileIcon: { height: 50, minWidth: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 7 },
  mobileIconActive: { backgroundColor: '#FFFFFF', paddingHorizontal: 16, alignSelf: 'stretch' },
  mobileLabel: { fontFamily: font.semibold, fontSize: 13, color: color.ink },
});
