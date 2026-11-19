#!/usr/bin/env node
/**
 * Builds the website into dist/ for static hosting.
 *
 *   npm run build:web                 # export only
 *   npm run deploy:web                # export, then `vercel deploy --prod` from dist/
 *
 * - Expo puts fonts and router images under dist/assets/node_modules/. Hosts such as Vercel never
 *   upload folders named node_modules, so they are moved to dist/assets/vendor/ and every
 *   reference in the bundle is rewritten.
 * - The Android release APK (android/app/build/outputs/apk/release/app-release.apk, or ANDROID_APK)
 *   is copied to dist/downloads/VitaSense.apk, where the website's download buttons point.
 * - The Vercel project link lives in .vercel/ (gitignored) and is copied into dist/ for the deploy, because
 *   `expo export` empties dist/ on every run.
 */
import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const DIST = 'dist';
const deploy = process.argv.includes('--deploy');

rmSync(DIST, { recursive: true, force: true });

execSync('npx expo export --platform web --output-dir dist', { stdio: 'inherit', env: process.env });

const from = join(DIST, 'assets', 'node_modules');
const to = join(DIST, 'assets', 'vendor');
if (existsSync(from)) {
  renameSync(from, to);
  let rewritten = 0;
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) {
        if (entry !== '.vercel') walk(path);
      } else if (/\.(js|html|css|json|map)$/.test(entry)) {
        const text = readFileSync(path, 'utf8');
        if (text.includes('/assets/node_modules/')) {
          writeFileSync(path, text.replaceAll('/assets/node_modules/', '/assets/vendor/'));
          rewritten += 1;
        }
      }
    }
  };
  walk(DIST);
  console.log(`moved assets/node_modules -> assets/vendor (${rewritten} files rewritten)`);
}

const apk = process.env.ANDROID_APK ?? join('android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk');
if (existsSync(apk)) {
  mkdirSync(join(DIST, 'downloads'), { recursive: true });
  cpSync(apk, join(DIST, 'downloads', 'VitaSense.apk'));
  console.log(`added downloads/VitaSense.apk (${(statSync(apk).size / 1048576).toFixed(1)} MB)`);
} else {
  console.warn(`no APK at ${apk}: the website's download button will 404 until one is added`);
}

if (deploy) {
  if (!existsSync(join('.vercel', 'project.json'))) {
    console.error('No Vercel link in .vercel/. Run `vercel link --project vitasense` in vitasense-app first.');
    process.exit(1);
  }
  cpSync('.vercel', join(DIST, '.vercel'), { recursive: true });
  execSync('vercel deploy --prod --yes', { cwd: DIST, stdio: 'inherit' });
}
