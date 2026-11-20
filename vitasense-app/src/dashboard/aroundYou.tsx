import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { ArrowUpRight } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text as RNText, View } from 'react-native';

import { ORGAN_ART, type ArtKey } from '@/body/art';
import { enabledFactorSources } from '@/collect/sync';
import { api, type HealthFactors } from '@/lib/api';
import { useSession } from '@/lib/session';
import { color, font, pastel, radius } from '@/theme/tokens';
import { Card, IconButton, type PressState, Text } from '@/ui/primitives';

const ART: Partial<Record<string, ArtKey>> = {
  air_pollution: 'lungs',
  allergens: 'lungs',
  respiratory: 'lungs',
  aedes: 'mosquito',
  anopheles: 'mosquito',
  culex: 'mosquito',
  water: 'gut',
  food_spoilage: 'gut',
};

/** Home summary of everything affecting the user: coverage, the top risks around them, a way in. */
export function AroundYouCard() {
  const router = useRouter();
  const { user, forecast } = useSession();
  const [data, setData] = useState<HealthFactors | null>(null);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    void (async () => {
      try {
        const connected = await enabledFactorSources(user.id);
        const platform = Platform.OS === 'android' ? 'android' : Platform.OS === 'ios' ? 'ios' : 'web';
        const next = await api.factors(user.id, { platform, connected, sex: user.biological_sex });
        if (alive) setData(next);
      } catch {
        // The card simply stays hidden when factors can't load.
      }
    })();
    return () => {
      alive = false;
    };
    // Refresh when a new forecast arrives (new data was collected).
  }, [user, forecast]);

  if (!data) return null;
  const top = data.risks.filter((r) => r.level !== 'low').slice(0, 2);
  const c = data.counts;

  return (
    <Card style={{ gap: 12 }}>
      <View style={styles.head}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="heading">What’s affecting you</Text>
          <Text variant="small">
            {c.live} of {c.total} factors tracked automatically{c.connect ? ` · ${c.connect} more with one tap` : ''}
          </Text>
        </View>
        <IconButton label="All health factors" size={36} onPress={() => router.navigate('/factors')}>
          <ArrowUpRight size={16} color={color.ink} />
        </IconButton>
      </View>
      <View style={styles.bar}>
        {(['live', 'recorded', 'waiting', 'connect', 'manual'] as const)
          .filter((s) => c[s] > 0)
          .map((s) => (
            <View
              key={s}
              style={{
                flex: c[s],
                height: 8,
                backgroundColor: { live: '#3E9B5F', recorded: '#2A7D99', waiting: '#C99A12', connect: '#E07F5E', manual: '#C4C6CB' }[s],
              }}
            />
          ))}
      </View>
      {top.length > 0 ? (
        <View style={{ gap: 8 }}>
          {top.map((risk) => {
            const art = ART[risk.id];
            return (
              <Pressable
                key={risk.id}
                onPress={() => router.navigate('/factors')}
                style={({ hovered }: PressState) => [
                  styles.risk,
                  { backgroundColor: risk.level === 'high' ? pastel.peach : pastel.butter },
                  hovered && { opacity: 0.9 },
                ]}>
                <View style={{ flex: 1, gap: 2 }}>
                  <RNText style={styles.level}>
                    {risk.level === 'high' ? 'High' : 'Moderate'} · {risk.kind === 'measured' ? 'measured' : 'estimate'}
                  </RNText>
                  <Text variant="bodyStrong" style={{ fontSize: 14 }}>
                    {risk.title}
                  </Text>
                  <Text variant="small" numberOfLines={1} style={{ color: color.ink }}>
                    {risk.why[0]}
                  </Text>
                </View>
                {art && <Image source={ORGAN_ART[art]} style={styles.art} contentFit="contain" />}
              </Pressable>
            );
          })}
        </View>
      ) : (
        <Text variant="small">
          {data.risks.length ? 'No elevated risks around you right now.' : 'Connect location to see air, water and infection risks where you are.'}
        </Text>
      )}
      {data.outbreaks.length > 0 && (
        <Text variant="small" style={{ color: color.ink }}>
          {data.outbreaks.length} WHO outbreak notice{data.outbreaks.length === 1 ? '' : 's'} for your country
        </Text>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  bar: { flexDirection: 'row', gap: 2, borderRadius: 5, overflow: 'hidden' },
  risk: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: radius.md, minHeight: 74 },
  level: { fontFamily: font.semibold, fontSize: 11, color: color.inkSoft, letterSpacing: 0.3 },
  art: { width: 58, height: 58 },
});
