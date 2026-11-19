#!/usr/bin/env node
/**
 * Lets an Android phone plugged in over USB reach this computer's VitaSense server and Metro
 * without opening them to the network: forwards the phone's 127.0.0.1:8888 and :8081 to this computer.
 *
 *   npm run phone:usb
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const PORTS = [8888, 8081];
const exe = process.platform === 'win32' ? 'adb.exe' : 'adb';

function findAdb() {
  const roots = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Android', 'Sdk'),
    join(homedir(), 'Library', 'Android', 'sdk'),
    join(homedir(), 'Android', 'Sdk'),
  ].filter(Boolean);
  for (const root of roots) {
    const candidate = join(root, 'platform-tools', exe);
    if (existsSync(candidate)) return candidate;
  }
  return 'adb';
}

const adb = findAdb();
let output;
try {
  output = execFileSync(adb, ['devices'], { encoding: 'utf8' });
} catch {
  console.error('adb was not found. Install Android Studio (or the platform tools) or set ANDROID_HOME.');
  process.exit(1);
}

const devices = output
  .split('\n')
  .slice(1)
  .map((line) => line.trim().split(/\s+/))
  .filter(([serial, state]) => serial && state === 'device')
  .map(([serial]) => serial);

if (devices.length === 0) {
  console.error('No phone found. Plug it in, turn on USB debugging and accept the prompt on the phone.');
  process.exit(1);
}

for (const serial of devices) {
  for (const port of PORTS) {
    execFileSync(adb, ['-s', serial, 'reverse', `tcp:${port}`, `tcp:${port}`]);
  }
  console.log(`${serial}: server (8888) and Metro (8081) forwarded`);
}
