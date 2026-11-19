import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import type { LucideIcon } from 'lucide-react-native';
import {
  ArrowRight,
  BellRing,
  CalendarDays,
  Camera,
  Check,
  ClipboardCheck,
  Download,
  FileText,
  HeartPulse,
  Lock,
  Mail,
  MapPin,
  Pill,
  ShieldCheck,
  Siren,
  Smartphone,
  Sparkles,
  Stethoscope,
  Wind,
} from 'lucide-react-native';
import { type ComponentRef, type ReactNode, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text as RNText,
  TextInput,
  useWindowDimensions,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  FadeInDown,
  FadeInUp,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SYSTEM_LOOK, type ArtKey } from '@/body/art';
import { BodyMap } from '@/body/BodyMap';
import { OrganArt } from '@/dashboard/organs';
import { api, DEMO_USERS, type AppUser } from '@/lib/api';
import { useSession } from '@/lib/session';
import { SYSTEMS, type SystemKey } from '@/lib/systems';
import { Logo } from '@/shell/Logo';
import { breakpoint, color, font, pastel, radius, shadow } from '@/theme/tokens';
import { Badge, Button, Card, Text, type PressState } from '@/ui/primitives';

/** Where the website's "Get the Android app" button points. Set EXPO_PUBLIC_ANDROID_APK_URL for another host. */
const APK_URL = process.env.EXPO_PUBLIC_ANDROID_APK_URL ?? '/downloads/VitaSense.apk';
const APP_SCREEN = require('../../assets/marketing/app-home.png');

const IS_WEB = Platform.OS === 'web';
const CYCLE: SystemKey[] = ['heart', 'gut', 'lungs', 'mind', 'hydration', 'immune'];

const SYSTEM_COPY: Record<SystemKey, { watches: string; example: string }> = {
  heart: { watches: 'HRV, resting pulse, activity', example: 'HRV 22% under your usual after 3 short nights' },
  lungs: { watches: 'air quality, pollen, breathing rate', example: 'AQI 152 near home: throat irritation more likely' },
  gut: { watches: 'food orders, meal timing, water', example: 'Late fried dinners twice this week: acidity risk' },
  mind: { watches: 'screen time, workload, sleep debt', example: 'Back-to-back meetings + 8 h screens: stress load high' },
  immune: { watches: 'sleep, outbreaks nearby, symptoms', example: 'Dengue cases rising in your area this week' },
  sleep: { watches: 'sleep length, timing, awakenings', example: '4.5 h last night, 1.7 h below your normal' },
  hydration: { watches: 'water, heat, activity', example: '34°C and 1.2 L water: drink before you feel thirsty' },
};

const STEPS: { art: ArtKey; title: string; detail: string }[] = [
  { art: 'heart', title: 'Connect once', detail: 'Switch on health data, location, calendar and order emails. One tap each, then you never type them again.' },
  { art: 'brain', title: 'It learns your normal', detail: 'Thirty days of sleep, food, stress, air and outbreaks become your personal baseline, so changes stand out.' },
  { art: 'gut', title: 'Ask when you feel off', detail: 'Describe it in your own words. Get the likely reasons from your data, what to do now, and which doctor to see.' },
];

const SOURCES: { icon: LucideIcon; title: string; detail: string }[] = [
  { icon: HeartPulse, title: 'Sleep, heart & activity', detail: 'From your watch or phone through Health Connect.' },
  { icon: Wind, title: 'Air, heat & mosquitoes', detail: 'Live air quality and weather where you are.' },
  { icon: Mail, title: 'Food & medicine orders', detail: 'Swiggy, Zepto, PharmEasy and more, from order emails.' },
  { icon: CalendarDays, title: 'Workload & travel', detail: 'How busy your days are. Titles never leave your phone.' },
  { icon: Camera, title: 'Reports & prescriptions', detail: 'Photograph them. Values and medicines are read for you.' },
  { icon: ClipboardCheck, title: 'A 10-second check-in', detail: 'Mood, energy and symptoms in three taps.' },
];

const SAFETY: { icon: LucideIcon; title: string; detail: string; fill: string }[] = [
  { icon: Pill, title: 'Never prescribes', detail: 'It explains and points you to the right doctor. Medicines are your doctor’s call.', fill: pastel.peach },
  { icon: Siren, title: 'Emergencies first', detail: 'Danger signs are checked before any answer, with 112 one tap away.', fill: pastel.butter },
  { icon: Lock, title: 'Opt-in, delete anytime', detail: 'Nothing is collected until you switch it on. Switching off deletes it.', fill: pastel.sky },
  { icon: ShieldCheck, title: 'Not a diagnosis', detail: 'Possible causes from your own data, ranked, with what would rule each out.', fill: pastel.mint },
];

function openApk() {
  void Linking.openURL(APK_URL);
}

export default function WelcomeScreen() {
  const { width } = useWindowDimensions();
  const wide = width >= breakpoint.wide;
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { signIn, user } = useSession();
  const [users, setUsers] = useState<AppUser[] | null>(null);
  const [offline, setOffline] = useState(false);
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const [sectionY, setSectionY] = useState<Record<string, number>>({});

  useEffect(() => {
    api
      .users()
      .then((list) => setUsers(list))
      .catch(() => {
        setOffline(true);
        setUsers(DEMO_USERS);
      });
  }, []);

  const choose = async (next: AppUser) => {
    await signIn(next);
    router.replace('/');
  };

  const create = async () => {
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      await choose(await api.createUser(name.trim()));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create the profile');
    } finally {
      setCreating(false);
    }
  };

  const goTo = (key: string) => scrollRef.current?.scrollTo({ y: Math.max(0, (sectionY[key] ?? 0) - 90), animated: true });
  const mark = (key: string) => (e: { nativeEvent: { layout: { y: number } } }) => {
    const y = e.nativeEvent.layout.y;
    setSectionY((prev) => (prev[key] === y ? prev : { ...prev, [key]: y }));
  };

  const picker = (
    <Card style={[styles.picker, !wide && { padding: 20 }]}>
      <Text variant="title">Who’s checking in?</Text>
      <Text variant="body" style={{ marginTop: 4, marginBottom: 16 }}>
        Pick your profile, or start your own in seconds.
      </Text>
      {offline && (
        <View style={styles.offline}>
          <Badge label="Server offline" tone="risk" dot />
          <Text variant="small" style={{ flex: 1 }}>
            Showing the built-in demo profiles.
          </Text>
        </View>
      )}
      {users === null ? (
        <ActivityIndicator color={color.ink} style={{ marginVertical: 24 }} />
      ) : (
        <View style={{ gap: 8 }}>
          {users.map((u, i) => (
            <Pressable
              key={u.id}
              onPress={() => void choose(u)}
              accessibilityRole="button"
              accessibilityLabel={`Open ${u.name}`}
              style={({ hovered, pressed }: PressState) => [
                styles.userRow,
                hovered && { backgroundColor: color.canvasDeep },
                pressed && { transform: [{ scale: 0.99 }] },
              ]}>
              <View style={[styles.userAvatar, { backgroundColor: [pastel.peach, pastel.sky, pastel.mint, pastel.butter, pastel.lilac][i % 5] }]}>
                <RNText style={{ fontFamily: font.bold, fontSize: 14, color: color.ink }}>{u.name.slice(0, 2).toUpperCase()}</RNText>
              </View>
              <View style={{ flex: 1 }}>
                <Text variant="heading">{u.name}</Text>
                <Text variant="small">{u.id <= 3 ? 'Demo profile with sample history' : 'Your profile'}</Text>
              </View>
              {user?.id === u.id ? <Check size={18} color={color.good} /> : <ArrowRight size={18} color={color.inkMuted} />}
            </Pressable>
          ))}
        </View>
      )}
      <View style={styles.divider}>
        <View style={styles.dividerLine} />
        <Text variant="small">or start fresh</Text>
        <View style={styles.dividerLine} />
      </View>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <TextInput
          value={name}
          onChangeText={setName}
          placeholder="Your first name"
          placeholderTextColor={color.inkFaint}
          editable={!offline}
          onSubmitEditing={() => void create()}
          style={[styles.input, offline && { opacity: 0.5 }]}
          accessibilityLabel="Your first name"
        />
        <Button label={creating ? 'Creating…' : 'Start'} disabled={offline || creating || !name.trim()} onPress={() => void create()} />
      </View>
      {error && (
        <Text variant="small" style={{ marginTop: 8, color: color.risk }}>
          {error}
        </Text>
      )}
      <Text variant="small" style={{ marginTop: 14, textAlign: 'center' }}>
        Not a diagnosis. In an emergency call 112.
      </Text>
    </Card>
  );

  /* ---------- Phone (and narrow browsers) ---------- */
  if (!wide) {
    return (
      <ScrollView style={{ backgroundColor: color.canvas }} contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}>
        <View style={[styles.mHero, { paddingTop: insets.top + 18 }]}>
          <View style={[styles.glow, { backgroundColor: pastel.peach, left: -120, top: -80 }]} pointerEvents="none" />
          <View style={[styles.glow, { backgroundColor: pastel.sky, right: -140, top: 220 }]} pointerEvents="none" />
          <Logo size={30} />
          <Animated.View entering={FadeInDown.duration(500)} style={{ gap: 10, marginTop: 26 }}>
            <Text style={styles.mTitle}>Your body,{'\n'}explained by your life.</Text>
            <Text style={styles.mSub}>Knows how you live, explains why you feel unwell, and tells you which doctor to see.</Text>
          </Animated.View>
          <HeroBody height={380} compact />
          {IS_WEB && (
            <Button
              label="Get the Android app"
              icon={<Download size={16} color="#FFFFFF" />}
              onPress={openApk}
              style={{ alignSelf: 'stretch', marginTop: 8 }}
            />
          )}
        </View>
        <View style={{ paddingHorizontal: 16, gap: 16 }}>
          {picker}
          <View style={styles.mGrid}>
            {SYSTEMS.map((s) => (
              <View key={s.key} style={[styles.mSystem, { backgroundColor: SYSTEM_LOOK[s.key].fill }]}>
                <OrganArt art={SYSTEM_LOOK[s.key].art} size={56} disc={false} />
                <Text variant="bodyStrong">{s.short === 'Water' ? 'Hydration' : s.short}</Text>
                <Text variant="small" style={{ color: color.inkSoft }} numberOfLines={2}>
                  {SYSTEM_COPY[s.key].watches.charAt(0).toUpperCase() + SYSTEM_COPY[s.key].watches.slice(1)}
                </Text>
              </View>
            ))}
          </View>
          {STEPS.map(({ art, title, detail }, index) => (
            <View key={title} style={styles.mStep}>
              <OrganArt art={art} size={52} fill={[pastel.peach, pastel.rose, pastel.butter][index]} />
              <View style={{ flex: 1, gap: 2 }}>
                <Text variant="bodyStrong">
                  {index + 1}. {title}
                </Text>
                <Text variant="small" style={{ color: color.inkSoft }}>
                  {detail}
                </Text>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
    );
  }

  /* ---------- Desktop website ---------- */
  return (
    <View style={{ flex: 1, backgroundColor: color.canvas }}>
      <ScrollView ref={scrollRef} stickyHeaderIndices={[0]}>
        {/* Sticky navigation */}
        <View style={styles.navWrap}>
          <View style={styles.navInner}>
            <Logo size={34} />
            <View style={styles.navLinks}>
              {[
                ['systems', 'Your body'],
                ['how', 'How it works'],
                ['doctor', 'For your doctor'],
                ['android', 'Android app'],
                ['safety', 'Privacy'],
              ].map(([key, label]) => (
                <Pressable
                  key={key}
                  onPress={() => goTo(key)}
                  style={({ hovered }: PressState) => [styles.navLink, hovered && { backgroundColor: color.surfaceSunken }]}>
                  <Text style={styles.navLinkText}>{label}</Text>
                </Pressable>
              ))}
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button label="Open web app" kind="secondary" compact onPress={() => goTo('start')} />
              <Button label="Get the app" compact icon={<Download size={14} color="#FFFFFF" />} onPress={openApk} />
            </View>
          </View>
        </View>

        {/* Hero */}
        <View style={styles.hero}>
          <View style={[styles.glow, { backgroundColor: pastel.peach, left: -160, top: -120, width: 620, height: 620 }]} pointerEvents="none" />
          <View style={[styles.glow, { backgroundColor: pastel.sky, right: -140, top: 160, width: 560, height: 560 }]} pointerEvents="none" />
          <View style={[styles.glow, { backgroundColor: pastel.mint, left: '38%', bottom: -260, width: 520, height: 520 }]} pointerEvents="none" />
          <LinearGradient
            colors={['rgba(242,242,239,0)', color.canvas]}
            style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 160 }}
            pointerEvents="none"
          />
          <View style={styles.heroInner}>
            <Animated.View entering={FadeInDown.duration(600)} style={styles.heroCopy}>
              <View style={styles.eyebrow}>
                <Sparkles size={13} color={color.ink} />
                <Text style={styles.eyebrowText}>Personal health intelligence</Text>
              </View>
              <Text style={styles.heroTitle}>Your body,{'\n'}explained by{'\n'}your life.</Text>
              <Text style={styles.heroSub}>
                VitaSense connects how you live (sleep, food, stress, air, what’s going around) to how you feel. When you’re unwell,
                you know the likely reason and exactly which doctor to see.
              </Text>
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
                <Button label="Open the web app" icon={<ArrowRight size={16} color="#FFFFFF" />} onPress={() => goTo('start')} />
                <Button label="Get the Android app" kind="secondary" icon={<Smartphone size={16} color={color.ink} />} onPress={openApk} />
              </View>
              <View style={styles.trustRow}>
                {['Never prescribes', 'Emergency-first', 'Opt-in data'].map((item) => (
                  <View key={item} style={styles.trustItem}>
                    <View style={styles.trustTick}>
                      <Check size={11} color={color.ink} />
                    </View>
                    <Text style={styles.trustText}>{item}</Text>
                  </View>
                ))}
              </View>
            </Animated.View>

            <View style={styles.heroStage}>
              <View style={styles.heroDisc} />
              <HeroBody height={600} />
              <Float delay={0} style={{ position: 'absolute', top: 70, left: -10 }}>
                <OrganNote art="lungs" fill={pastel.aqua} title="AQI 152 near you" detail="Throat irritation more likely" />
              </Float>
              <Float delay={700} style={{ position: 'absolute', top: 250, right: -30 }}>
                <OrganNote art="gut" fill={pastel.butter} title="Biryani at 23:42" detail="Acidity risk up tomorrow" />
              </Float>
              <Float delay={1400} style={{ position: 'absolute', bottom: 90, left: 0 }}>
                <OrganNote art="sleep" fill={pastel.lilac} title="4.5 h sleep" detail="Below your usual 6.2 h" />
              </Float>
              <Float delay={2100} style={{ position: 'absolute', bottom: 160, right: -10 }}>
                <OrganNote art="heart" fill={pastel.peach} title="HRV 40 ms" detail="22% under your normal" />
              </Float>
            </View>
          </View>
        </View>

        {/* Sources strip */}
        <View style={styles.strip}>
          <Text variant="label" style={{ color: color.inkSoft }}>
            READS WHAT YOU ALREADY HAVE
          </Text>
          <View style={styles.stripItems}>
            {['Health Connect', 'Gmail orders', 'Google Calendar', 'Live air quality', 'Lab reports', 'Prescriptions'].map((s) => (
              <Text key={s} style={styles.stripItem}>
                {s}
              </Text>
            ))}
          </View>
        </View>

        {/* Seven systems */}
        <View style={styles.section} onLayout={mark('systems')}>
          <SectionTitle eyebrow="Your body" title="Seven systems, one living picture" sub="Each one scored daily from your own signals, so you see what changed before it becomes a problem." />
          <View style={styles.systemGrid}>
            {SYSTEMS.map((s, i) => (
              <SystemCard key={s.key} keyName={s.key} label={s.label} index={i} />
            ))}
            <View style={[styles.systemCard, { backgroundColor: color.ink, justifyContent: 'space-between' }]}>
              <Text style={{ fontFamily: font.bold, fontSize: 22, lineHeight: 28, letterSpacing: -0.5, color: '#FFFFFF' }}>
                Tap any organ.{'\n'}See why.
              </Text>
              <Text style={{ fontFamily: font.regular, fontSize: 14, lineHeight: 20, color: 'rgba(255,255,255,0.7)' }}>
                Every score links to the signals behind it and what to do next.
              </Text>
              <Button label="Try it" kind="secondary" compact onPress={() => goTo('start')} style={{ alignSelf: 'flex-start' }} />
            </View>
          </View>
        </View>

        {/* How it works */}
        <View style={[styles.section, styles.sectionWhite]} onLayout={mark('how')}>
          <SectionTitle eyebrow="How it works" title="A health assistant that already knows your week" />
          <View style={styles.cardsRow}>
            {STEPS.map(({ art, title, detail }, index) => (
              <View key={title} style={[styles.stepCard, { backgroundColor: [pastel.peach, pastel.rose, pastel.butter][index] }]}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <RNText style={styles.stepNumber}>0{index + 1}</RNText>
                  <OrganArt art={art} size={96} disc={false} />
                </View>
                <Text variant="title" style={{ fontSize: 22 }}>
                  {title}
                </Text>
                <Text variant="body" style={{ color: color.inkSoft, fontSize: 15, lineHeight: 22 }}>
                  {detail}
                </Text>
              </View>
            ))}
          </View>
          <View style={[styles.grid3, { marginTop: 18 }]}>
            {SOURCES.map(({ icon: Icon, title, detail }) => (
              <View key={title} style={styles.sourceTile}>
                <View style={styles.sourceIcon}>
                  <Icon size={19} color={color.ink} />
                </View>
                <View style={{ flex: 1, gap: 3 }}>
                  <Text variant="heading">{title}</Text>
                  <Text variant="body" style={{ fontSize: 13 }}>
                    {detail}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        </View>

        {/* Ask demo */}
        <View style={styles.section}>
          <View style={styles.splitRow}>
            <View style={{ flex: 1, gap: 16 }}>
              <SectionTitle eyebrow="Ask VitaSense" title="“I feel nauseous after lunch.” Here’s why." align="left" />
              <Text variant="body" style={{ fontSize: 16, lineHeight: 25 }}>
                Chest pain isn’t always the heart and nausea isn’t only pregnancy. VitaSense ranks the likely causes from your own week,
                shows the evidence, and tells you who to see and how soon.
              </Text>
              {[
                { icon: Stethoscope, text: 'Names the right specialist, and how soon' },
                { icon: MapPin, text: 'Finds them near you, with directions and phone' },
                { icon: Siren, text: 'Danger signs go straight to 112' },
              ].map(({ icon: Icon, text }) => (
                <View key={text} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <View style={styles.smallIcon}>
                    <Icon size={16} color={color.ink} />
                  </View>
                  <Text variant="bodyStrong" style={{ fontSize: 15 }}>
                    {text}
                  </Text>
                </View>
              ))}
            </View>
            <ChatDemo />
          </View>
        </View>

        {/* Doctor */}
        <View style={[styles.section, styles.sectionWhite]} onLayout={mark('doctor')}>
          <View style={styles.splitRow}>
            <ReportPreview />
            <View style={{ flex: 1, gap: 16 }}>
              <SectionTitle eyebrow="For your doctor" title="Walk in with your story on one page" align="left" />
              <Text variant="body" style={{ fontSize: 16, lineHeight: 25 }}>
                A one-page summary for the specialist you’re seeing: your complaint and timeline, 30 days of sleep, food and stress,
                allergies, past illness, current medicines and recent lab values.
              </Text>
              {[
                { icon: FileText, text: 'Print, save as PDF or show it on your phone' },
                { icon: Camera, text: 'Scan their prescription back in one photo' },
                { icon: BellRing, text: 'Medicine reminders, with dos and don’ts' },
              ].map(({ icon: Icon, text }) => (
                <View key={text} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <View style={styles.smallIcon}>
                    <Icon size={16} color={color.ink} />
                  </View>
                  <Text variant="bodyStrong" style={{ fontSize: 15 }}>
                    {text}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        </View>

        {/* Android */}
        <View style={styles.section} onLayout={mark('android')}>
          <View style={styles.androidCard}>
            <View style={[styles.glow, { backgroundColor: '#3A3A3A', right: -120, top: -160, width: 520, height: 520, opacity: 0.6 }]} pointerEvents="none" />
            <View style={{ flex: 1, gap: 18, justifyContent: 'center' }}>
              <View style={[styles.eyebrow, { backgroundColor: 'rgba(255,255,255,0.08)', borderColor: 'rgba(255,255,255,0.14)' }]}>
                <Smartphone size={13} color="#FFFFFF" />
                <Text style={[styles.eyebrowText, { color: '#FFFFFF' }]}>Android app</Text>
              </View>
              <Text style={[styles.sectionTitle, { color: '#FFFFFF', fontSize: 42, lineHeight: 48, maxWidth: 520 }]}>
                Put it on your phone. It collects on its own.
              </Text>
              <Text style={{ fontFamily: font.regular, fontSize: 16, lineHeight: 25, color: 'rgba(255,255,255,0.72)', maxWidth: 480 }}>
                The app reads Health Connect, your calendar and location in the background, reminds you about medicines and scans
                reports with the camera. Android 8 and newer.
              </Text>
              <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
                <Pressable onPress={openApk} style={({ hovered }: PressState) => [styles.apkButton, hovered && { backgroundColor: '#EDEDE8' }]}>
                  <Download size={18} color={color.ink} />
                  <View>
                    <RNText style={{ fontFamily: font.medium, fontSize: 11, color: color.inkSoft }}>Download the APK</RNText>
                    <RNText style={{ fontFamily: font.bold, fontSize: 16, color: color.ink }}>VitaSense for Android</RNText>
                  </View>
                </Pressable>
              </View>
              <Text style={{ fontFamily: font.regular, fontSize: 12.5, lineHeight: 18, color: 'rgba(255,255,255,0.5)' }}>
                Open the downloaded file and allow installing from your browser when Android asks.
              </Text>
            </View>
            <PhoneMock />
          </View>
        </View>

        {/* Safety */}
        <View style={[styles.section, styles.sectionWhite]} onLayout={mark('safety')}>
          <SectionTitle eyebrow="Safety & privacy" title="Careful by design" />
          <View style={styles.grid4}>
            {SAFETY.map(({ icon: Icon, title, detail, fill }) => (
              <View key={title} style={[styles.safetyTile, { backgroundColor: fill }]}>
                <View style={styles.safetyIcon}>
                  <Icon size={20} color={color.ink} />
                </View>
                <Text variant="heading" style={{ fontSize: 16 }}>
                  {title}
                </Text>
                <Text variant="body" style={{ fontSize: 13.5, color: color.inkSoft }}>
                  {detail}
                </Text>
              </View>
            ))}
          </View>
        </View>

        {/* Start */}
        <View style={styles.section} onLayout={mark('start')}>
          <View style={styles.splitRow}>
            <View style={{ flex: 1, gap: 14 }}>
              <SectionTitle eyebrow="Try it now" title="Start knowing why." align="left" />
              <Text variant="body" style={{ fontSize: 16, lineHeight: 25, maxWidth: 460 }}>
                Open a demo profile with a month of sample history, or create your own and connect your data one source at a time.
              </Text>
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 6 }}>
                {(['heart', 'lungs', 'brain', 'kidneys'] as ArtKey[]).map((art, i) => (
                  <OrganArt key={art} art={art} size={64} fill={[pastel.peach, pastel.aqua, pastel.rose, pastel.sky][i]} />
                ))}
              </View>
            </View>
            <View style={{ flex: 1, alignItems: 'flex-end' }}>{picker}</View>
          </View>
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <View style={styles.footerInner}>
            <Logo size={28} />
            <Text style={styles.footerText}>VitaSense is a health information tool, not a medical device. It does not diagnose or prescribe.</Text>
            <Text style={styles.footerText}>© 2026 VitaSense</Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

/* ---------- Pieces ---------- */

/** The live body map, cycling through systems until the visitor taps one. */
function HeroBody({ height, compact = false }: { height: number; compact?: boolean }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused) return;
    const timer = setInterval(() => setIndex((i) => (i + 1) % CYCLE.length), 2600);
    return () => clearInterval(timer);
  }, [paused]);
  const scores: Partial<Record<SystemKey, number>> = { heart: 64, gut: 41, lungs: 58, mind: 47, hydration: 72, immune: 69 };
  return (
    <View style={{ alignItems: 'center', paddingVertical: compact ? 10 : 0 }}>
      <BodyMap
        height={height}
        selected={CYCLE[index]}
        scores={scores}
        onSelect={(key) => {
          setPaused(true);
          const at = CYCLE.indexOf(key);
          if (at >= 0) setIndex(at);
        }}
      />
    </View>
  );
}

/** Gentle up-and-down drift for floating cards. */
function Float({ children, delay, style }: { children: ReactNode; delay: number; style?: StyleProp<ViewStyle> }) {
  const reduce = useReducedMotion();
  const y = useSharedValue(0);
  useEffect(() => {
    if (reduce) return;
    y.value = withDelay(delay, withRepeat(withTiming(1, { duration: 2600, easing: Easing.inOut(Easing.sin) }), -1, true));
    return () => cancelAnimation(y);
  }, [y, delay, reduce]);
  const drift = useAnimatedStyle(() => ({ transform: [{ translateY: -8 + y.value * 16 }] }));
  return (
    <Animated.View entering={FadeInUp.delay(300 + delay / 3).duration(600)} style={style}>
      <Animated.View style={drift}>{children}</Animated.View>
    </Animated.View>
  );
}

function OrganNote({ art, fill, title, detail }: { art: ArtKey; fill: string; title: string; detail: string }) {
  return (
    <View style={styles.note}>
      <OrganArt art={art} size={44} fill={fill} />
      <View>
        <Text style={{ fontFamily: font.semibold, fontSize: 13.5, color: color.ink }}>{title}</Text>
        <Text style={{ fontFamily: font.regular, fontSize: 12, color: color.inkSoft }}>{detail}</Text>
      </View>
    </View>
  );
}

function SystemCard({ keyName, label, index }: { keyName: SystemKey; label: string; index: number }) {
  const look = SYSTEM_LOOK[keyName];
  const copy = SYSTEM_COPY[keyName];
  return (
    <Pressable style={({ hovered }: PressState) => [styles.systemCard, { backgroundColor: look.fill }, hovered && { transform: [{ translateY: -4 }] }]}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <RNText style={styles.systemIndex}>0{index + 1}</RNText>
        <OrganArt art={look.art} size={104} disc={false} />
      </View>
      <View style={{ gap: 4 }}>
        <Text variant="heading" style={{ fontSize: 17 }}>
          {label}
        </Text>
        <Text variant="small" style={{ color: color.inkSoft }}>
          Watches {copy.watches}
        </Text>
      </View>
      <View style={styles.systemExample}>
        <View style={[styles.exampleDot, { backgroundColor: look.accent }]} />
        <Text variant="small" style={{ color: color.ink, flex: 1 }}>
          {copy.example}
        </Text>
      </View>
    </Pressable>
  );
}

function ChatDemo() {
  return (
    <View style={styles.chatWrap}>
      <View style={styles.chatUser}>
        <RNText style={{ fontFamily: font.medium, fontSize: 14, color: '#FFFFFF' }}>I feel nauseous after lunch, and a bit of acidity.</RNText>
      </View>
      <View style={styles.chatBot}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <OrganArt art="gut" size={34} fill={pastel.butter} />
          <Text variant="heading">Most likely: acid reflux after late meals</Text>
        </View>
        {[
          ['Late fried dinner', 'Biryani + Chicken 65 at 23:42 (Swiggy)'],
          ['Short sleep', '4.5 h last night, below your usual 6.2 h'],
          ['Already on it', 'You bought Digene from PharmEasy yesterday'],
        ].map(([title, detail]) => (
          <View key={title} style={styles.evidence}>
            <Check size={14} color={color.good} />
            <View style={{ flex: 1 }}>
              <Text variant="bodyStrong" style={{ fontSize: 13 }}>
                {title}
              </Text>
              <Text variant="small">{detail}</Text>
            </View>
          </View>
        ))}
        <View style={styles.chatDoctor}>
          <Stethoscope size={15} color={color.ink} />
          <Text variant="small" style={{ flex: 1, color: color.ink }}>
            If it lasts beyond 3 days: <Text style={{ fontFamily: font.semibold, fontSize: 12 }}>gastroenterologist</Text>. 4 near you.
          </Text>
        </View>
      </View>
      <Badge label="Sample conversation" tone="neutral" />
    </View>
  );
}

function PhoneMock() {
  return (
    <View style={styles.phone}>
      <View style={styles.phoneScreen}>
        <View style={styles.statusBar}>
          <RNText style={styles.statusTime}>9:41</RNText>
          <View style={styles.phoneNotch} />
          <View style={{ flexDirection: 'row', gap: 3 }}>
            <View style={[styles.statusPip, { width: 14 }]} />
            <View style={[styles.statusPip, { width: 20 }]} />
          </View>
        </View>
        <Image source={APP_SCREEN} style={{ flex: 1, width: '100%' }} contentFit="cover" contentPosition="top" />
      </View>
    </View>
  );
}

function SectionTitle({ eyebrow, title, sub, align = 'center' }: { eyebrow: string; title: string; sub?: string; align?: 'center' | 'left' }) {
  return (
    <View style={{ gap: 10, alignItems: align === 'center' ? 'center' : 'flex-start', marginBottom: align === 'center' ? 34 : 2 }}>
      <View style={[styles.eyebrow, { alignSelf: align === 'center' ? 'center' : 'flex-start' }]}>
        <Text style={styles.eyebrowText}>{eyebrow}</Text>
      </View>
      <Text style={[styles.sectionTitle, align === 'center' && { textAlign: 'center' }]}>{title}</Text>
      {sub && <Text style={[styles.sectionSub, align === 'center' && { textAlign: 'center' }]}>{sub}</Text>}
    </View>
  );
}

/** A miniature of the doctor report, so visitors can see what the doctor gets. Sample data, labelled. */
function ReportPreview() {
  return (
    <View style={styles.reportWrap}>
      <View style={styles.reportPaper}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View>
            <Text variant="label">PATIENT SUMMARY · GASTROENTEROLOGIST</Text>
            <Text variant="title" style={{ fontSize: 18 }}>
              Sample patient
            </Text>
          </View>
          <Badge label="Sample" tone="neutral" />
        </View>
        <View style={styles.reportReason}>
          <Text variant="label" style={{ color: color.ink }}>
            REASON FOR VISIT
          </Text>
          <Text variant="bodyStrong" style={{ fontSize: 13 }}>
            Burning chest discomfort after meals for 5 days, worse lying down and after coffee.
          </Text>
        </View>
        {[
          ['Sleep, last 30 days', '5.9 h avg · 4 short nights this week'],
          ['Food', 'Ordered fried food after 23:00 three times'],
          ['Allergies', 'Sulfa drugs'],
          ['Current medicines', 'Pantoprazole 40 mg, before breakfast'],
          ['Recent labs', 'LDL 156 mg/dL (high), HbA1c 5.9 % (high)'],
        ].map(([label, value]) => (
          <View key={label} style={styles.reportLine}>
            <Text variant="small" style={{ width: 128 }}>
              {label}
            </Text>
            <Text variant="body" style={{ flex: 1, fontSize: 12.5, color: color.ink }}>
              {value}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const MAX = 1200;

const styles = StyleSheet.create({
  glow: { position: 'absolute', width: 420, height: 420, borderRadius: 999, opacity: 0.7, filter: 'blur(100px)' },

  // Phone
  mHero: { paddingHorizontal: 20, paddingBottom: 20, overflow: 'hidden' },
  mTitle: { fontFamily: font.bold, fontSize: 34, lineHeight: 39, letterSpacing: -1.2, color: color.ink },
  mSub: { fontFamily: font.regular, fontSize: 15, lineHeight: 22, color: color.inkSoft },
  mGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  mSystem: { width: '48%', flexGrow: 1, padding: 14, gap: 4, borderRadius: radius.lg },
  mStep: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: radius.lg, backgroundColor: color.surface },

  // Nav
  navWrap: { paddingTop: 14, paddingHorizontal: 24, backgroundColor: 'rgba(242,242,239,0.82)', backdropFilter: 'blur(14px)' } as object,
  navInner: {
    maxWidth: MAX,
    width: '100%',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    height: 64,
    gap: 16,
    paddingHorizontal: 14,
    paddingLeft: 18,
    borderRadius: 32,
    backgroundColor: color.surface,
    boxShadow: shadow.card,
    marginBottom: 10,
  },
  navLinks: { flexDirection: 'row', gap: 2, marginHorizontal: 'auto' },
  navLink: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: radius.pill },
  navLinkText: { fontFamily: font.medium, fontSize: 14, color: color.inkSoft },

  // Hero
  hero: { overflow: 'hidden', paddingTop: 24, paddingBottom: 40 },
  heroInner: { maxWidth: MAX, width: '100%', alignSelf: 'center', paddingHorizontal: 24, flexDirection: 'row', alignItems: 'center', gap: 32, minHeight: 640 },
  heroCopy: { flex: 1, gap: 20, zIndex: 2 },
  eyebrow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.line,
  },
  eyebrowText: { fontFamily: font.semibold, fontSize: 12.5, color: color.ink, letterSpacing: 0.1 },
  heroTitle: { fontFamily: font.bold, fontSize: 68, lineHeight: 70, letterSpacing: -3, color: color.ink },
  heroSub: { fontFamily: font.regular, fontSize: 18, lineHeight: 28, color: color.inkSoft, maxWidth: 500 },
  trustRow: { flexDirection: 'row', gap: 20, marginTop: 6, flexWrap: 'wrap' },
  trustItem: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  trustTick: { width: 20, height: 20, borderRadius: 10, backgroundColor: pastel.mint, alignItems: 'center', justifyContent: 'center' },
  trustText: { fontFamily: font.medium, fontSize: 14, color: color.ink },
  heroStage: { flex: 1, height: 640, alignItems: 'center', justifyContent: 'center' },
  heroDisc: {
    position: 'absolute',
    width: 470,
    height: 470,
    borderRadius: 235,
    backgroundColor: 'rgba(255,255,255,0.75)',
    top: 40,
    filter: 'blur(4px)',
  },
  note: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 8,
    paddingRight: 16,
    borderRadius: 40,
    backgroundColor: color.surface,
    boxShadow: '0px 14px 34px rgba(17,17,17,0.10)',
  },

  // Strip
  strip: { alignItems: 'center', gap: 14, paddingVertical: 26, borderTopWidth: 1, borderBottomWidth: 1, borderColor: color.line },
  stripItems: { flexDirection: 'row', gap: 36, flexWrap: 'wrap', justifyContent: 'center', paddingHorizontal: 24 },
  stripItem: { fontFamily: font.semibold, fontSize: 16, color: color.inkMuted, letterSpacing: -0.2 },

  // Sections
  section: { paddingVertical: 88, paddingHorizontal: 24 },
  sectionWhite: { backgroundColor: color.surface, borderRadius: 48, marginHorizontal: 16 },
  sectionTitle: { fontFamily: font.bold, fontSize: 44, lineHeight: 50, letterSpacing: -1.6, color: color.ink, maxWidth: 720 },
  sectionSub: { fontFamily: font.regular, fontSize: 17, lineHeight: 26, color: color.inkSoft, maxWidth: 560 },
  systemGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, maxWidth: MAX, width: '100%', alignSelf: 'center' },
  systemCard: { width: '23.8%', flexGrow: 1, minHeight: 300, padding: 22, gap: 14, borderRadius: radius.xl, justifyContent: 'space-between' },
  systemIndex: { fontFamily: font.semibold, fontSize: 13, color: color.inkSoft },
  systemExample: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', padding: 12, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.65)' },
  exampleDot: { width: 8, height: 8, borderRadius: 4, marginTop: 4 },
  cardsRow: { flexDirection: 'row', gap: 16, maxWidth: MAX, width: '100%', alignSelf: 'center' },
  stepCard: { flex: 1, gap: 12, padding: 26, borderRadius: radius.xl, minHeight: 300 },
  stepNumber: { fontFamily: font.bold, fontSize: 44, letterSpacing: -2, color: color.ink, opacity: 0.85 },
  grid3: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, maxWidth: MAX, width: '100%', alignSelf: 'center' },
  sourceTile: { flexBasis: '31%', flexGrow: 1, flexDirection: 'row', gap: 14, padding: 20, borderRadius: radius.lg, backgroundColor: color.canvas },
  sourceIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: color.surface, alignItems: 'center', justifyContent: 'center' },
  splitRow: { flexDirection: 'row', gap: 56, alignItems: 'center', maxWidth: MAX, width: '100%', alignSelf: 'center' },
  smallIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: color.surface, alignItems: 'center', justifyContent: 'center', boxShadow: shadow.card },

  // Chat demo
  chatWrap: { flex: 1, gap: 12, padding: 24, borderRadius: radius.xl, backgroundColor: color.surface, boxShadow: shadow.raised },
  chatUser: { alignSelf: 'flex-end', maxWidth: '82%', backgroundColor: color.ink, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 20, borderBottomRightRadius: 6 },
  chatBot: { gap: 10, padding: 16, borderRadius: 20, borderTopLeftRadius: 6, backgroundColor: color.canvas },
  evidence: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', padding: 10, borderRadius: 14, backgroundColor: color.surface },
  chatDoctor: { flexDirection: 'row', gap: 8, alignItems: 'center', padding: 10, borderRadius: 14, backgroundColor: pastel.butter },

  // Report
  reportWrap: { flex: 1, padding: 28, borderRadius: radius.xl, backgroundColor: pastel.sky },
  reportPaper: { backgroundColor: color.surface, borderRadius: 18, padding: 22, gap: 10, transform: [{ rotate: '-1.5deg' }], boxShadow: shadow.raised },
  reportReason: { gap: 4, padding: 12, borderRadius: 12, backgroundColor: pastel.butter },
  reportLine: { flexDirection: 'row', gap: 10, paddingVertical: 7, borderTopWidth: 1, borderTopColor: color.line },

  // Android
  androidCard: {
    maxWidth: MAX,
    width: '100%',
    alignSelf: 'center',
    flexDirection: 'row',
    gap: 40,
    padding: 56,
    paddingBottom: 0,
    borderRadius: 48,
    backgroundColor: color.ink,
    overflow: 'hidden',
  },
  apkButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 20,
    backgroundColor: '#FFFFFF',
  },
  phone: {
    width: 300,
    height: 560,
    borderTopLeftRadius: 46,
    borderTopRightRadius: 46,
    padding: 10,
    paddingBottom: 0,
    backgroundColor: '#2B2B2B',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    marginTop: 8,
  },
  phoneScreen: { flex: 1, borderTopLeftRadius: 37, borderTopRightRadius: 37, overflow: 'hidden', backgroundColor: color.canvas },
  phoneNotch: { width: 11, height: 11, borderRadius: 6, backgroundColor: '#111' },
  statusBar: { height: 30, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 22, backgroundColor: color.canvas },
  statusTime: { fontFamily: font.semibold, fontSize: 11, color: color.ink },
  statusPip: { height: 7, borderRadius: 3, backgroundColor: color.ink, opacity: 0.8 },

  // Safety
  grid4: { flexDirection: 'row', gap: 16, maxWidth: MAX, width: '100%', alignSelf: 'center' },
  safetyTile: { flex: 1, gap: 10, padding: 24, borderRadius: radius.xl },
  safetyIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.7)', alignItems: 'center', justifyContent: 'center' },

  // Footer
  footer: { paddingHorizontal: 24, paddingVertical: 36 },
  footerInner: {
    maxWidth: MAX,
    width: '100%',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 24,
    paddingTop: 28,
    borderTopWidth: 1,
    borderTopColor: color.line,
  },
  footerText: { fontFamily: font.regular, fontSize: 12.5, color: color.inkMuted, flexShrink: 1 },

  // Picker
  picker: { width: '100%', maxWidth: 440, padding: 28, borderRadius: radius.xl, boxShadow: shadow.raised },
  offline: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: radius.sm, backgroundColor: color.surfaceSoft, marginBottom: 12 },
  userRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: radius.md, backgroundColor: color.canvas },
  userAvatar: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  divider: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 18 },
  dividerLine: { flex: 1, height: 1, backgroundColor: color.line },
  input: {
    flex: 1,
    minWidth: 0,
    height: 44,
    borderRadius: radius.pill,
    paddingHorizontal: 18,
    fontFamily: font.regular,
    fontSize: 14,
    color: color.ink,
    backgroundColor: color.canvas,
  },
});
