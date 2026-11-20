# VitaSense app (Android, iPhone and web)

One Expo codebase for the phone apps and the website. The website is the web build of this app:
a product landing page for visitors (`/welcome`) and the full dashboard once signed in.

It talks to the FastAPI server in the parent folder (`../main.py`, port 8888).

## Run it

Start the server first (from the parent folder): `python -m uvicorn main:app --port 8888`.

```bash
npm install
npm run web                 # website at http://localhost:8081
npm run android             # builds the Android development app, installs it on the emulator/phone, starts Metro
npm start                   # Metro only, for a development app that is already installed
```

The app uses the **VitaSense development build**, not Expo Go: Health Connect, the Keystore and
the calendar reader are native code that Expo Go does not contain.

### Which server the app talks to

`EXPO_PUBLIC_API_URL` in `vitasense-app/.env` always wins. Without it:

| Where the app runs | Server it uses |
|--------------------|----------------|
| Website | `http://127.0.0.1:8888` |
| Android emulator | the computer, through `10.0.2.2:8888` (works with the server on 127.0.0.1) |
| Phone on USB | run `npm run phone:usb` once per connection; the phone's `127.0.0.1:8888` then reaches the computer |
| Phone on Wi-Fi | the computer that serves Metro. Start the server with `--host 0.0.0.0` and allow Python through the firewall. This exposes the API to your network, so only do it on a network you trust |

The app tries these in parallel at start-up and keeps the first that answers (`src/lib/server.ts`).
Release builds must set `EXPO_PUBLIC_API_URL` to the hosted HTTPS server.

Before shipping a change: `npm run typecheck` and `npm run lint`.

## Screens

| Route | What it does |
|-------|--------------|
| `/welcome` | Website landing page (desktop) / onboarding (phone), profile picker |
| `/` | Dashboard: glass body figure, body systems, readiness, markers, care plan |
| `/ask` | Chat that explains likely causes from the user's data and names the doctor to see |
| `/checkin` | Three-tap daily check-in; shows which data is collected automatically |
| `/records` | Scan or upload reports and prescriptions, lab results, today's medicines |
| `/report` | One-page doctor visit report (print / PDF / share) |
| `/doctors` | Doctors and hospitals nearby for a specialty |
| `/profile` | Connected data (switch sources on/off), what was picked up, privacy |

## Automatic data collection

Switched on per source in **Profile → Connected data**. Nothing is collected before that, and
turning a source off deletes what was collected from it. Sync runs when the app opens, when it
returns to the foreground (`src/collect/useAutoSync.ts`), and in the background about every 30
minutes on Android and iPhone (`src/collect/background.ts`, expo-background-task). Each source
syncs at most every 30 minutes to 6 hours.

| Source | Where it works | What it fills in |
|--------|----------------|------------------|
| Health Connect | Android build | Sleep, steps, distance, floors, workouts, calories, heart rate, resting HR, HRV, SpO₂, breathing rate, body temperature, blood pressure, blood sugar, weight, body fat, VO₂ max, food energy, water, menstrual cycle. Covers Samsung, Fitbit, Mi Fitness, Zepp, Garmin, Google Fit and any BP cuff / glucometer / scale app that writes there |
| Fitness band (Bluetooth) | Android build | Live heart rate from bands, watches and chest straps that broadcast the standard heart-rate profile; daily average + resting estimate |
| Phone usage | Android build | Screen time, minutes after midnight, unlocks, and a sleep estimate from the longest overnight screen-off stretch (never overwrites a wearable's sleep) |
| Delivery app alerts | Android build | Orders from Swiggy, Zomato, Blinkit, Zepto, BigBasket, JioMart, EatSure, Domino's, 1mg, PharmEasy, Netmeds, Apollo 24\|7, Practo notifications. Every other app is ignored |
| Location | Web, Android, iPhone | Weather, 7 air pollutants, pollen, UV, daylight → air, heat, cold, water-borne, mosquito-borne (Aedes, Anopheles, Culex), respiratory and food-spoilage risk; WHO outbreak notices for the country. Only the area name is stored |
| Gmail | Web, Android, iPhone | Food, grocery and pharmacy orders, lab report PDFs, tickets. Needs Google OAuth client IDs (below) |
| Calendar | Android, iPhone | Daily load, late or early events, travel, exams. Counts only; titles never leave the phone |
| Records | Web, Android, iPhone | Lab reports and prescriptions you photograph or upload |
| Apple Health | Not yet | Shown as "coming next" in the app |

Phone usage, delivery alerts and the band come from the local native module
`modules/vitasense-device` (Kotlin, Android only). Usage access and notification access are
granted by the user in Android settings; the app opens the right page and switches the source on
when they come back. To test delivery alerts on a debug build, grant access and post one from adb:

```bash
adb shell cmd notification allow_listener ai.vitasense.app/expo.modules.vitasensedevice.OrderAlertListener
```

```bash
adb shell cmd notification post -S bigtext -t "Swiggy" test1 "Your order of Chicken Biryani from Meghana Foods has been delivered"
```

**Health factors** (`/factors`): every factor that can affect health (70, in 9 groups), what
VitaSense knows about each, from which source, and one tap to connect what's missing. The
catalogue lives in the backend (`collect/factors.py`).

### Google sign-in for Gmail

1. In Google Cloud Console create a project, enable the **Gmail API**, and configure the OAuth
   consent screen with the scope `https://www.googleapis.com/auth/gmail.readonly`.
   Gmail read access is a *restricted* scope: up to 100 test users work right away; a public
   release needs Google's verification and security assessment.
2. Create OAuth client IDs: **Web** (authorised origin `http://localhost:8081` and your site),
   **Android** (package `ai.vitasense.app` + your signing SHA-1) and **iOS** (bundle `ai.vitasense.app`).
3. Put them in `vitasense-app/.env`:

```bash
EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=...apps.googleusercontent.com
EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID=...apps.googleusercontent.com
EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=...apps.googleusercontent.com
```

Without them the Gmail row explains that setup is needed instead of showing a broken button.

### Android development build

Two ways to get the development app:

- **On this computer** (needs Android Studio, which brings the SDK, JDK and emulator):
  `npm run android`. The first build takes 10–20 minutes; later ones are quick.
- **In the cloud** with EAS (needs a free Expo account, `npx eas-cli@latest login`):
  `npm run build:android:dev`, then install the APK from the link on any Android phone.

Build profiles are in `eas.json`: `development` (debug APK with the dev menu), `preview`
(release APK to share for testing) and `production` (Play Store bundle).

What the Android app asks for, and nothing more (`app.json`):

- Health Connect read access: sleep, steps, distance, workouts, calories, heart rate, resting
  heart rate, HRV, SpO₂, breathing rate, weight, hydration. It never writes health data.
- Calendar read (write is blocked), location while the app is open, camera for scanning records,
  notifications for medicine reminders.
- Blocked: microphone, calendar write, shared-storage write, drawing over other apps.
- Android backup is off, so health data and the Gmail token never go to cloud backups. The Gmail
  token lives in the Android Keystore / iOS Keychain (`expo-secure-store`).

Health Connect is built into Android 14 and newer. On Android 8–13 the user installs the Health
Connect app from the Play Store; VitaSense links to it when it is missing.
Publishing on Google Play also needs the Health Connect declaration and a privacy policy in the
Play Console.

## Brand assets

- Logo component: `src/shell/Logo.tsx` (mark + two-tone wordmark).
- App icons, adaptive icons, splash and favicon are generated from the same drawing:
  `python scripts/generate-icons.py assets` (needs Google Chrome; renders with `scripts/render-html.mjs`).
- The body and organ art are porcelain 3D renders generated with Higgsfield (sources in `art-source/`).
  `python scripts/build-art.py` trims them and writes the compact WebP files in `assets/art/` that the app bundles.
  Organ positions on the body (hotspots and glows) are in `src/body/art.ts`; the interactive body is `src/body/BodyMap.tsx`.

## Build for release

Live: website https://vitasense-ai-app.vercel.app, API https://vitasense-api.vercel.app.

Every release build needs the hosted API address: `EXPO_PUBLIC_API_URL=https://vitasense-api.vercel.app`
(plus the Google client IDs once Gmail sign-in is set up).

**Android APK (the website's download):**

```bash
npx expo prebuild --platform android --clean
cd android
EXPO_PUBLIC_API_URL=https://vitasense-api.vercel.app ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a,armeabi-v7a,x86_64
```

The APK lands in `android/app/build/outputs/apk/release/app-release.apk`. It is signed with the template's debug key,
which is fine for installing directly; for Google Play build with EAS (`npm run build:android`), which creates and keeps
a proper upload key.

**Website** (Vercel project `vitasense`, linked from `dist/.vercel`):

```bash
EXPO_PUBLIC_API_URL=https://vitasense-api.vercel.app npm run deploy:web
```

`scripts/export-web.mjs` exports the site, moves `assets/node_modules` to `assets/vendor` (Vercel never uploads folders
named node_modules, so fonts would go missing), copies the release APK to `/downloads/VitaSense.apk`, and deploys.
`public/vercel.json` adds the single-page-app rewrite and the APK download headers.

**Cloud builds with EAS** (needs `npx eas-cli@latest login`):

```bash
npm run build:android           # Play Store bundle
npm run build:ios               # App Store build (needs an Apple developer account)
```
