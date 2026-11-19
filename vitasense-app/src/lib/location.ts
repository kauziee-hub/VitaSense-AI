import * as Location from 'expo-location';

export type Coordinates = { lat: number; lng: number };

/** Current position, or a reason it isn't available. Uses a recent cached fix when there is one. */
export async function currentCoordinates(): Promise<Coordinates | 'denied' | 'unavailable'> {
  try {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) return 'denied';
    const recent = await Location.getLastKnownPositionAsync({ maxAge: 10 * 60 * 1000 }).catch(() => null);
    const position = recent ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
    return { lat: position.coords.latitude, lng: position.coords.longitude };
  } catch {
    return 'unavailable';
  }
}
