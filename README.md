# Inkfall

An on-rails ink-painting shooter. See `GAME_DESIGN.md` for design, `TECH_SPEC.md` for architecture.

## Run

```
npm install
npm run dev
```

## Build

```
npm run build
```

Output is written to `dist/`, deployable to any static host (Vercel zero-config Vite detection applies).

## Verify

```
npm run verify
```

Runs typecheck, lint, unit tests, and a production build — the gate for every task in `TASKS.md`.

## Balance harness

```
npm run sim -- --runs 2000 --strategy mixed --upgrades 0 --seed 12345
```

Writes `BALANCE_REPORT.md`. See `TECH_SPEC.md` §6.

## Performance

```
npm run perf
```

Writes `PERF.md`. See `TECH_SPEC.md` §8.

## Android

The `/android` directory is a committed Capacitor project wrapping the built `dist/`.

```
npm run build
npx cap sync android
cd android
./gradlew assembleDebug
```

The debug APK lands at `android/app/build/outputs/apk/debug/app-debug.apk`.

**Build status: unverified in this repo's own development environment.** That environment has
no Android SDK installed and its network policy blocks `dl.google.com` (Google's Maven repo,
needed to resolve the Android Gradle Plugin) — `./gradlew assembleDebug` fails at the dependency
-resolution step there with `403 Forbidden`, before any actual compilation happens. Per
`TECH_SPEC.md` §11's own instruction for this case, the full `/android` project and this
documentation are still generated and committed rather than blocked on it; the app itself
(zero native permissions, portrait-locked, generated launcher icons, back-button and haptics
wired through Capacitor) has not been built or run on a real device or emulator. Building it
needs a machine with the Android SDK (`ANDROID_HOME` set, `platforms;android-35` and
`build-tools` installed) and unrestricted network access for the first Gradle sync.

**Release build** (not executed — documented for whoever runs it): generate a keystore once with
`keytool -genkey -v -keystore inkfall-release.keystore -alias inkfall -keyalg RSA -keysize 2048 -validity 10000`,
configure signing in `android/app/build.gradle`, then `./gradlew assembleRelease`. The release APK
lands at `android/app/build/outputs/apk/release/app-release.apk`.
