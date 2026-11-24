# Fire Wisp Roadmap

Public roadmap for the **Fire Wisp** Nostr ecosystem (Web/PWA, Android APK, and dedicated anti-spam PoW relay).

---

## Live Today (v1.x)

- **Fire Wisp Web & PWA** (`https://firewisp.rtard.de/`)
  - Sovereign auth (NIP-07, NIP-46 Bunker, NIP-49 encrypted vault, NIP-06 mnemonic, watch-only).
  - NIP-65 (`kind: 10002`) relay sync + BUD-03 (`kind: 10063`) Blossom server sync + sidebar server selector.
  - NIP-13 background Web Worker PoW mining + anti-spam feed heuristics.
  - NIP-53 Live Streaming: cinema mode, live chat with Blossom drag/drop/paste & custom emojis, muted hover-to-preview, draggable Picture-in-Picture mini-player with compact live chat, follow + NIP-45 follower-count ranking, zero-leak freshness/tombstone hardening.
  - Inline YouTube (`youtube-nocookie.com`) & livestream playback toggle, Note Composer Preview, full uncropped images + lightbox, parent post previews on replies, Android Web Share Target PWA support.
- **Fire Wisp Android** (`de.rtard.wisp`, `v1.3.0-fork.2`, C1-verified on [Zapstore](https://zapstore.dev/apps/de.rtard.wisp) & `https://app.firewisp.rtard.de/`)
  - Built-in fail-closed Tor (`kmp-tor`), Amber NIP-55, NIP-49/NIP-06 auth, Android Share Target (`ACTION_SEND` / `ACTION_SEND_MULTIPLE`), NIP-17 encrypted DMs, NWC/Spark Lightning zaps.
- **Anti-Spam PoW Relay** (`wss://firewisp.relay.rtard.de`) & Nostr Git (`ngit` / `gitworkshop.dev`).

---

## Full Release Milestone — `firewisp.de` Domain Migration

Register and cut over to **`firewisp.de`** as the primary canonical domain for the full release while keeping `*.firewisp.rtard.de` alive as redirects/aliases so existing users never break:

- [x] Register **`firewisp.de`** at Netcup (ordered — awaiting activation) and configure DNS (A/AAAA records pointing to `ecoblu` `178.254.39.208`).
- [ ] **Web / PWA (`https://firewisp.de`)**:
  - Issue Caddy TLS certificate and serve Fire Wisp Web at `https://firewisp.de/`.
  - Add 301 redirect from `https://firewisp.rtard.de/*` → `https://firewisp.de/*` (note: migrating origin resets `localStorage` unless a one-time export/import helper or notice is provided for NIP-49 vaults & settings!).
  - Update `manifest.webmanifest`, `robots.txt`, `sitemap.xml`, OG meta tags, `Share` links, and `ngit` repository web URL.
- [ ] **Android distribution (`https://app.firewisp.de`)**:
  - Mirror APK download portal + SHA-256 checksums + release notes at `https://app.firewisp.de/`, with redirect from `https://app.firewisp.rtard.de/`.
  - Keep Android `applicationId` (`de.rtard.wisp`) and release signing key unchanged so **Zapstore C1** updates remain seamless for existing installs.
- [ ] **Dedicated Relay (`wss://relay.firewisp.de`)**:
  - Serve `firewisp-strfry` on **both** `wss://relay.firewisp.de` and legacy `wss://firewisp.relay.rtard.de` simultaneously so older Android/web clients stay connected with zero disruption.
  - Update default `FIREWISP_RELAY` constant in Web and Android builds.
- [ ] **Brand NIP-05 & Official Identity**:
  - Host `/.well-known/nostr.json` on `firewisp.de` (e.g., `_@firewisp.de` / `wisp@firewisp.de`) with CORS enabled.

---

## Upcoming Features & Enhancements

### Android
- [ ] **Citrine local relay support**: allow connecting Fire Wisp Android cleanly to a local Citrine relay (`ws://127.0.0.1:4869`) alongside Tor/VPN routing.
- [ ] Align mobile/Android UX improvements with Web (reply parent context previews, live stream hover/mini-player parity where applicable).

### Web / PWA
- [ ] **NIP-51 Mute List sync (write)**: publish/sync `kind: 10000` mute list updates when blocking/unblocking users so blocks follow you across Fire Wisp Web and Android.
- [ ] **Optional privacy HLS liveness probe** (paused): opt-in client/proxy stream probe for filtering dead streams that never emitted an `ended` event.
- [ ] **Domain migration helper**: one-click encrypted settings/vault export & import when moving from `firewisp.rtard.de` → `firewisp.de`.
- [ ] **Bundle code-splitting**: lazy-load route chunks to keep initial JS payload lean as features grow.
