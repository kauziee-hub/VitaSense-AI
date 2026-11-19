import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

export interface PickedFile {
  name: string;
  mimeType: string;
  uri: string;
  /** Present on web: the browser File object. */
  file?: File;
}

const ACCEPTED = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

/** Choose a PDF or photo from files. Returns null if the user cancels. */
export async function pickFromFiles(): Promise<PickedFile | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: ACCEPTED, copyToCacheDirectory: true, multiple: false });
  if (result.canceled || !result.assets?.length) return null;
  const asset = result.assets[0];
  return {
    name: asset.name,
    mimeType: asset.mimeType ?? guessMime(asset.name),
    uri: asset.uri,
    file: asset.file,
  };
}

/** Photograph a report or prescription with the camera. Returns null if cancelled or not allowed. */
export async function takePhoto(): Promise<PickedFile | null | 'denied'> {
  if (Platform.OS !== 'web') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return 'denied';
  }
  const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.85, allowsEditing: false });
  if (result.canceled || !result.assets?.length) return null;
  const asset = result.assets[0];
  const name = asset.fileName ?? `scan-${Date.now()}.jpg`;
  return { name, mimeType: asset.mimeType ?? 'image/jpeg', uri: asset.uri, file: asset.file };
}

export function toFormData(picked: PickedFile): FormData {
  const form = new FormData();
  if (picked.file) {
    form.append('file', picked.file, picked.name);
  } else {
    // React Native's FormData streams the file from its uri.
    form.append('file', { uri: picked.uri, name: picked.name, type: picked.mimeType } as unknown as Blob);
  }
  return form;
}

function guessMime(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase();
  if (ext === 'pdf') return 'application/pdf';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'heic' || ext === 'heif') return 'image/heic';
  return 'image/jpeg';
}
