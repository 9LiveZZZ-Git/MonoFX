# Tenebrae Writer — native wrap (Capacitor)

**Status: written, not built.** This container has no macOS, no Xcode and no Apple
developer account, so the iOS half of v1.5 could not be produced or tested here.
Everything below is the build path, not a build. Treat the commands as a recipe
to run on a Mac, and expect to correct small things the first time.

## What the wrap is actually for

The app already runs on a phone: it is one self-contained HTML file, it stores
everything in IndexedDB, and it works with the network off. Wrapping it buys
three things a file-on-disk cannot have:

- **Survival.** Safari evicts IndexedDB for ordinary web content under storage
  pressure. A packaged app's storage is not swept the same way. This is the
  reason to do it — everything else is polish.
- **A native share sheet**, so exports land in Files, Books, or a mail draft
  instead of the browser's download tray.
- **A home-screen identity** — icon, splash, no browser chrome, and a route to
  the App Store if you ever want one.

Nothing about the manuscript format, the codex, or the exports changes.

## Build

```bash
# on a Mac, with Xcode and CocoaPods installed
mkdir tenebrae-app && cd tenebrae-app
npm init -y
npm i @capacitor/core @capacitor/cli @capacitor/ios @capacitor/share @capacitor/filesystem

mkdir www
cp ../MonoFX/tenebrae/step1.html www/index.html   # the whole app is this one file

npx cap init "Tenebrae Writer" com.yourname.tenebrae --web-dir=www
cp ../MonoFX/tenebrae/native/capacitor.config.json ./capacitor.config.json
npx cap add ios
npx cap sync ios
npx cap open ios          # builds and runs from Xcode
```

`www/index.html` is a copy, so re-copy it whenever `step1.html` changes and run
`npx cap sync ios` again. Keep `step1.html` the single source — do not start
editing the copy.

## Two things to change once it runs

1. **Ask for persistent storage.** The app already calls
   `navigator.storage.persist()` at boot; inside a packaged app that request is
   granted rather than heuristically denied. Verify it returns `true` on a real
   device before trusting the wrap to have solved eviction.

2. **Route exports through the native share sheet.** `download()` in
   `step1.html` creates a blob URL and clicks an anchor, which inside a WKWebView
   drops the file somewhere unhelpful. Detect Capacitor and hand off instead:

   ```js
   // in download(), before the anchor path
   if (window.Capacitor?.isNativePlatform?.()) {
     const { Filesystem, Directory } = window.Capacitor.Plugins;
     const { Share } = window.Capacitor.Plugins;
     // write to Cache, then share the returned URI
   }
   ```

   Left unwritten on purpose: it needs a device to test, and a plugin call
   written blind is worse than none.

## App Store, when you get there

- Bundle ID must match `appId` in `capacitor.config.json`.
- The app makes no network requests until the author supplies their own
  Anthropic API key, and none at all without one. If you enable Claude assist,
  the privacy questionnaire needs to say that scene text is sent to Anthropic
  at the user's request, that the key is stored on device, and that you collect
  nothing.
- There is no account, no analytics, no tracking to declare.
