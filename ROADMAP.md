# Fire Wisp Roadmap

Public roadmap for the **Fire Wisp** Nostr ecosystem (Web/PWA, Android APK, PoW relay, Blossom media, and GRASP Git).

---

## Live Today (`v1.x`)

- **Fire Wisp Web & PWA** (`https://firewisp.de/`)
  - Sovereign auth (NIP-07 browser extension, NIP-46 Bunker, NIP-49 encrypted vault, NIP-06 mnemonic, watch-only).
  - Persistent 2-hop Web of Trust engine (`wot.ts`) with app-wide WoT filters, mutual vouch badges, JSON snapshot export/import, and opt-in NIP-85 Trusted Assertions (`kind: 30382`).
  - Modular **For You** feed (Follows + 2-hop WoT with toggles for WoT Zaps, Trending, and Topics), plus optional **Zapped** posts feed.
  - Full **NIP-51 Lists** (`kind: 30000` people, `30002` relays, `30003` bookmarks, `30015` interests, `10000` encrypted mute lists) with mute-list auto-hide and feed dropdown toggles.
  - **Backup, Export (`.jsonl`) & Relay Sync** — verifiable `.jsonl` archive export/import, media URL index export (`.txt`), 1-click relay mirroring (including local Citrine/Haven/Nostr Vault `ws://127.0.0.1`), and replaceable list recovery.
  - Field-preserving **Edit Profile (`kind: 0`)** modal with Blossom uploads, **Avatar Hover Profile Preview** pane, and **Zap the Developer** in Settings.
  - NIP-53 Live Streaming (cinema mode, Blossom live chat, muted hover-to-preview, PiP mini-player, Global Audio equalizer, `song.link` & privacy YouTube embeds) + NIP-13 Web Worker PoW mining + route code-splitting.
- **Fire Wisp Android** (`de.rtard.wisp`, `v1.3.0-fork.3`, C1-verified on [Zapstore](https://zapstore.dev/apps/de.rtard.wisp) & `https://app.firewisp.de/`)
  - Built-in fail-closed Tor (`kmp-tor`), Amber NIP-55, Citrine local relay support, NIP-49/NIP-06 auth, Android Share Target, NIP-17 encrypted DMs, NWC/Spark Lightning zaps.
- **Self-Hosted Sovereign Infrastructure (`firewisp.de`)**
  - **NIP-05 Identity**: `https://firewisp.de/.well-known/nostr.json` (`steve@firewisp.de`) with CORS enabled.
  - **Anti-Spam PoW Relay**: `wss://relay.firewisp.de` (`strfry` with NIP-13 PoW >= 12 bits + Negentropy, legacy alias `wss://firewisp.relay.rtard.de`).
  - **Blossom Media Server**: `https://blossom.firewisp.de`.
  - **Self-Hosted GRASP Git Server**: `https://git.firewisp.de` (`ngit-grasp`, whitelisted to maintainer `npub`) mirroring `firewisp-web` & `firewisp` Android.

---

## Paused Roadmap — Next Phase

### Web / PWA (Paused)
- [ ] **Encrypted Direct Messages UI (NIP-17)**: wire the fail-closed NIP-17 gift-wrap/seal engine in `src/lib/nostr/nip17.ts` into a full DM inbox & thread view.
- [ ] **Live NIP-05 Verification Checkmark**: verify `user@domain` via `/.well-known/nostr.json` with caching and show a verified badge on profiles & hover preview cards.
- [ ] **Long-Form Articles (`kind: 30023`) & NIP-69 Zap Polls**: clean Markdown article reader and interactive zap-weighted poll voting/creation.
- [ ] **Domain Migration Helper**: one-click encrypted vault/settings export-import prompt when moving users from `firewisp.rtard.de` → `firewisp.de` (and optional 301 redirect afterward).
- [ ] **Optional Privacy HLS Liveness Probe**: opt-in stream liveness check to filter stale streams that ended without an updated NIP-53 `status: ended` tag.

### Android Parity (`v1.3.0-fork.4+`, Paused)
- [ ] Align Android UX with Web additions (modular For You toggles, persistent 2-hop WoT controls, `.jsonl` backup/restore, optional Zapped Posts feed).
