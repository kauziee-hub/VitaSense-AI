import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, ExternalLink, FileText, LocateFixed, MapPin, Navigation, Phone, Siren, Star } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Platform, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { api, type NearbyDoctors, type NearbyPlace } from '@/lib/api';
import { type Coordinates, currentCoordinates } from '@/lib/location';
import { useSession } from '@/lib/session';
import { QUICK_SPECIALTIES } from '@/lib/specialty';
import { breakpoint, color, font } from '@/theme/tokens';
import { Badge, Button, Card, Chip, IconButton, Text } from '@/ui/primitives';

/** Where the demo profiles live (their air, outbreak and forecast data is for this area). */
const DEMO_AREA: Coordinates & { name: string } = { lat: 12.9352, lng: 77.6245, name: 'Koramangala, Bengaluru' };

type Place = { coords: Coordinates; label: string };
type LocateState = { phase: 'locating' } | { phase: 'ready'; place: Place } | { phase: 'blocked'; reason: 'denied' | 'unavailable' };

const MATCH_LABEL: Record<NearbyPlace['match'], { label: string; tone: 'good' | 'info' | 'neutral' }> = {
  specialty: { label: 'Specialist', tone: 'good' },
  hospital: { label: 'Hospital', tone: 'info' },
  general: { label: 'Clinic', tone: 'neutral' },
  other: { label: 'Other specialty', tone: 'neutral' },
};

function open(url: string) {
  if (Platform.OS === 'web') globalThis.open?.(url, '_blank', 'noopener');
  else void Linking.openURL(url);
}

export default function DoctorsScreen() {
  const params = useLocalSearchParams<{ specialty?: string }>();
  // A link can carry an empty value; fall back to a general physician.
  const specialty = params.specialty?.trim() || 'General physician';
  return <DoctorsBody key={specialty} initialSpecialty={specialty} />;
}

function DoctorsBody({ initialSpecialty }: { initialSpecialty: string }) {
  const { width } = useWindowDimensions();
  const wide = width >= breakpoint.wide;
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { forecast } = useSession();
  const [specialty, setSpecialty] = useState(initialSpecialty);
  const [locate, setLocate] = useState<LocateState>({ phase: 'locating' });
  const [result, setResult] = useState<{ key: string; data: NearbyDoctors | null; error: string | null } | null>(null);

  useEffect(() => {
    let alive = true;
    currentCoordinates().then((coords) => {
      if (!alive) return;
      if (typeof coords === 'string') setLocate({ phase: 'blocked', reason: coords });
      else setLocate({ phase: 'ready', place: { coords, label: 'your location' } });
    });
    return () => {
      alive = false;
    };
  }, []);

  const place = locate.phase === 'ready' ? locate.place : null;
  const searchKey = place ? `${place.coords.lat.toFixed(4)},${place.coords.lng.toFixed(4)}|${specialty}` : null;

  useEffect(() => {
    if (!place || !searchKey) return;
    let alive = true;
    api
      .nearbyDoctors(place.coords.lat, place.coords.lng, specialty)
      .then((data) => alive && setResult({ key: searchKey, data, error: null }))
      .catch((e: unknown) => alive && setResult({ key: searchKey, data: null, error: e instanceof Error ? e.message : 'Search failed' }));
    return () => {
      alive = false;
    };
  }, [place, searchKey, specialty]);

  const current = result && result.key === searchKey ? result : null;
  const searching = !!place && !current;
  const googleNearMe = `https://www.google.com/maps/search/${encodeURIComponent(`${specialty.toLowerCase()} near me`)}`;
  const isDemo = forecast?.data_mode === 'demo';

  return (
    <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: wide ? 24 : insets.top + 16, paddingBottom: wide ? 32 : 120 }}>
      <View style={{ width: '100%', maxWidth: 980, alignSelf: 'center', gap: 16 }}>
        <View style={styles.titleRow}>
          <IconButton label="Back" onPress={() => (router.canGoBack() ? router.back() : router.navigate('/ask'))}>
            <ArrowLeft size={18} color={color.ink} />
          </IconButton>
          <View style={{ flex: 1 }}>
            <Text variant="hero" style={{ fontSize: wide ? 30 : 24, lineHeight: wide ? 36 : 30 }}>
              Doctors near you
            </Text>
            <Text variant="body">
              {place ? `Within 5 km of ${place.label}` : 'Hospitals and clinics around you, closest first'}
            </Text>
          </View>
        </View>

        <View style={styles.chips}>
          {[...new Set([specialty, ...QUICK_SPECIALTIES])].map((s) => (
            <Chip key={s} label={s} selected={s === specialty} onPress={() => setSpecialty(s)} />
          ))}
        </View>

        <Card style={styles.emergency}>
          <Siren size={18} color={color.risk} />
          <Text variant="body" style={{ flex: 1, color: color.ink }}>
            Chest pain with sweating, fainting, trouble breathing or sudden weakness: don’t search, call <Text style={{ fontFamily: font.bold }}>112</Text>.
          </Text>
          <Button label="Call 112" compact kind="secondary" onPress={() => open('tel:112')} />
        </Card>

        {locate.phase === 'locating' && <Busy text="Finding your location…" />}

        {locate.phase === 'blocked' && (
          <Card style={{ gap: 12 }}>
            <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
              <LocateFixed size={18} color={color.navy} />
              <Text variant="heading" style={{ flex: 1 }}>
                {locate.reason === 'denied' ? 'Location is off' : 'Couldn’t get your location'}
              </Text>
            </View>
            <Text variant="body">
              {locate.reason === 'denied'
                ? 'Allow location for VitaSense to list doctors around you. Or search Google Maps directly.'
                : 'Your device didn’t share a location. You can search Google Maps directly.'}
            </Text>
            <View style={styles.actions}>
              <Button label={`Search “${specialty.toLowerCase()} near me”`} icon={<ExternalLink size={15} color="#FFFFFF" />} compact onPress={() => open(googleNearMe)} />
              {isDemo && (
                <Button
                  label={`Use demo area (${DEMO_AREA.name})`}
                  kind="secondary"
                  compact
                  onPress={() => setLocate({ phase: 'ready', place: { coords: DEMO_AREA, label: `${DEMO_AREA.name} (demo profile area)` } })}
                />
              )}
            </View>
          </Card>
        )}

        {searching && <Busy text={`Looking for ${specialty.toLowerCase()}s, hospitals and clinics nearby…`} />}

        {current?.error && (
          <Card style={{ gap: 10 }}>
            <Text variant="body">{current.error}</Text>
            <Button label="Search on Google Maps instead" compact style={{ alignSelf: 'flex-start' }} onPress={() => open(googleNearMe)} />
          </Card>
        )}

        {current?.data && (
          <>
            <Card style={styles.googleCard}>
              <MapPin size={18} color={color.navy} />
              <View style={{ flex: 1 }}>
                <Text variant="bodyStrong">See every {current.data.specialty.toLowerCase()} on Google Maps</Text>
                <Text variant="small">Ratings, reviews and opening hours from Google.</Text>
              </View>
              <Button label="Open Maps" kind="soft" compact onPress={() => open(current.data!.maps_search_url)} />
            </Card>

            {current.data.results.length === 0 ? (
              <Card>
                <Text variant="body">Nothing listed within {current.data.radius_km} km. Try Google Maps above.</Text>
              </Card>
            ) : (
              <View style={[styles.list, wide && { flexDirection: 'row', flexWrap: 'wrap' }]}>
                {current.data.results.map((p) => (
                  <PlaceCard key={p.id} place={p} wide={wide} />
                ))}
              </View>
            )}

            <Card style={styles.reportNudge}>
              <FileText size={18} color={color.navy} />
              <Text variant="body" style={{ flex: 1, color: color.ink }}>
                Take a one-page summary of your symptoms, lifestyle, history and medicines to the appointment.
              </Text>
              <Button
                label="Prepare report"
                compact
                onPress={() => router.navigate({ pathname: '/report', params: { specialty: current.data!.specialty } })}
              />
            </Card>
            <Text variant="small" style={{ textAlign: 'center' }}>
              Listings from {current.data.source === 'google' ? 'Google' : 'OpenStreetMap'}. Call ahead to confirm the doctor is in.
            </Text>
          </>
        )}
      </View>
    </ScrollView>
  );
}

function Busy({ text }: { text: string }) {
  return (
    <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <ActivityIndicator color={color.navy} />
      <Text variant="body">{text}</Text>
    </Card>
  );
}

function PlaceCard({ place: p, wide }: { place: NearbyPlace; wide: boolean }) {
  const match = MATCH_LABEL[p.match];
  return (
    <Card style={[styles.place, wide && { width: '49%' as const }]}>
      <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
        <View style={{ flex: 1, gap: 3 }}>
          <Text variant="heading">{p.name}</Text>
          <Text variant="small">
            {[p.kind, `${p.distance_km < 1 ? `${Math.round(p.distance_km * 1000)} m` : `${p.distance_km.toFixed(1)} km`} away`].join(' · ')}
          </Text>
        </View>
        <Badge label={match.label} tone={match.tone} />
      </View>
      {!!p.address && <Text variant="body" style={{ fontSize: 13 }}>{p.address}</Text>}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {p.rating != null && (
          <View style={styles.meta}>
            <Star size={12} color={color.watch} fill={color.watch} />
            <Text variant="small" style={{ color: color.ink }}>
              {p.rating.toFixed(1)}
              {p.rating_count ? ` (${p.rating_count})` : ''}
            </Text>
          </View>
        )}
        {p.open_now != null && <Badge label={p.open_now ? 'Open now' : 'Closed now'} tone={p.open_now ? 'good' : 'neutral'} />}
        {p.emergency && <Badge label="Emergency" tone="risk" />}
        {!!p.speciality && (
          <Text variant="small" numberOfLines={1} style={{ flexShrink: 1 }}>
            {p.speciality}
          </Text>
        )}
      </View>
      <View style={styles.actions}>
        <Button label="Directions" compact icon={<Navigation size={14} color="#FFFFFF" />} onPress={() => open(p.directions_url)} />
        {!!p.phone && (
          <Button label="Call" compact kind="secondary" icon={<Phone size={14} color={color.ink} />} onPress={() => open(`tel:${p.phone!.replace(/\s/g, '')}`)} />
        )}
        <Button label="Maps" compact kind="ghost" onPress={() => open(p.maps_url)} />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  emergency: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: color.riskSoft, borderColor: '#F6B9BB' },
  googleCard: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  reportNudge: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: color.skySoft, borderColor: color.skySoft, flexWrap: 'wrap' },
  list: { gap: 12, justifyContent: 'space-between' },
  place: { gap: 10 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
