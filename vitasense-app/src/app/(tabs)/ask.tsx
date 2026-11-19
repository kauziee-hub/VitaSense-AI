import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect, useRouter } from 'expo-router';
import {
  ArrowUp,
  Droplets,
  FileText,
  MapPin,
  Moon,
  RotateCcw,
  ShieldCheck,
  Smartphone,
  Square,
  Waves,
  Wind,
} from 'lucide-react-native';
import { type ComponentRef, Fragment, useCallback, useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, type CollectedItem } from '@/lib/api';
import { newSessionId, streamChat } from '@/lib/chat';
import { useSession } from '@/lib/session';
import { useKeyboardVisible } from '@/lib/useKeyboardVisible';
import { OrganArt } from '@/dashboard/organs';
import { LogoMark } from '@/shell/Logo';
import { specialtiesIn } from '@/lib/specialty';
import { breakpoint, color, font, pastel, radius, shadow } from '@/theme/tokens';
import { Badge, Card, IconButton, Text, type PressState } from '@/ui/primitives';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  pending?: boolean;
  failed?: boolean;
}

const SUGGESTIONS = [
  'I have chest pain since last night',
  'Why am I so tired this week?',
  'I feel nauseous after lunch',
  'Is anything spreading near me right now?',
];

export default function AskScreen() {
  const { width } = useWindowDimensions();
  const wide = width >= breakpoint.wide;
  const insets = useSafeAreaInsets();
  const keyboardOpen = useKeyboardVisible();
  const { user, forecast, pendingQuestion, setPendingQuestion, health } = useSession();
  const storageKey = `vitasense.chat.${user?.id}`;
  const [messages, setMessages] = useState<Message[]>([]);
  const [sessionId, setSessionId] = useState<string>(newSessionId());
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const abortRef = useRef<AbortController | null>(null);
  const loadedRef = useRef(false);

  // Restore this user's conversation.
  useEffect(() => {
    loadedRef.current = false;
    AsyncStorage.getItem(storageKey)
      .then((raw) => {
        if (!raw) return;
        const saved = JSON.parse(raw) as { sessionId: string; messages: Message[] };
        setSessionId(saved.sessionId);
        setMessages(saved.messages.filter((m) => !m.pending));
      })
      .catch(() => undefined)
      .finally(() => {
        loadedRef.current = true;
      });
  }, [storageKey]);

  useEffect(() => {
    if (!loadedRef.current) return;
    AsyncStorage.setItem(storageKey, JSON.stringify({ sessionId, messages: messages.slice(-60) })).catch(() => undefined);
  }, [messages, sessionId, storageKey]);

  // Orders and purchases VitaSense picked up automatically, shown beside the chat.
  const [picked, setPicked] = useState<CollectedItem[]>([]);
  useEffect(() => {
    if (!user) return;
    let alive = true;
    api
      .collectStatus(user.id)
      .then((status) => alive && setPicked(status.recent_items.slice(0, 3)))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [user]);

  const send = useCallback(
    async (raw: string) => {
      const text = raw.trim();
      if (!text || busy || !user) return;
      setInput('');
      setBusy(true);
      const replyId = `a-${Date.now()}`;
      setMessages((prev) => [
        ...prev,
        { id: `u-${Date.now()}`, role: 'user', text },
        { id: replyId, role: 'assistant', text: '', pending: true },
      ]);
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        await streamChat({ userId: user.id, sessionId, message: text, signal: controller.signal }, (acc) =>
          setMessages((prev) => prev.map((m) => (m.id === replyId ? { ...m, text: acc } : m))),
        );
        setMessages((prev) => prev.map((m) => (m.id === replyId ? { ...m, pending: false } : m)));
      } catch (error) {
        const aborted = controller.signal.aborted;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === replyId
              ? {
                  ...m,
                  pending: false,
                  failed: !aborted,
                  text: m.text || (aborted ? 'Stopped.' : error instanceof Error ? error.message : 'Something went wrong.'),
                }
              : m,
          ),
        );
      } finally {
        abortRef.current = null;
        setBusy(false);
      }
    },
    [busy, sessionId, user],
  );

  // A question handed over from the dashboard ("Ask why", "Ask about this").
  useFocusEffect(
    useCallback(() => {
      if (pendingQuestion && !busy) {
        setPendingQuestion(null);
        void send(pendingQuestion);
      }
    }, [pendingQuestion, busy, send, setPendingQuestion]),
  );

  const newChat = () => {
    abortRef.current?.abort();
    setMessages([]);
    setSessionId(newSessionId());
  };

  const conversation = (
    <View style={{ flex: 1 }}>
      <View style={[styles.header, { paddingTop: wide ? 20 : insets.top + 10 }]}>
        <LogoMark size={40} />
        <View style={{ flex: 1 }}>
          <Text variant="title" style={{ fontSize: 19 }}>
            Ask VitaSense
          </Text>
          <Text variant="small">Uses your last 30 days · explains causes · never prescribes</Text>
        </View>
        {health && !health.ai && <Badge label="AI offline" tone="risk" dot />}
        <IconButton label="New conversation" onPress={newChat}>
          <RotateCcw size={16} color={color.inkSoft} />
        </IconButton>
      </View>

      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={[styles.thread, { paddingBottom: 24 }]}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}>
        {messages.length === 0 ? (
          <View style={styles.empty}>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 4 }}>
              <OrganArt art="heart" size={62} fill={pastel.peach} />
              <View style={{ marginLeft: -12, zIndex: 1 }}>
                <OrganArt art="brain" size={76} fill={pastel.rose} />
              </View>
              <View style={{ marginLeft: -12 }}>
                <OrganArt art="gut" size={62} fill={pastel.butter} />
              </View>
            </View>
            <Text variant="title">How are you feeling?</Text>
            <Text variant="body" style={{ textAlign: 'center', maxWidth: 420 }}>
              Describe it in your own words. VitaSense checks it against your sleep, food, stress, air and what’s going around
              nearby, then tells you the likely reasons and which doctor to see.
            </Text>
            <View style={styles.suggestions}>
              {SUGGESTIONS.map((s) => (
                <Pressable
                  key={s}
                  onPress={() => void send(s)}
                  style={({ hovered }: PressState) => [styles.suggestion, hovered && { backgroundColor: color.canvasDeep }]}>
                  <Text variant="bodyStrong" style={{ fontSize: 13 }}>
                    {s}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : (
          messages.map((m, i) => (
            <Fragment key={m.id}>
              <Bubble message={m} />
              {m.role === 'assistant' && !m.pending && !m.failed && (
                <NextSteps answer={m.text} concern={lastUserText(messages, i)} id={m.id} />
              )}
            </Fragment>
          ))
        )}
      </ScrollView>

      {/* The floating tab bar hides behind the keyboard, so drop its reserved space while typing. */}
      <View style={[styles.composerWrap, { paddingBottom: wide ? 20 : keyboardOpen ? 8 : insets.bottom + 92 }]}>
        <View style={styles.composer}>
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder="Describe what you feel…"
            placeholderTextColor={color.inkFaint}
            multiline
            style={styles.input}
            onKeyPress={(e) => {
              const ev = e.nativeEvent as { key: string; shiftKey?: boolean };
              if (Platform.OS === 'web' && ev.key === 'Enter' && !ev.shiftKey) {
                (e as unknown as { preventDefault?: () => void }).preventDefault?.();
                void send(input);
              }
            }}
          />
          {busy ? (
            <IconButton label="Stop" active onPress={() => abortRef.current?.abort()} size={38}>
              <Square size={14} color="#FFFFFF" fill="#FFFFFF" />
            </IconButton>
          ) : (
            <IconButton label="Send" active={!!input.trim()} onPress={() => void send(input)} size={38}>
              <ArrowUp size={18} color={input.trim() ? '#FFFFFF' : color.inkMuted} />
            </IconButton>
          )}
        </View>
        <Text variant="small" style={{ textAlign: 'center', marginTop: 8, fontSize: 11 }}>
          Not a diagnosis. In an emergency call 112.
        </Text>
      </View>
    </View>
  );

  const body = wide ? (
    <View style={{ flex: 1, flexDirection: 'row' }}>
      <View style={{ flex: 1, maxWidth: 860, marginHorizontal: 'auto', width: '100%' }}>{conversation}</View>
      <View style={styles.contextPanel}>
        {ContextCard()}
      </View>
    </View>
  ) : (
    conversation
  );

  return (
    // Android draws edge-to-edge, so the window no longer shrinks for the keyboard; pad on both platforms.
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'web' ? undefined : 'padding'}>
      {body}
    </KeyboardAvoidingView>
  );

  function ContextCard() {
    const m = forecast?.metrics;
    const rows = [
      { icon: Moon, label: 'Sleep last night', value: m?.sleep?.value != null ? `${m.sleep.value.toFixed(1)} h` : '—' },
      { icon: Waves, label: 'HRV', value: m?.hrv?.value != null ? `${Math.round(m.hrv.value)} ms` : '—' },
      { icon: Droplets, label: 'Water', value: m?.hydration?.value != null ? `${(m.hydration.value / 1000).toFixed(1)} L` : '—' },
      { icon: Smartphone, label: 'Screen time', value: m?.screen_time?.value != null ? `${m.screen_time.value.toFixed(1)} h` : '—' },
      { icon: Wind, label: 'Air quality', value: m?.aqi?.value != null ? `AQI ${Math.round(m.aqi.value)}` : '—' },
    ];
    return (
      <Card style={{ gap: 12 }}>
        <Text variant="heading">What VitaSense knows right now</Text>
        {rows.map(({ icon: Icon, label, value }) => (
          <View key={label} style={styles.contextRow}>
            <Icon size={16} color={color.inkSoft} />
            <Text variant="body" style={{ flex: 1, fontSize: 13 }}>
              {label}
            </Text>
            <Text variant="bodyStrong" style={{ fontSize: 13 }}>
              {value}
            </Text>
          </View>
        ))}
        {picked.length > 0 && (
          <View style={{ gap: 8, marginTop: 2 }}>
            <Text variant="label">PICKED UP AUTOMATICALLY</Text>
            {picked.map((item) => (
              <View key={item.item_id} style={styles.contextNote}>
                <Text variant="small" style={{ color: color.ink }} numberOfLines={2}>
                  {item.summary}
                </Text>
                {!!item.details.flags?.length && (
                  <Text variant="small" style={{ color: '#9A6200', marginTop: 2 }} numberOfLines={1}>
                    {item.details.flags.join(' · ')}
                  </Text>
                )}
              </View>
            ))}
          </View>
        )}
        {forecast?.reasoning_timeline?.slice(0, picked.length ? 1 : 2).map((t) => (
          <View key={t.title} style={styles.contextNote}>
            <Text variant="small" style={{ color: color.inkSoft }}>
              {t.title}
            </Text>
          </View>
        ))}
        <View style={[styles.contextRow, { marginTop: 4 }]}>
          <ShieldCheck size={16} color={color.good} />
          <Text variant="small" style={{ flex: 1 }}>
            Emergencies are routed to 112 before any AI answer.
          </Text>
        </View>
      </Card>
    );
  }
}

function lastUserText(messages: Message[], before: number): string {
  for (let i = before - 1; i >= 0; i -= 1) if (messages[i].role === 'user') return messages[i].text;
  return '';
}

/** After an answer that names a doctor type: find one nearby, or prepare the visit report. */
function NextSteps({ answer, concern, id }: { answer: string; concern: string; id: string }) {
  const router = useRouter();
  const specialties = specialtiesIn(answer);
  if (!specialties.length || answer.startsWith('💛')) return null;
  const main = specialties[0];
  return (
    <View style={styles.nextSteps}>
      {specialties.map((s) => (
        <Pressable
          key={s}
          accessibilityRole="button"
          onPress={() => router.navigate({ pathname: '/doctors', params: { specialty: s } })}
          style={({ hovered }: PressState) => [styles.stepChip, hovered && { backgroundColor: color.skySoft, borderColor: color.sky }]}>
          <MapPin size={14} color={color.navy} />
          <Text variant="bodyStrong" style={{ fontSize: 13, color: color.navy }}>
            Find a {s.toLowerCase()} nearby
          </Text>
        </Pressable>
      ))}
      <Pressable
        accessibilityRole="button"
        onPress={() => router.navigate({ pathname: '/report', params: { specialty: main, concern, auto: id } })}
        style={({ hovered }: PressState) => [styles.stepChip, hovered && { backgroundColor: color.skySoft, borderColor: color.sky }]}>
        <FileText size={14} color={color.navy} />
        <Text variant="bodyStrong" style={{ fontSize: 13, color: color.navy }}>
          Prepare doctor report
        </Text>
      </Pressable>
    </View>
  );
}

function Bubble({ message }: { message: Message }) {
  if (message.role === 'user') {
    return (
      <View style={styles.userBubble}>
        <Text style={{ fontFamily: font.regular, fontSize: 14.5, lineHeight: 21, color: '#FFFFFF' }}>{message.text}</Text>
      </View>
    );
  }
  const emergency = message.text.startsWith('⚠️ The symptoms');
  const crisis = message.text.startsWith('💛');
  return (
    <View
      style={[
        styles.aiBubble,
        emergency && { backgroundColor: color.riskSoft, borderColor: '#F6B9BB' },
        crisis && { backgroundColor: color.watchSoft, borderColor: '#F3D199' },
        message.failed && { borderColor: '#F6B9BB' },
      ]}>
      {message.pending && !message.text ? <Typing /> : <Markdown text={message.text} />}
    </View>
  );
}

function Typing() {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <View style={styles.typingDot} />
      <Text variant="small">Checking your last 30 days…</Text>
    </View>
  );
}

/** Minimal markdown: ### headings, **bold**, bullet lines. Enough for the assistant's format. */
function Markdown({ text }: { text: string }) {
  const lines = text.split('\n');
  return (
    <View style={{ gap: 6 }}>
      {lines.map((line, i) => {
        const trimmed = line.trim();
        if (!trimmed) return null;
        const heading = /^#{1,4}\s+/.exec(trimmed);
        if (heading) {
          return (
            <Text key={i} variant="heading" style={{ marginTop: 6 }}>
              {inline(trimmed.slice(heading[0].length))}
            </Text>
          );
        }
        const bullet = /^([*\-•]|\d+\.)\s+/.exec(trimmed);
        if (bullet) {
          return (
            <View key={i} style={{ flexDirection: 'row', gap: 8, paddingLeft: 2 }}>
              <Text variant="body" style={{ color: color.navy }}>
                •
              </Text>
              <Text variant="body" style={{ flex: 1, color: color.ink, lineHeight: 21 }}>
                {inline(trimmed.slice(bullet[0].length))}
              </Text>
            </View>
          );
        }
        return (
          <Text key={i} variant="body" style={{ color: color.ink, lineHeight: 21 }}>
            {inline(trimmed)}
          </Text>
        );
      })}
    </View>
  );
}

function inline(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? (
      <Text key={i} style={{ fontFamily: font.semibold, color: color.ink }}>
        {part.slice(2, -2)}
      </Text>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: color.line,
  },
  thread: { padding: 20, gap: 14 },
  empty: { alignItems: 'center', gap: 10, paddingTop: 40 },
  suggestions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginTop: 14, maxWidth: 560 },
  suggestion: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.surface,
  },
  userBubble: {
    alignSelf: 'flex-end',
    maxWidth: '82%',
    backgroundColor: color.navy,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 18,
    borderBottomRightRadius: 6,
  },
  aiBubble: {
    alignSelf: 'flex-start',
    maxWidth: '92%',
    backgroundColor: color.surface,
    padding: 16,
    borderRadius: 18,
    borderBottomLeftRadius: 6,
    borderWidth: 1,
    borderColor: color.line,
    boxShadow: shadow.card,
  },
  typingDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: color.mint },
  nextSteps: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: -4, maxWidth: '92%' },
  stepChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.surface,
  },
  composerWrap: { paddingHorizontal: 16, paddingTop: 8 },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    padding: 6,
    paddingLeft: 16,
    borderRadius: 24,
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.line,
    boxShadow: shadow.raised,
  },
  input: {
    flex: 1,
    minHeight: 38,
    maxHeight: 140,
    paddingVertical: 9,
    fontFamily: font.regular,
    fontSize: 14.5,
    color: color.ink,
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : {}),
  },
  contextPanel: { width: 320, padding: 20, paddingLeft: 0 },
  contextRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  contextNote: { padding: 10, borderRadius: radius.sm, backgroundColor: color.surfaceSoft },
});
