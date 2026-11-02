# Moonfold for Android

A small native app: splash, QR scan, and a full-screen view of the Moonfold running on your own
computer. There is no account and nothing is stored on any service. See
[docs/internals/mobile.md](../../docs/internals/mobile.md) for how the connection works.

## Build

Needs JDK 17 or later and the Android SDK (`local.properties` or `ANDROID_HOME`).

```bash
./gradlew :app:testDebugUnitTest :app:assembleDebug
```

A release build signs with a key kept outside this repository:

```bash
MOONFOLD_ANDROID_KEYSTORE=/path/to/moonfold-android.jks \
MOONFOLD_ANDROID_KEY_ALIAS=moonfold \
MOONFOLD_ANDROID_KEYSTORE_PASSWORD=... \
./gradlew :app:assembleRelease
```

`apps/mobile` is a Gradle project, so it is not part of the pnpm workspace. Its launcher icons and
in-app mark come from `node scripts/render-brand-icons.ts`.
