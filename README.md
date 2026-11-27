# Fire Wisp

Fire Wisp is a privacy-focused Nostr web client and installable progressive web app. Browse in watch-only mode, or connect a Nostr signer to publish notes, edit your profile, join live chats, and react. Choose your own relays, media servers, and Lightning wallet.

**[Open Fire Wisp](https://firewisp.de/)** · [Android app](https://app.firewisp.de/) · [Git (GRASP)](https://git.firewisp.de/npub1zsyt45zfh2u28zuhvp66lljp8s6jrwlw7ckvfn34255e7jt37t9qx0xwsm/firewisp-web.git) · [GitWorkshop](https://gitworkshop.dev/npub1zsyt45zfh2u28zuhvp66lljp8s6jrwlw7ckvfn34255e7jt37t9qx0xwsm/relay.ngit.dev/firewisp-web) · [Roadmap](ROADMAP.md)

## Features

- **Sign in your way.** Use a NIP-07 browser extension or a NIP-46 remote signer (Bunker). Fire Wisp also supports NIP-49 encrypted key backups, NIP-06 recovery phrases, and watch-only access with an `npub`.
- **Web of Trust & Lists.** Local persistent 2-hop WoT graph (with optional NIP-85 assertions) powers mutual vouch badges, modular **For You** feeds, and WoT filtering across Explore, Search, Zaps, and Notifications. Manage NIP-51 People, Bookmark, Interest, and Relay sets (`kind: 30000/30002/30003/30015`) plus encrypted mute lists (`kind: 10000`).
- **Backup, Export & Relay Sync.** Export all signed account history to `.jsonl`, download unique HTTPS media URLs (`.txt`), mirror events in one click to public or local relays (such as Citrine, Haven, or Nostr Vault), and recover Follows or Mute Lists cleanly.
- **Edit Profile & Hover Previews.** Update your `kind: 0` profile (preserving third-party custom JSON fields) with client-side EXIF-stripped Blossom uploads, and hover over avatars on desktop for instant WoT & profile previews.
- **Choose where your posts and media go.** Sync your relay list with NIP-65 and your Blossom media server list with BUD-03. Upload media to your chosen Blossom server.
- **Filter spam.** Fire Wisp mines NIP-13 proof of work in a background worker. The dedicated relay at `wss://relay.firewisp.de` requires at least 12 bits of proof of work on public posts and reactions.
- **Zap and react.** Connect a Lightning wallet through Nostr Wallet Connect (NIP-47). Enable the optional **Zapped** feed in Settings to browse posts with verified Lightning zaps. Reactions include pinned `😂 💯 🖖` plus NIP-30 custom emoji.
- **Watch live streams.** Discover NIP-53 streams and watch with live chat, cinema mode, floating mini-player, Global Audio equalizer, and privacy-respecting `song.link` / YouTube embeds.
- **Install as a PWA.** Open Fire Wisp from your home screen and share content into the composer from Android through the system share menu.

## Privacy and browser storage

- **Signing and keys.** A NIP-07 extension or NIP-46 remote signer keeps your Nostr private key in the signer. If you choose to save a local key vault, Fire Wisp stores it encrypted with NIP-49 in this browser.
- **Network requests.** Relays receive the public events you publish. Relays and media hosts can see the IP address that connects to them, including when you browse in watch-only mode.
- **Wallet connections.** Fire Wisp stores the Nostr Wallet Connect URI in browser session storage by default. Enabling **Remember NWC wallet on this device** saves the URI in local storage without vault encryption.

## Run locally

Use Node.js 22 or 24 and npm.

```sh
git clone https://github.com/mptfire/firewisp-web.git
cd firewisp-web
npm ci
npm run dev
```

Open the local URL printed by Vite, usually `http://localhost:5173`.

| Command | Purpose |
| --- | --- |
| `npm run typecheck` | Check TypeScript types |
| `npm test` | Run the Vitest suite |
| `npm run build` | Type-check and create a production build in `dist/` |
| `npm run preview` | Preview the production build locally |

Fire Wisp uses React, TypeScript, Vite, Tailwind CSS, and `nostr-tools`. To self-host, serve `dist/` over HTTPS and configure your static host to serve `index.html` for client-side routes such as `/live` and `/p/<pubkey>`.
