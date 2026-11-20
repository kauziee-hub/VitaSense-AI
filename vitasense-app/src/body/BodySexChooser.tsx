import { Pressable, StyleSheet, Text as RNText, View } from 'react-native';

import type { BiologicalSex } from '@/lib/api';
import { color, font, radius } from '@/theme/tokens';

const OPTIONS: { value: BiologicalSex; label: string }[] = [
  { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' },
];

/** Two-option pill switch for the body render (and the AI's context). */
export function BodySexChooser({
  value,
  onChange,
  dark = false,
}: {
  value: BiologicalSex | null | undefined;
  onChange: (sex: BiologicalSex) => void;
  dark?: boolean;
}) {
  return (
    <View style={[styles.track, dark && { backgroundColor: 'rgba(255,255,255,0.12)' }]} accessibilityRole="radiogroup">
      {OPTIONS.map((option) => {
        const active = value === option.value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityState={{ checked: active }}
            accessibilityLabel={`${option.label} body`}
            onPress={() => onChange(option.value)}
            style={[styles.option, active && (dark ? styles.activeDark : styles.active)]}>
            <RNText style={[styles.label, dark && { color: 'rgba(255,255,255,0.75)' }, active && { color: dark ? color.ink : '#FFFFFF' }]}>
              {option.label}
            </RNText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: { flexDirection: 'row', padding: 4, gap: 4, borderRadius: radius.pill, backgroundColor: color.surfaceSunken },
  option: { flex: 1, height: 36, paddingHorizontal: 16, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  active: { backgroundColor: color.ink },
  activeDark: { backgroundColor: '#FFFFFF' },
  label: { fontFamily: font.semibold, fontSize: 13.5, color: color.inkSoft },
});
