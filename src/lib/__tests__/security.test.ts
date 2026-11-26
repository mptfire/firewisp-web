import { describe, expect, it } from 'vitest'
import { bytesToHex, hexToBytes } from 'nostr-tools/utils'
import { generateSecretKey, finalizeEvent, getPublicKey } from 'nostr-tools/pure'
import * as nip44 from 'nostr-tools/nip44'
import { decryptNcryptsec, encryptNcryptsec, inspectNcryptsecLogN } from '../crypto/nip49'
import {
  derivePrivkeyFromMnemonic,
  normalizeMnemonic,
  validateBip39Mnemonic,
} from '../crypto/nip06'
import { countLeadingZeroBits, minePowSync, verifyEventPow } from '../crypto/nip13'
import { LocalKeySigner } from '../nostr/signer'
import {
  buildBlossomAuthHeader,
  buildCandidateServers,
  buildImetaTag,
  uploadToBlossom,
} from '../nostr/blossom'
import { createGiftWrappedDm, unwrapGiftWrap, KIND_DM_RUMOR, KIND_GIFT_WRAP, KIND_SEAL } from '../nostr/nip17'
import {
  isPublicHostname,
  sanitizeBlossomUrl,
  sanitizeHttpUrl,
  sanitizePublicHttpsUrl,
  sanitizePublicRelayUrl,
  sanitizeRelayUrl,
} from '../sanitize'
import { extractEventHashtags, extractImetaMap, parseNoteContent } from '../nostr/content'
import { parseBolt11AmountSats, parseNwcUri, requestZapInvoice, resolveLud16ToUrl } from '../nostr/nip57'
import { evaluateNoteSpam, isTopLevelNote } from '../nostr/spamFilter'
import {
  buildLiveATag,
  buildShareStreamNotePayload,
  decodeLiveNaddr,
  encodeLiveNaddr,
  getChatActivityRef,
  isLiveStreamFresh,
  isPlayableStreamUrl,
  parseLiveActivity,
  rankTopZappers,
  shouldAcceptLiveActivityUpdate,
  sortLiveStreams,
} from '../nostr/nip53'
import { extractYouTubeRefsFromText, extractYouTubeVideo } from '../nostr/youtube'
import {
  buildBud03BlossomListTags,
  buildNip65RelayListTags,
  extractMuteCandidates,
} from '../nostr/lists'
import { mergeTrendingNotes } from '../nostr/trending'
import { computeLiveZapsStats, parseLiveZapReceipt } from '../nostr/zapsFeed'
import { selectDataSaverMaxLevel, selectLowestBitrateLevel } from '../mediaAudio'
import { parseSharedQueryParams } from '../shareTarget'
import { useLiveStore } from '../store/useLiveStore'
import { useNostrStore } from '../store/useNostrStore'
import { useSettingsStore } from '../store/useSettingsStore'

describe('NIP-49 ncryptsec encryption & DoS guards', () => {
  // Official NIP-49 spec test vector
  const OFFICIAL_NCRYPTSEC =
    'ncryptsec1qgg9947rlpvqu76pj5ecreduf9jxhselq2nae2kghhvd5g7dgjtcxfqtd67p9m0w57lspw8gsq6yphnm8623nsl8xn9j4jdzz84zm3frztj3z7s35vpzmqf6ksu8r89qk5z2zxfmu5gv8th8wclt0h4p'
  const OFFICIAL_PASS = 'nostr'
  const OFFICIAL_PRIV_HEX = '3501454135014541350145413501453fefb02227e449e57cf4d3a3ce05378683'

  it('decrypts the official NIP-49 test vector', () => {
    expect(inspectNcryptsecLogN(OFFICIAL_NCRYPTSEC)).toBe(16)
    const priv = decryptNcryptsec(OFFICIAL_NCRYPTSEC, OFFICIAL_PASS)
    expect(bytesToHex(priv)).toBe(OFFICIAL_PRIV_HEX)
  })

  it('round-trips encrypt and decrypt with bounded log_n', () => {
    const sk = generateSecretKey()
    const enc = encryptNcryptsec(sk, 'ember-secret', 12)
    expect(enc.startsWith('ncryptsec1')).toBe(true)
    const dec = decryptNcryptsec(enc, 'ember-secret')
    expect(bytesToHex(dec)).toBe(bytesToHex(sk))
  })

  it('rejects out-of-bounds log_n to prevent DoS', () => {
    const sk = generateSecretKey()
    expect(() => encryptNcryptsec(sk, 'pass1234', 22)).toThrow(/log_n/)
    expect(() => encryptNcryptsec(sk, 'pass1234', 8)).toThrow(/log_n/)
  })
})

describe('NIP-06 BIP-39 mnemonic derivation', () => {
  // Official NIP-06 12-word & 24-word test vectors
  const VECTOR_12 =
    'leader monkey parrot ring guide accident before fence cannon height naive bean'
  const VECTOR_12_PRIV = '7f7ff03d123792d6ac594bfa67bf6d0c0ab55b6b1fdb6249303fe861f1ccba9a'

  const VECTOR_24 =
    'what bleak badge arrange retreat wolf trade produce cricket blur garlic valid proud rude strong choose busy staff weather area salt hollow arm fade'
  const VECTOR_24_PRIV = 'c15d739894c81a2fcfd3a2df85a0d2c0dbc47a280d092799f144d73d7ae78add'

  it('derives the official 12-word NIP-06 vector', () => {
    expect(bytesToHex(derivePrivkeyFromMnemonic(VECTOR_12))).toBe(VECTOR_12_PRIV)
  })

  it('derives the official 24-word NIP-06 vector', () => {
    expect(bytesToHex(derivePrivkeyFromMnemonic(VECTOR_24))).toBe(VECTOR_24_PRIV)
  })

  it('normalizes NBSP, ideographic spaces, newlines, and uppercase', () => {
    const messy = `  LEADER\u00A0monkey\u3000parrot\nring\tguide accident before fence cannon height naive bean  `
    expect(normalizeMnemonic(messy)).toBe(VECTOR_12)
    expect(bytesToHex(derivePrivkeyFromMnemonic(messy))).toBe(VECTOR_12_PRIV)
  })

  it('fails closed on bad checksum or wrong word count', () => {
    expect(validateBip39Mnemonic('leader monkey parrot')).toBe(false)
    expect(() =>
      derivePrivkeyFromMnemonic(
        'leader monkey parrot ring guide accident before fence cannon height naive leader',
      ),
    ).toThrow(/Invalid/)
  })
})

describe('NIP-13 Proof-of-Work mining & verification', () => {
  it('counts leading zero bits accurately', () => {
    expect(countLeadingZeroBits('000f' + 'a'.repeat(60))).toBe(12)
    expect(countLeadingZeroBits('00008' + 'f'.repeat(59))).toBe(16)
    expect(countLeadingZeroBits('00001' + 'f'.repeat(59))).toBe(19)
    expect(countLeadingZeroBits('8' + '0'.repeat(63))).toBe(0)
  })

  it('mines and verifies a 12-bit PoW event accepted by firewisp.relay.rtard.de', () => {
    const sk = generateSecretKey()
    const pk = getPublicKey(sk)
    const mined = minePowSync(
      {
        kind: 1,
        pubkey: pk,
        created_at: 1700000000,
        tags: [],
        content: 'Fire Wisp PoW test',
      },
      12,
    )
    expect(mined.difficulty).toBeGreaterThanOrEqual(12)
    expect(verifyEventPow(mined.id, mined.event.tags)).toBeGreaterThanOrEqual(12)
    expect(mined.event.tags.some((t) => t[0] === 'nonce' && t[2] === '12')).toBe(true)
  })
})

describe('Blossom BUD-02/05/11 auth, fallback, and fail-closed SHA-256 verification', () => {
  it('defaults to free public Blossom servers (blossom.nostr.build -> blossom.primal.net)', () => {
    expect(buildCandidateServers([])).toEqual([
      'https://blossom.nostr.build',
      'https://blossom.primal.net',
    ])
  })

  it('builds distinct t=media and t=upload BUD-11 auth headers', async () => {
    const signer = new LocalKeySigner(generateSecretKey())
    const mediaAuth = await buildBlossomAuthHeader(signer, 'media', 'a'.repeat(64))
    const uploadAuth = await buildBlossomAuthHeader(signer, 'upload', 'a'.repeat(64))
    const mediaEv = JSON.parse(atob(mediaAuth.replace('Nostr ', '')))
    const uploadEv = JSON.parse(atob(uploadAuth.replace('Nostr ', '')))
    expect(mediaEv.kind).toBe(24242)
    expect(mediaEv.tags.find((t: string[]) => t[0] === 't')?.[1]).toBe('media')
    expect(uploadEv.tags.find((t: string[]) => t[0] === 't')?.[1]).toBe('upload')
  })

  it('rejects mismatched SHA-256 descriptor on raw /upload and falls back to next server', async () => {
    const signer = new LocalKeySigner(generateSecretKey())
    const payload = new Blob(['fire-wisp-bytes'], { type: 'application/octet-stream' })
    const calls: string[] = []

    const fakeFetch: typeof fetch = async (input) => {
      const url = String(input)
      calls.push(url)
      if (url.startsWith('https://blossom.nostr.build')) {
        // Malicious/corrupted sha256 mismatch
        return new Response(
          JSON.stringify({
            url: 'https://blossom.nostr.build/bad.bin',
            sha256: '0'.repeat(64),
            size: payload.size,
            type: 'application/octet-stream',
          }),
          { status: 200 },
        )
      }
      return new Response(
        JSON.stringify({
          url: 'https://blossom.primal.net/good.bin',
          size: payload.size,
          type: 'application/octet-stream',
        }),
        { status: 200 },
      )
    }

    const res = await uploadToBlossom(payload, 'application/octet-stream', signer, [], fakeFetch)
    expect(calls).toEqual([
      'https://blossom.nostr.build/upload',
      'https://blossom.primal.net/upload',
    ])
    expect(res.url).toBe('https://blossom.primal.net/good.bin')

    const imeta = buildImetaTag(res, 'Alt description')
    expect(imeta).toContain('alt Alt description')
    expect(imeta).toContain(`url ${res.url}`)
  })
})

describe('NIP-17 encrypted DMs with strict seal author authentication (#675)', () => {
  it('round-trips a genuine gift-wrapped DM and verifies seal', async () => {
    const alice = new LocalKeySigner(generateSecretKey())
    const bob = new LocalKeySigner(generateSecretKey())
    const { recipientWrap } = await createGiftWrappedDm(alice, bob.pubkey, 'Hello from Fire Wisp')
    const unwrapped = await unwrapGiftWrap(recipientWrap, bob)
    expect(unwrapped).not.toBeNull()
    expect(unwrapped?.senderPubkey).toBe(alice.pubkey)
    expect(unwrapped?.content).toBe('Hello from Fire Wisp')
    expect(unwrapped?.sealVerified).toBe(true)
  })

  it('FAILS CLOSED when rumor.pubkey is spoofed and does not match seal.pubkey', async () => {
    const attackerSk = generateSecretKey()
    const victim = new LocalKeySigner(generateSecretKey())
    const impersonatedPubkey = getPublicKey(generateSecretKey())

    // Attacker crafts a rumor claiming to be `impersonatedPubkey`, wrapped in attacker's own seal.
    const spoofedRumor = {
      kind: KIND_DM_RUMOR,
      pubkey: impersonatedPubkey,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['p', victim.pubkey]],
      content: 'Spoofed message pretending to be admin',
    }
    const sealConv = nip44.v2.utils.getConversationKey(attackerSk, victim.pubkey)
    const seal = finalizeEvent(
      {
        kind: KIND_SEAL,
        created_at: Math.floor(Date.now() / 1000),
        tags: [],
        content: nip44.v2.encrypt(JSON.stringify(spoofedRumor), sealConv),
      },
      attackerSk,
    )
    const ephSk = generateSecretKey()
    const wrapConv = nip44.v2.utils.getConversationKey(ephSk, victim.pubkey)
    const wrap = finalizeEvent(
      {
        kind: KIND_GIFT_WRAP,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['p', victim.pubkey]],
        content: nip44.v2.encrypt(JSON.stringify(seal), wrapConv),
      },
      ephSk,
    )

    const result = await unwrapGiftWrap(wrap, victim)
    expect(result).toBeNull()
  })
})

describe('Sanitization, SSRF guards, NIP-92 imeta, and NWC/LNURL parsing', () => {
  it('blocks javascript:, data:, and unsafe URLs', () => {
    expect(sanitizeHttpUrl('javascript:alert(1)')).toBeNull()
    expect(sanitizeHttpUrl('data:text/html,<script>alert(1)</script>')).toBeNull()
    expect(sanitizeHttpUrl('https://firewisp.rtard.de/hello')).toBe(
      'https://firewisp.rtard.de/hello',
    )
    expect(sanitizeRelayUrl('ws://evil.com')).toBeNull()
    expect(sanitizeRelayUrl('wss://firewisp.relay.rtard.de/')).toBe(
      'wss://firewisp.relay.rtard.de',
    )
    expect(sanitizeBlossomUrl('http://insecure.example')).toBeNull()
    expect(sanitizeBlossomUrl('https://firewisp.blossom.rtard.de/')).toBe(
      'https://firewisp.blossom.rtard.de',
    )
  })

  it('blocks private/loopback hostnames for SSRF protection', () => {
    expect(isPublicHostname('localhost')).toBe(false)
    expect(isPublicHostname('127.0.0.1')).toBe(false)
    expect(isPublicHostname('192.168.1.5')).toBe(false)
    expect(isPublicHostname('10.0.0.1')).toBe(false)
    expect(isPublicHostname('172.16.0.2')).toBe(false)
    expect(sanitizePublicHttpsUrl('https://127.0.0.1/.well-known/lnurlp/a')).toBeNull()
    expect(resolveLud16ToUrl('alice@localhost')).toBeNull()
    expect(resolveLud16ToUrl('alice@getalby.com')).toBe(
      'https://getalby.com/.well-known/lnurlp/alice',
    )
  })

  it('parses NIP-92 imeta alt text and hashtags cleanly', () => {
    const ev = {
      content: 'Look at this flame https://firewisp.blossom.rtard.de/pic.webp #FireWisp',
      tags: [
        ['t', 'nostr'],
        [
          'imeta',
          'url https://firewisp.blossom.rtard.de/pic.webp',
          'm image/webp',
          'alt Impasto flame logo',
        ],
      ],
    }
    const imeta = extractImetaMap(ev.tags)
    expect(imeta.get('https://firewisp.blossom.rtard.de/pic.webp')?.alt).toBe(
      'Impasto flame logo',
    )
    const parsed = parseNoteContent(ev)
    expect(parsed.media).toHaveLength(1)
    expect(parsed.media[0].alt).toBe('Impasto flame logo')
    expect(extractEventHashtags(ev).sort()).toEqual(['firewisp', 'nostr'])
  })

  it('validates NWC URIs strictly', () => {
    const pk = 'a'.repeat(64)
    const sec = 'b'.repeat(64)
    const ok = parseNwcUri(`nostr+walletconnect://${pk}?relay=wss://relay.getalby.com/v1&secret=${sec}`)
    expect(ok).toEqual({
      walletPubkey: pk,
      relay: 'wss://relay.getalby.com/v1',
      secretHex: sec,
    })
    expect(parseNwcUri('nostr+walletconnect://bad?relay=ws://evil.com&secret=123')).toBeNull()
  })

  it('defensively copies and wipes LocalKeySigner secret key on destroy', () => {
    const raw = hexToBytes('11'.repeat(32))
    const signer = new LocalKeySigner(raw)
    raw.fill(0) // caller wiping its buffer must not break signer
    expect(bytesToHex(signer.exportSecretKey())).toBe('11'.repeat(32))
    signer.destroy()
    expect(() => signer.exportSecretKey()).toThrow(/wiped/)
  })

  it('refuses cleartext http:// and private/LAN IP inline media embedding', () => {
    const parsed = parseNoteContent({
      content:
        'Cleartext http://insecure.example/photo.png LAN https://192.168.1.1/cam.png Loopback https://127.0.0.1/a.png IPv6 https://[fd00::1]/b.png',
      tags: [['imeta', 'url https://10.0.0.5/secret.jpg', 'm image/jpeg']],
    })
    expect(parsed.media).toHaveLength(0)
    expect(parsed.segments.some((s) => s.type === 'link')).toBe(true)
  })

  it('blocks IPv6 ULA/link-local/mapped-IPv4, CGNAT, and private Blossom URLs', () => {
    expect(isPublicHostname('[fd00::1]')).toBe(false)
    expect(isPublicHostname('[fe80::1]')).toBe(false)
    expect(isPublicHostname('[::ffff:127.0.0.1]')).toBe(false)
    expect(isPublicHostname('100.64.0.1')).toBe(false)
    expect(isPublicHostname('100.127.255.254')).toBe(false)
    expect(isPublicHostname('100.128.0.1')).toBe(true)
    expect(sanitizeBlossomUrl('https://localhost:3000')).toBeNull()
    expect(sanitizeBlossomUrl('https://192.168.1.50')).toBeNull()
    expect(sanitizeBlossomUrl('https://blossom.primal.net/')).toBe('https://blossom.primal.net')
  })

  it('rejects weak (< 8 char) passphrases for NIP-49 encryption and non-mainnet BOLT-11 invoices', () => {
    const sk = hexToBytes('22'.repeat(32))
    expect(() => encryptNcryptsec(sk, '1234', 12)).toThrow(/at least 8 characters/)
    expect(parseBolt11AmountSats('lntb210n1p0testnetinvoice')).toBeNull()
    expect(parseBolt11AmountSats('lnbcrt210n1p0regtestinvoice')).toBeNull()
  })

  it('verifies BOLT-11 invoice amount pre-pay and rejects tampered LNURL invoices', async () => {
    expect(parseBolt11AmountSats('lnbc210n1p0testinvoice')).toBe(21)
    expect(parseBolt11AmountSats('lnbc1m1p0testinvoice')).toBe(100_000)
    expect(parseBolt11AmountSats('lnbc1p0amountless')).toBeNull()

    const evilFetch: typeof fetch = async (input) => {
      const u = String(input)
      if (u.includes('.well-known/lnurlp')) {
        return new Response(
          JSON.stringify({
            callback: 'https://evil.example/cb',
            minSendable: 1000,
            maxSendable: 1_000_000_000,
          }),
          { status: 200 },
        )
      }
      // User requested 21 sats, evil server returns 100,000 sats invoice!
      return new Response(JSON.stringify({ pr: 'lnbc1m1p0tamperedinvoice' }), { status: 200 })
    }

    await expect(
      requestZapInvoice({
        lud16: 'alice@evil.example',
        amountSats: 21,
        recipientPubkey: 'a'.repeat(64),
        relays: ['wss://firewisp.relay.rtard.de'],
        fetchImpl: evilFetch,
      }),
    ).rejects.toThrow(/Invoice amount mismatch/)
  })
})

describe('Explore anti-spam filter (matching Android NSpam heuristics)', () => {
  it('blocks invisible-char spam, hashtag stuffing, mention floods, scam links, and cross-account duplicates', () => {
    const base = { id: 'f'.repeat(64), pubkey: '1'.repeat(64), kind: 1, tags: [] as string[][] }

    expect(
      evaluateNoteSpam({ ...base, content: 'Hello\u200B\u200C\u200D\u200B\uFEFF spam' }).isSpam,
    ).toBe(true)

    expect(
      evaluateNoteSpam({
        ...base,
        content: 'Claim your free btc airdrop now https://t.me/scam',
      }).isSpam,
    ).toBe(true)

    expect(
      evaluateNoteSpam({
        ...base,
        content: 'Buy now #a #b #c #d #e #f #g #h #i #j',
      }).isSpam,
    ).toBe(true)

    expect(
      evaluateNoteSpam({
        ...base,
        content: 'Hey everyone!',
        tags: Array.from({ length: 13 }, (_, i) => ['p', `${i}`.padStart(64, 'a')]),
      }).isSpam,
    ).toBe(true)

    // Cross-account copy-paste duplicate flood
    const seen = new Map<string, Set<string>>()
    const floodText = 'This is an identical automated bot message repeated across accounts'
    expect(evaluateNoteSpam({ ...base, pubkey: 'a'.repeat(64), content: floodText }, { seenContentAuthors: seen }).isSpam).toBe(false)
    expect(evaluateNoteSpam({ ...base, pubkey: 'b'.repeat(64), content: floodText }, { seenContentAuthors: seen }).isSpam).toBe(true)

    // Machine/telemetry kind-1 junk observed live on public relays
    expect(evaluateNoteSpam({ ...base, content: 'cc1f6b6d54f03126208a7e97b0964d16cee43c51e2042ad6', tags: [['t', 'relay-selftest']] }).isSpam).toBe(true)
    expect(evaluateNoteSpam({ ...base, content: 'sp_4c43bd1d.bce451f9fe531d8c71c28c1f.12.ZU3WOSMGVWZZKB3QFNIKFZIPQNFE3TF.drift.gits.net', tags: [['t', 'sp_4c43bd1d']] }).isSpam).toBe(true)
    expect(evaluateNoteSpam({ ...base, content: '{"anchored_at":"2026-11-24T11:30:11.301Z"}', tags: [['t', 'zambo-receipt']] }).isSpam).toBe(true)
    expect(evaluateNoteSpam({ ...base, content: 'yWMRZStZcloNBXOYf4M9xuWRhVwfSPSM2i3PaidZA7OFjFKO7hEPFv6Ei2yd+2O13PQ1FYaVNvkD2', tags: [['t', 'xvd-stat']] }).isSpam).toBe(true)
    expect(evaluateNoteSpam({ ...base, content: '✄------------ 20:30 ------------✄', tags: [] }).isSpam).toBe(true)

    // Real reported homoglyph ETH giveaway scam (note1lyu3cjpld6aet7utp38ngjsyw4ql9952c2hhvemhkkaxxkelyc8swl7tnu)
    const realScamVerdict = evaluateNoteSpam({
      id: 'f9391c483f6ebb95fb8b0c4f344a047541f2968ac2af766777b5ba635b3f260f',
      pubkey: '620f89010421b149a6dfb2c92955dbffbfa6ecefb1ed3aad98740fbc1a85b0c0',
      kind: 1,
      content: '⚡️ 1 EᎢH givᎬaway livΕ: https://one.evmverse.cc/?ref=0oolbj\n⚡️ ᎻurrΥ up!',
      tags: [
        ['t', 'crypto'],
        ['t', 'ethereum'],
        ['t', 'airdrop'],
        ['t', 'nostr'],
        ['t', 'bitcoin'],
      ],
    })
    expect(realScamVerdict.isSpam).toBe(true)
    expect(realScamVerdict.reasons).toContain('mixed-script homoglyph obfuscation')

    // Author burst cap
    const counts = new Map<string, number>()
    expect(evaluateNoteSpam({ ...base, content: 'First post from bot' }, { authorCounts: counts, maxPerAuthor: 2 }).isSpam).toBe(false)
    expect(evaluateNoteSpam({ ...base, content: 'Second post from bot' }, { authorCounts: counts, maxPerAuthor: 2 }).isSpam).toBe(false)
    expect(evaluateNoteSpam({ ...base, content: 'Third burst post from bot' }, { authorCounts: counts, maxPerAuthor: 2 }).isSpam).toBe(true)
  })

  it('never filters normal notes, followed users, or top-level checks', () => {
    const normal = {
      id: '0000' + 'a'.repeat(60),
      pubkey: '2'.repeat(64),
      kind: 1,
      content: 'Good morning Nostr! Testing Fire Wisp today.',
      tags: [['nonce', '42', '16']],
    }
    expect(evaluateNoteSpam(normal).isSpam).toBe(false)
    expect(isTopLevelNote(normal)).toBe(true)
    expect(
      isTopLevelNote({ tags: [['e', '1'.repeat(64), '', 'reply']] }),
    ).toBe(false)
    // NIP-10 "mention" e-tag is a quote post, NOT a reply
    expect(
      isTopLevelNote({ tags: [['e', '1'.repeat(64), '', 'mention']] }),
    ).toBe(true)

    // Followed accounts are always exempt
    expect(
      evaluateNoteSpam(
        { id: 'f'.repeat(64), pubkey: '9'.repeat(64), kind: 1, content: 'free btc', tags: [] },
        { follows: new Set(['9'.repeat(64)]) },
      ).isSpam,
    ).toBe(false)
  })
})

describe('NIP-53 live streaming parser & security guards', () => {
  it('parses valid kind-30311 events, resolves Host role, and round-trips naddr', () => {
    const hostPk = 'a'.repeat(64)
    const streamerPk = 'b'.repeat(64)
    const parsed = parseLiveActivity({
      id: '1'.repeat(64),
      kind: 30311,
      pubkey: hostPk,
      created_at: 1732400000,
      tags: [
        ['d', 'fire-stream-1'],
        ['title', 'Fire Wisp Live'],
        ['status', 'live'],
        ['streaming', 'https://stream.zap.stream/hls/test/live.m3u8'],
        ['image', 'https://blossom.primal.net/thumb.png'],
        ['p', streamerPk, '', 'Host'],
        ['relays', 'wss://relay.snort.social', 'ws://insecure.example'],
      ],
    })
    expect(parsed).not.toBeNull()
    expect(parsed?.streamerPubkey).toBe(streamerPk)
    expect(parsed?.streamingUrl).toBe('https://stream.zap.stream/hls/test/live.m3u8')
    expect(parsed?.relayHints).toEqual(['wss://relay.snort.social'])
    expect(buildLiveATag(hostPk, 'fire-stream-1')).toBe(`30311:${hostPk}:fire-stream-1`)

    const naddr = encodeLiveNaddr(hostPk, 'fire-stream-1', ['wss://relay.snort.social'])
    const decoded = decodeLiveNaddr(naddr)
    expect(decoded).toEqual({
      hostPubkey: hostPk,
      dTag: 'fire-stream-1',
      relays: ['wss://relay.snort.social'],
    })
  })

  it('rejects cleartext http:// and private/LAN streaming and image URLs in kind-30311', () => {
    const parsed = parseLiveActivity({
      id: '2'.repeat(64),
      kind: 30311,
      pubkey: 'c'.repeat(64),
      created_at: 1732400000,
      tags: [
        ['d', 'evil-stream'],
        ['status', 'live'],
        ['streaming', 'https://192.168.1.10/live.m3u8'],
        ['image', 'http://insecure.example/thumb.png'],
        ['recording', 'https://[fd00::1]/rec.mp4'],
      ],
    })
    expect(parsed?.streamingUrl).toBeUndefined()
    expect(parsed?.image).toBeUndefined()
    expect(parsed?.recordingUrl).toBeUndefined()

    // Picks playable HTTPS streaming tag even when a non-HTTPS moq:// tag comes first, and falls back to thumb
    const multiStreaming = parseLiveActivity({
      id: '3'.repeat(64),
      kind: 30311,
      pubkey: 'd'.repeat(64),
      created_at: 1732400000,
      tags: [
        ['d', 'streamstr-test'],
        ['status', 'live'],
        ['thumb', 'https://streamstr.net/thumb.webp'],
        ['streaming', 'moq://streamstr.net:1443/'],
        ['streaming', 'https://streamstr.net/abc/hls/live.m3u8'],
      ],
    })
    expect(multiStreaming?.streamingUrl).toBe('https://streamstr.net/abc/hls/live.m3u8')
    expect(multiStreaming?.image).toBe('https://streamstr.net/thumb.webp')
  })

  it('attaches #a tag to signed kind-9734 zap requests when zapping a live stream', async () => {
    const signer = new LocalKeySigner(hexToBytes('33'.repeat(32)))
    let capturedZapReq = ''
    const mockFetch: typeof fetch = async (input) => {
      const u = new URL(String(input))
      if (u.pathname.includes('.well-known/lnurlp')) {
        return new Response(
          JSON.stringify({
            callback: 'https://ln.example/cb',
            minSendable: 1000,
            maxSendable: 1_000_000_000,
            allowsNostr: true,
          }),
          { status: 200 },
        )
      }
      capturedZapReq = u.searchParams.get('nostr') || ''
      return new Response(JSON.stringify({ pr: 'lnbc210n1p0streamzap' }), { status: 200 })
    }

    const aTag = `30311:${'a'.repeat(64)}:stream-1`
    await requestZapInvoice({
      lud16: 'host@ln.example',
      amountSats: 21,
      recipientPubkey: 'a'.repeat(64),
      eventATag: aTag,
      relays: ['wss://firewisp.relay.rtard.de'],
      signer,
      fetchImpl: mockFetch,
    })
    const parsedReq = JSON.parse(capturedZapReq) as { tags: string[][] }
    expect(parsedReq.tags).toContainEqual(['a', aTag])
    signer.destroy()
  })

  it('orders live streams by follow list first, then by highest follower count', () => {
    const pkFollowedSmall = '1'.repeat(64)
    const pkFollowedBig = '2'.repeat(64)
    const pkStrangerHuge = '3'.repeat(64)
    const pkStrangerMid = '4'.repeat(64)

    const ranked = sortLiveStreams(
      [
        {
          id: 'stranger-mid',
          activity: { hostPubkey: pkStrangerMid, createdAt: 100 },
          chatters: ['a', 'b'],
        },
        {
          id: 'stranger-huge',
          activity: { hostPubkey: pkStrangerHuge, createdAt: 90 },
          chatters: [],
        },
        {
          id: 'followed-small',
          activity: { hostPubkey: pkFollowedSmall, createdAt: 80 },
          chatters: [],
        },
        {
          id: 'followed-big',
          activity: { hostPubkey: pkFollowedBig, createdAt: 70 },
          chatters: [],
        },
      ],
      new Set([pkFollowedSmall, pkFollowedBig]),
      {
        [pkFollowedSmall]: 120,
        [pkFollowedBig]: 4500,
        [pkStrangerHuge]: 50000,
        [pkStrangerMid]: 800,
      },
    )

    expect(ranked.map((r) => r.id)).toEqual([
      'followed-big',
      'followed-small',
      'stranger-huge',
      'stranger-mid',
    ])
  })

  it('hardens live stream liveness with tombstones, ends expiry, heartbeat cutoffs, and URL validation', () => {
    const now = 1_800_000_000

    // Ended tombstone blocks older or equal-timestamp live event from lagging relays
    expect(
      shouldAcceptLiveActivityUpdate(
        { createdAt: now - 10, status: 'ended' },
        { createdAt: now - 120, status: 'live' },
      ),
    ).toBe(false)
    expect(
      shouldAcceptLiveActivityUpdate(
        { createdAt: now - 10, status: 'ended' },
        { createdAt: now - 10, status: 'live' },
      ),
    ).toBe(false)
    expect(
      shouldAcceptLiveActivityUpdate(
        { createdAt: now - 120, status: 'ended' },
        { createdAt: now - 10, status: 'live' },
      ),
    ).toBe(true)

    // Rejects non-stream web pages while keeping real HTTPS HLS URLs
    expect(isPlayableStreamUrl('https://api-uk.zap.stream/abc/hls/live.m3u8')).toBe(true)
    expect(isPlayableStreamUrl('https://youtu.be/20t-IZZztOk')).toBe(false)
    expect(isPlayableStreamUrl('https://www.twitch.tv/someone')).toBe(false)
    expect(isPlayableStreamUrl('https://example.com/watch.html')).toBe(false)

    // Detects zap.stream/naddr1... URLs in notes as live stream embeds
    const liveAddr = encodeLiveNaddr('a'.repeat(64), 'zelda-live')
    const parsedZapStream = parseNoteContent({
      content: `Come watch https://zap.stream/${liveAddr}`,
      tags: [],
    })
    expect(parsedZapStream.segments.some((s) => s.type === 'live' && s.dTag === 'zelda-live')).toBe(
      true,
    )

    const baseActivity = {
      hostPubkey: 'a'.repeat(64),
      status: 'live' as const,
      streamingUrl: 'https://cdn.example/live.m3u8',
      createdAt: now - 600,
    }
    expect(isLiveStreamFresh({ activity: baseActivity, chatters: [] }, now)).toBe(true)
    // Past `ends` tag -> not live
    expect(
      isLiveStreamFresh({ activity: { ...baseActivity, ends: now - 5 }, chatters: [] }, now),
    ).toBe(false)
    // >2h stale with no recent chat -> dropped
    expect(
      isLiveStreamFresh({ activity: { ...baseActivity, createdAt: now - 2.5 * 3600 }, chatters: [] }, now),
    ).toBe(false)
    // 2.5h old BUT active chat 10m ago -> kept within 3h grace
    expect(
      isLiveStreamFresh(
        {
          activity: { ...baseActivity, createdAt: now - 2.5 * 3600 },
          chatters: ['b'.repeat(64)],
          lastChatAt: now - 600,
        },
        now,
      ),
    ).toBe(true)
    // >3h old -> dropped even if someone dropped a stray chat message
    expect(
      isLiveStreamFresh(
        {
          activity: { ...baseActivity, createdAt: now - 4 * 3600 },
          chatters: ['b'.repeat(64)],
          lastChatAt: now - 60,
        },
        now,
      ),
    ).toBe(false)
  })
})

describe('YouTube preview card parser & security guards (Option 1B)', () => {
  it('parses youtu.be, watch, shorts, live, and timestamped YouTube URLs', () => {
    expect(extractYouTubeVideo('https://youtu.be/20t-IZZztOk')).toEqual({
      videoId: '20t-IZZztOk',
      url: 'https://youtu.be/20t-IZZztOk',
      thumbnailUrl: 'https://i.ytimg.com/vi/20t-IZZztOk/hqdefault.jpg',
      isShort: undefined,
      startSeconds: undefined,
    })

    expect(extractYouTubeVideo('https://www.youtube.com/watch?v=20t-IZZztOk&t=1m30s')).toEqual({
      videoId: '20t-IZZztOk',
      url: 'https://youtu.be/20t-IZZztOk?t=90',
      thumbnailUrl: 'https://i.ytimg.com/vi/20t-IZZztOk/hqdefault.jpg',
      isShort: undefined,
      startSeconds: 90,
    })

    const shortRef = extractYouTubeVideo('https://youtube.com/shorts/20t-IZZztOk')
    expect(shortRef?.isShort).toBe(true)
    expect(shortRef?.url).toBe('https://www.youtube.com/shorts/20t-IZZztOk')
    expect(extractYouTubeVideo('https://m.youtube.com/live/20t-IZZztOk')?.videoId).toBe(
      '20t-IZZztOk',
    )
  })

  it('rejects spoofed hostnames, embedded credentials, and malformed video IDs', () => {
    expect(extractYouTubeVideo('https://evil-youtube.com/watch?v=20t-IZZztOk')).toBeNull()
    expect(extractYouTubeVideo('https://youtu.be.attacker.example/20t-IZZztOk')).toBeNull()
    expect(extractYouTubeVideo('https://user:pass@youtu.be/20t-IZZztOk')).toBeNull()
    expect(extractYouTubeVideo('https://youtu.be/short')).toBeNull()
    expect(extractYouTubeVideo('javascript:alert(1)')).toBeNull()
  })

  it('extracts deduplicated YouTube previews in parseNoteContent without duplicating raw URL links', () => {
    const parsed = parseNoteContent({
      content: 'Great track https://youtu.be/20t-IZZztOk and again https://www.youtube.com/watch?v=20t-IZZztOk',
      tags: [],
    })
    expect(parsed.youtube).toHaveLength(1)
    expect(parsed.youtube[0].videoId).toBe('20t-IZZztOk')
    expect(parsed.segments.some((s) => s.type === 'link')).toBe(false)
    expect(extractYouTubeRefsFromText('Check https://youtu.be/20t-IZZztOk!')).toHaveLength(1)
  })

  it('parses and deduplicates Android Web Share Target params cleanly', () => {
    expect(
      parseSharedQueryParams(
        '?title=Ali+Campbell+-+I+Want+You&text=https%3A%2F%2Fyoutu.be%2F20t-IZZztOk',
      ),
    ).toBe('Ali Campbell - I Want You\nhttps://youtu.be/20t-IZZztOk')

    expect(
      parseSharedQueryParams(
        '?title=Same&text=Same+https%3A%2F%2Fyoutu.be%2F20t-IZZztOk&url=https%3A%2F%2Fyoutu.be%2F20t-IZZztOk',
      ),
    ).toBe('Same https://youtu.be/20t-IZZztOk')

    expect(parseSharedQueryParams('')).toBeNull()
  })
})

describe('Full code-audit regression & security hardening', () => {
  it('blocks SSRF bypasses in sanitizePublicRelayUrl, sanitizePublicHttpsUrl, and isPublicHostname', () => {
    expect(sanitizePublicRelayUrl('wss://relay.damus.io')).toBe('wss://relay.damus.io')
    expect(sanitizePublicRelayUrl('ws://localhost:8080')).toBeNull()
    expect(sanitizePublicRelayUrl('wss://localhost:8080')).toBeNull()
    expect(sanitizePublicRelayUrl('wss://sub.localhost')).toBeNull()
    expect(sanitizePublicRelayUrl('wss://localhost.')).toBeNull()
    expect(sanitizePublicRelayUrl('wss://127.0.0.1:443')).toBeNull()
    expect(sanitizePublicRelayUrl('wss://192.168.1.5')).toBeNull()
    expect(sanitizePublicRelayUrl('wss://169.254.169.254')).toBeNull()
    expect(sanitizePublicRelayUrl('wss://[::1]')).toBeNull()
    expect(sanitizePublicRelayUrl('wss://router')).toBeNull()
    expect(sanitizePublicRelayUrl('wss://0.1.2.3')).toBeNull()
    expect(sanitizePublicHttpsUrl('https://user:pass@cdn.example.com/a.mp4')).toBeNull()
    expect(isPublicHostname('foo.local.')).toBe(false)
    expect(isPublicHostname('app.localhost')).toBe(false)
    expect(isPublicHostname('[::7f00:1]')).toBe(false)
    expect(isPublicHostname('2606:4700:4700::1111')).toBe(true)
  })

  it('rejects far-future live timestamps and normalizes uppercase chat activity refs', () => {
    const now = 1_800_000_000
    expect(
      isLiveStreamFresh(
        {
          activity: {
            status: 'live',
            streamingUrl: 'https://stream.example.com/live/index.m3u8',
            createdAt: now + 3600,
          },
        },
        now,
      ),
    ).toBe(false)

    const upperPk = 'A'.repeat(64)
    expect(
      getChatActivityRef({
        kind: 1311,
        tags: [['a', `30311:${upperPk}:show-1`]],
      }),
    ).toBe(`30311:${'a'.repeat(64)}:show-1`)
    expect(getChatActivityRef({ kind: 1311, tags: [['a', '30311:not-hex:show']] })).toBeNull()
  })

  it('ignores URL #fragments in hashtags and preserves 5th+ unique YouTube links as links', () => {
    const tags = extractEventHashtags({
      content: 'Read https://example.com/docs#section123 #Bitcoin',
      tags: [],
    })
    expect(tags).toEqual(['bitcoin'])

    const fiveYt = [
      'https://youtu.be/aaaaaaaaaaa',
      'https://youtu.be/bbbbbbbbbbb',
      'https://youtu.be/ccccccccccc',
      'https://youtu.be/ddddddddddd',
      'https://youtu.be/eeeeeeeeeee',
    ].join(' ')
    const parsed = parseNoteContent({ content: fiveYt, tags: [] })
    expect(parsed.youtube).toHaveLength(4)
    expect(parsed.segments.some((s) => s.type === 'link' && s.url.includes('eeeeeeeeeee'))).toBe(
      true,
    )
  })

  it('prevents forged pre-load NIP-09 kind-5 deletions by non-authors', () => {
    const victimSk = generateSecretKey()
    const attackerSk = generateSecretKey()
    const victimNote = finalizeEvent(
      { kind: 1, created_at: 1_800_000_000, tags: [], content: 'Legitimate note' },
      victimSk,
    )
    // Attacker broadcasts forged kind-5 BEFORE victimNote is even loaded in store
    const forgedDel = finalizeEvent(
      { kind: 5, created_at: 1_800_000_001, tags: [['e', victimNote.id]], content: '' },
      attackerSk,
    )
    const store = useNostrStore.getState()
    store.ingestEvent(forgedDel)
    expect(store.isEventDeleted(victimNote)).toBe(false)

    // Genuine author deletion DOES mark victimNote deleted
    const realDel = finalizeEvent(
      { kind: 5, created_at: 1_800_000_002, tags: [['e', victimNote.id]], content: '' },
      victimSk,
    )
    store.ingestEvent(realDel)
    expect(store.isEventDeleted(victimNote)).toBe(true)
  })

  it('auto-hides unloadable live streams while online, keeps activeActivity for Retry, and restores on recovery', () => {
    const hostPk = 'd'.repeat(64)
    const dTag = 'retry-stream'
    const aTag = buildLiveATag(hostPk, dTag)
    const nowSec = Math.floor(Date.now() / 1000)
    const activity = {
      eventId: 'e'.repeat(64),
      dTag,
      hostPubkey: hostPk,
      title: 'Test Live Stream',
      status: 'live' as const,
      streamingUrl: 'https://stream.example.com/live/index.m3u8',
      participants: [],
      relayHints: ['wss://relay.snort.social'],
      createdAt: nowSec - 60,
    }

    useNostrStore.setState({ relayStatuses: { 'wss://relay.snort.social': 'connected' } })
    useLiveStore.setState({
      liveStreams: {
        [aTag]: { activity, aTagValue: aTag, chatters: [], lastChatAt: 0 },
      },
      activeATag: aTag,
      activeActivity: activity,
    })

    // While client is offline (all relays disconnected), markStreamOffline must NOT wipe LIVE NOW
    useNostrStore.setState({ relayStatuses: { 'wss://relay.snort.social': 'disconnected' } })
    useLiveStore.getState().markStreamOffline(aTag)
    expect(useLiveStore.getState().liveStreams[aTag]).toBeDefined()

    // While online with a connected relay, markStreamOffline hides it from LIVE NOW but keeps activeActivity intact for Retry
    useNostrStore.setState({ relayStatuses: { 'wss://relay.snort.social': 'connected' } })
    useLiveStore.getState().markStreamOffline(aTag)
    expect(useLiveStore.getState().liveStreams[aTag]).toBeUndefined()
    expect(useLiveStore.getState().activeActivity?.status).toBe('live')

    // If Retry succeeds, markStreamOnline restores it cleanly back into LIVE NOW
    useLiveStore.getState().markStreamOnline(aTag)
    expect(useLiveStore.getState().liveStreams[aTag]?.activity.title).toBe('Test Live Stream')
  })

  it('builds valid NIP-21/NIP-18/NIP-53 share-stream note payloads without duplicating naddr', () => {
    const hostPk = 'a'.repeat(64)
    const streamerPk = 'b'.repeat(64)
    const naddr = encodeLiveNaddr(hostPk, 'fire-live-42', ['wss://relay.snort.social'])

    const withComment = buildShareStreamNotePayload({
      comment: 'Tune in now! #nostr',
      naddr,
      hostPubkey: hostPk,
      streamerPubkey: streamerPk,
      dTag: 'fire-live-42',
      relayHint: 'wss://relay.snort.social',
    })
    expect(withComment.content).toBe(`Tune in now! #nostr\n\nnostr:${naddr}`)
    expect(withComment.extraTags).toContainEqual(['q', `30311:${hostPk}:fire-live-42`, 'wss://relay.snort.social'])
    expect(withComment.extraTags).toContainEqual(['a', `30311:${hostPk}:fire-live-42`, 'wss://relay.snort.social'])
    expect(withComment.extraTags).toContainEqual(['p', streamerPk])
    expect(withComment.extraTags).toContainEqual(['p', hostPk])

    // Empty comment still produces a valid embedded live stream note
    const emptyComment = buildShareStreamNotePayload({
      comment: '   ',
      naddr,
      hostPubkey: hostPk,
      streamerPubkey: hostPk,
      dTag: 'fire-live-42',
    })
    expect(emptyComment.content).toBe(`nostr:${naddr}`)
    expect(emptyComment.extraTags.filter((t) => t[0] === 'p')).toEqual([['p', hostPk]])

    // Does not duplicate naddr if the user already included it in their note text
    const alreadyEmbedded = buildShareStreamNotePayload({
      comment: `Check out nostr:${naddr} right now!`,
      naddr,
      hostPubkey: hostPk,
      dTag: 'fire-live-42',
    })
    expect(alreadyEmbedded.content).toBe(`Check out nostr:${naddr} right now!`)
  })

  it('ranks Top Zappers by total sats descending with zap-count and recency tie-breakers', () => {
    const ranked = rankTopZappers({
      alice: { pubkey: '1'.repeat(64), totalSats: 210, zapCount: 2, lastZapAt: 100 },
      bob: { pubkey: '2'.repeat(64), totalSats: 10_026, zapCount: 1, lastZapAt: 90 },
      carol: { pubkey: '3'.repeat(64), totalSats: 210, zapCount: 4, lastZapAt: 80 },
      zero: { pubkey: '4'.repeat(64), totalSats: 0, zapCount: 1, lastZapAt: 200 },
    })
    expect(ranked.map((r) => r.pubkey)).toEqual([
      '2'.repeat(64), // 10,026 sats
      '3'.repeat(64), // 210 sats, 4 zaps
      '1'.repeat(64), // 210 sats, 2 zaps
    ])
  })

  it('parses live NIP-57 zap receipts strictly, encodes stream targets, and rejects spoofed amounts', () => {
    const sender = '1'.repeat(64)
    const recipient = '2'.repeat(64)
    const noteId = '3'.repeat(64)
    const now = 1_800_000_000

    // Valid note zap (21 sats = lnbc210n1...)
    const noteZap = parseLiveZapReceipt(
      {
        id: 'a'.repeat(64),
        kind: 9735,
        pubkey: '9'.repeat(64),
        created_at: now - 120,
        tags: [
          ['p', recipient],
          ['e', noteId],
          ['bolt11', 'lnbc210n1p0livezapnote'],
          [
            'description',
            JSON.stringify({
              pubkey: sender,
              content: 'GM 🧡',
              tags: [['amount', '21000']],
            }),
          ],
        ],
      },
      now,
    )
    expect(noteZap).toMatchObject({
      senderPubkey: sender,
      recipientPubkey: recipient,
      sats: 21,
      comment: 'GM 🧡',
      targetEventId: noteId,
    })

    // Valid live stream zap (100 sats = lnbc1u1..., #a tag 30311:...)
    const streamZap = parseLiveZapReceipt(
      {
        id: 'b'.repeat(64),
        kind: 9735,
        pubkey: '9'.repeat(64),
        created_at: now - 60,
        tags: [
          ['p', recipient],
          ['a', `30311:${recipient}:radio-live`],
          ['bolt11', 'lnbc1u1p0livezapstream'],
          ['description', JSON.stringify({ pubkey: sender, content: 'Nice track!' })],
        ],
      },
      now,
    )
    expect(streamZap?.sats).toBe(100)
    expect(streamZap?.targetLiveNaddr).toMatch(/^naddr1/)
    expect(streamZap?.targetEventId).toBeUndefined()

    // Spoofed amount mismatch (request claims 50,000 sats, invoice is only 21 sats) -> rejected
    const spoofed = parseLiveZapReceipt(
      {
        id: 'c'.repeat(64),
        kind: 9735,
        pubkey: '9'.repeat(64),
        created_at: now - 30,
        tags: [
          ['p', recipient],
          ['bolt11', 'lnbc210n1p0spoof'],
          ['description', JSON.stringify({ pubkey: sender, tags: [['amount', '50000000']] })],
        ],
      },
      now,
    )
    expect(spoofed).toBeNull()

    // Far-future timestamp -> rejected
    const futureZap = parseLiveZapReceipt(
      {
        id: 'd'.repeat(64),
        kind: 9735,
        pubkey: '9'.repeat(64),
        created_at: now + 900,
        tags: [
          ['p', recipient],
          ['bolt11', 'lnbc210n1p0future'],
          ['description', JSON.stringify({ pubkey: sender })],
        ],
      },
      now,
    )
    expect(futureZap).toBeNull()

    // Stats computation
    const stats = computeLiveZapsStats([noteZap!, streamZap!], now)
    expect(stats.totalSats).toBe(121)
    expect(stats.zapCount).toBe(2)
    expect(stats.zapsPerMinute).toBe(1)
  })

  it('builds canonical NIP-65 (kind 10002) and BUD-03 (kind 10063) tags while filtering private/unsafe URLs', () => {
    const relayResult = buildNip65RelayListTags([
      { url: 'wss://relay.mptfire.de/', read: true, write: true },
      { url: 'wss://relay.primal.net', read: true, write: false },
      { url: 'wss://firewisp.relay.rtard.de', read: false, write: true },
      { url: 'wss://disabled.example.com', read: false, write: false },
      { url: 'ws://127.0.0.1:4869', read: true, write: true }, // local Citrine must NOT leak to public NIP-65
      { url: 'wss://relay.mptfire.de', read: true, write: true }, // duplicate
    ])
    expect(relayResult.tags).toEqual([
      ['r', 'wss://relay.mptfire.de'],
      ['r', 'wss://relay.primal.net', 'read'],
      ['r', 'wss://firewisp.relay.rtard.de', 'write'],
    ])
    expect(relayResult.readRelays).toEqual(['wss://relay.mptfire.de', 'wss://relay.primal.net'])
    expect(relayResult.writeRelays).toEqual(['wss://relay.mptfire.de', 'wss://firewisp.relay.rtard.de'])

    const blossomResult = buildBud03BlossomListTags([
      'https://blossom.mptfire.de/',
      'https://blossom.nostr.build',
      'http://insecure.example.com',
      'https://192.168.1.5',
      'https://blossom.mptfire.de',
    ])
    expect(blossomResult.tags).toEqual([
      ['server', 'https://blossom.mptfire.de'],
      ['server', 'https://blossom.nostr.build'],
    ])
    expect(blossomResult.servers).toEqual([
      'https://blossom.mptfire.de',
      'https://blossom.nostr.build',
    ])
  })

  it('merges 4h hot + 24h trending + relay notes, drops stale leftovers, and caps per-author burst', () => {
    const now = 1_800_000_000
    const mk = (id: string, pubkey: string, ageSec: number) => ({
      id,
      pubkey,
      kind: 1,
      created_at: now - ageSec,
      tags: [],
      content: `note ${id}`,
      sig: '0'.repeat(128),
    })

    const merged = mergeTrendingNotes({
      hotNotes: [
        mk('h1', 'a'.repeat(64), 900), // 15m ago
        mk('h2', 'a'.repeat(64), 1800), // 30m ago
        mk('h3', 'a'.repeat(64), 2400), // 3rd from same author -> capped
      ],
      trending24hNotes: [
        mk('h1', 'a'.repeat(64), 900), // duplicate -> skipped
        mk('t1', 'b'.repeat(64), 3600 * 6), // 6h ago
      ],
      relayTrendingNotes: [
        mk('r1', 'c'.repeat(64), 3600 * 10), // 10h ago
        mk('old', 'd'.repeat(64), 3600 * 24 * 30), // 30 days old -> dropped
        mk('fut', 'e'.repeat(64), -3600), // far future -> dropped
      ],
      nowSec: now,
    })

    expect(merged.map((e) => e.id)).toEqual(['h1', 'h2', 't1', 'r1'])
  })

  it('caps HLS levels cleanly for Mobile Data Saving mode and Audio-Only / muted downshift', () => {
    const zapStreamLevels = [
      { height: 1080, bitrate: 9_830_400 },
      { height: 720, bitrate: 5_030_400 },
      { height: 480, bitrate: 2_030_400 },
    ]
    expect(selectDataSaverMaxLevel(zapStreamLevels)).toBe(2)
    expect(selectLowestBitrateLevel(zapStreamLevels)).toBe(2)

    const cfLevels = [
      { height: 240, bitrate: 384_538 },
      { height: 360, bitrate: 636_270 },
      { height: 480, bitrate: 1_003_644 },
      { height: 720, bitrate: 1_782_562 },
    ]
    expect(selectDataSaverMaxLevel(cfLevels)).toBe(2) // 480p <= 480 & <= 2.2 Mbps
    expect(selectLowestBitrateLevel(cfLevels)).toBe(0) // 240p lowest for Audio-Only / muted

    // Single-bitrate streams return -1 (no ABR capping possible)
    expect(selectDataSaverMaxLevel([{ height: 720, bitrate: 11_059_200 }])).toBe(-1)
    expect(selectLowestBitrateLevel([{ height: 720, bitrate: 11_059_200 }])).toBe(-1)
  })

  it('enforces credentials: omit and referrerPolicy: no-referrer on Blossom and LNURL fetches and wipes notification state on logout', async () => {
    const signer = new LocalKeySigner(generateSecretKey())
    const seenInits: Array<RequestInit | undefined> = []

    const blossomFetch: typeof fetch = async (_input, init) => {
      seenInits.push(init)
      return new Response(
        JSON.stringify({
          url: 'https://blossom.nostr.build/ok.bin',
          size: 4,
          type: 'application/octet-stream',
        }),
        { status: 200 },
      )
    }
    await uploadToBlossom(
      new Blob(['test'], { type: 'application/octet-stream' }),
      'application/octet-stream',
      signer,
      [],
      blossomFetch,
    )

    const lnurlFetch: typeof fetch = async (input, init) => {
      seenInits.push(init)
      const u = String(input)
      if (u.includes('.well-known/lnurlp')) {
        return new Response(
          JSON.stringify({
            callback: 'https://ln.example/cb',
            minSendable: 1000,
            maxSendable: 1_000_000_000,
            allowsNostr: false,
          }),
          { status: 200 },
        )
      }
      return new Response(JSON.stringify({ pr: 'lnbc210n1p0privacytest' }), { status: 200 })
    }
    await requestZapInvoice({
      lud16: 'alice@ln.example',
      amountSats: 21,
      recipientPubkey: 'a'.repeat(64),
      relays: ['wss://firewisp.relay.rtard.de'],
      fetchImpl: lnurlFetch,
    })

    expect(seenInits).toHaveLength(3)
    for (const init of seenInits) {
      expect(init?.credentials).toBe('omit')
      expect(init?.referrerPolicy).toBe('no-referrer')
    }
    signer.destroy()

    // Verify resetUserState wipes firewisp_notif_seen_v1, bookmarks, profiles cache, and private session mutes
    const storeMap = new Map<string, string>([
      ['firewisp_notif_seen_v1', JSON.stringify({ ['a'.repeat(64)]: 1700000000 })],
      ['firewisp_bookmarks_v1', JSON.stringify(['b'.repeat(64)])],
      ['firewisp_profiles_cache_v1', JSON.stringify({})],
    ])
    const prevLs = (globalThis as { localStorage?: Storage }).localStorage
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (k: string) => storeMap.get(k) ?? null,
        setItem: (k: string, v: string) => storeMap.set(k, v),
        removeItem: (k: string) => storeMap.delete(k),
        clear: () => storeMap.clear(),
      },
    })
    try {
      useSettingsStore.getState().mergePrivateMutes({ pubkeys: ['c'.repeat(64)] })
      useSettingsStore
        .getState()
        .setNwcUri(
          `nostr+walletconnect://${'a'.repeat(64)}?relay=wss://relay.getalby.com/v1&secret=${'b'.repeat(64)}`,
          true,
        )
      expect(useSettingsStore.getState().privateMutedPubkeys).toContain('c'.repeat(64))

      // Verify per-notification read tracking decrements one by one until all are read
      const testPk = 'd'.repeat(64)
      useNostrStore.setState({ notificationsLastSeenAt: 1_700_000_000, readNotificationIds: {} })
      useNostrStore.getState().markNotificationRead(testPk, 'notif-1')
      expect(useNostrStore.getState().readNotificationIds['notif-1']).toBe(true)
      expect(useNostrStore.getState().readNotificationIds['notif-2']).toBeUndefined()
      expect(JSON.parse(storeMap.get('firewisp_notif_seen_v1') || '{}')[testPk]?.readIds).toEqual([
        'notif-1',
      ])
      useNostrStore.getState().markNotificationsRead(testPk, 1_700_000_500)
      expect(useNostrStore.getState().readNotificationIds).toEqual({})
      expect(useNostrStore.getState().notificationsLastSeenAt).toBeGreaterThanOrEqual(1_700_000_500)

      useNostrStore.getState().resetUserState()
      expect(storeMap.has('firewisp_notif_seen_v1')).toBe(false)
      expect(storeMap.has('firewisp_bookmarks_v1')).toBe(false)
      expect(storeMap.has('firewisp_profiles_cache_v1')).toBe(false)
      expect(useNostrStore.getState().readNotificationIds).toEqual({})
      expect(useSettingsStore.getState().privateMutedPubkeys).toEqual([])
      // Remembered NWC wallet stays stored until explicitly removed by the user
      expect(useSettingsStore.getState().nwcUri).toContain('nostr+walletconnect://')
      expect(storeMap.has('firewisp_nwc_v1')).toBe(true)
      useSettingsStore.getState().setNwcUri('')
      expect(storeMap.has('firewisp_nwc_v1')).toBe(false)
    } finally {
      if (prevLs === undefined) {
        delete (globalThis as { localStorage?: Storage }).localStorage
      } else {
        Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: prevLs })
      }
    }
  })

  it('safely mutates, encrypts, serializes, and fails-closed on NIP-51 kind-10000 global mute sync', async () => {
    const {
      applyMuteListMutations,
      computeNextReplaceableCreatedAt,
      decryptMuteListContent,
      encryptMuteListTags,
      KIND_MUTE_LIST,
      parsePrivateMuteTagsJson,
    } = await import('../nostr/lists')
    const { nostrPool } = await import('../nostr/pool')
    const { useAuthStore } = await import('../store/useAuthStore')
    const { useNostrStore } = await import('../store/useNostrStore')
    const { useSettingsStore } = await import('../store/useSettingsStore')

    const pkA = 'a'.repeat(64)
    const pkB = 'b'.repeat(64)
    const pkC = 'c'.repeat(64)
    const pkD = 'd'.repeat(64)
    const threadId = 'e'.repeat(64)

    // 1. Pure helper tests: preserves e/t/word/unknown tags, adds privately, removes from both
    const mut1 = applyMuteListMutations({
      publicTags: [
        ['p', pkA, 'wss://relay.damus.io'],
        ['client', 'other-app'],
      ],
      privateTags: [
        ['p', pkB],
        ['e', threadId],
        ['t', 'spam'],
        ['word', 'airdrop'],
        ['custom', 'keep-me'],
      ],
      mutations: [
        { op: 'add', type: 'p', value: pkC.toUpperCase() },
        { op: 'add', type: 'p', value: pkA }, // already public — should not duplicate
      ],
    })
    expect(mut1.changed).toBe(true)
    expect(mut1.publicTags).toEqual([
      ['p', pkA, 'wss://relay.damus.io'],
      ['client', 'other-app'],
    ])
    expect(mut1.privateTags).toEqual([
      ['p', pkB],
      ['e', threadId],
      ['t', 'spam'],
      ['word', 'airdrop'],
      ['custom', 'keep-me'],
      ['p', pkC],
    ])

    // Removing removes from both public and private while keeping everything else
    const mut2 = applyMuteListMutations({
      publicTags: mut1.publicTags,
      privateTags: mut1.privateTags,
      mutations: [
        { op: 'remove', type: 'p', value: pkA },
        { op: 'remove', type: 'p', value: pkB },
      ],
    })
    expect(mut2.changed).toBe(true)
    expect(mut2.publicTags).toEqual([['client', 'other-app']])
    expect(mut2.privateTags).toEqual([
      ['e', threadId],
      ['t', 'spam'],
      ['word', 'airdrop'],
      ['custom', 'keep-me'],
      ['p', pkC],
    ])

    // Fail-closed JSON parsing & monotonic created_at
    expect(parsePrivateMuteTagsJson('not-json')).toBeNull()
    expect(parsePrivateMuteTagsJson('{"not":"array"}')).toBeNull()
    expect(computeNextReplaceableCreatedAt({ created_at: 2_000_000_000 }, 1_700_000_000)).toBe(
      2_000_000_001,
    )

    // 2. Real NIP-44 + NIP-04 roundtrip with LocalKeySigner
    const sk = generateSecretKey()
    const signer = new LocalKeySigner(sk)
    const sampleTags: string[][] = [
      ['p', pkB],
      ['e', threadId],
      ['word', 'crypto'],
    ]
    const nip44Cipher = await encryptMuteListTags(signer, signer.pubkey, sampleTags)
    const nip44Dec = await decryptMuteListContent(signer, signer.pubkey, nip44Cipher)
    expect(nip44Dec?.tags).toEqual(sampleTags)
    expect(nip44Dec?.scheme).toBe('nip44')

    const nip04Cipher = await signer.nip04Encrypt(signer.pubkey, JSON.stringify(sampleTags))
    const nip04Dec = await decryptMuteListContent(signer, signer.pubkey, nip04Cipher)
    expect(nip04Dec?.tags).toEqual(sampleTags)
    expect(nip04Dec?.scheme).toBe('nip04')

    // 3. End-to-end store tests with mocked nostrPool.query / publish
    const initialPrivateTags: string[][] = [
      ['p', pkB],
      ['e', threadId],
      ['word', 'scam'],
    ]
    const initialEvent = await signer.signEvent({
      kind: KIND_MUTE_LIST,
      created_at: 1_700_000_100,
      tags: [['p', pkA]],
      content: await encryptMuteListTags(signer, signer.pubkey, initialPrivateTags),
    })

    let latestRelayEvent = initialEvent
    const publishedEvents: Array<typeof initialEvent> = []
    const origQuery = nostrPool.query.bind(nostrPool)
    const origPublish = nostrPool.publish.bind(nostrPool)
    const prevAuth = useAuthStore.getState()

    nostrPool.query = (async () => [latestRelayEvent]) as typeof nostrPool.query
    nostrPool.publish = (async (relays, ev) => {
      publishedEvents.push(ev)
      latestRelayEvent = ev
      return relays.map((relay) => ({ relay, ok: true }))
    }) as typeof nostrPool.publish

    try {
      useNostrStore.getState().resetUserState()
      useSettingsStore.setState({ mutedPubkeys: [], mutedHashtags: [], mutedWords: [] })
      useAuthStore.setState({ signer, pubkey: signer.pubkey, method: 'local' })

      // Rapid back-to-back blocks MUST serialize without losing either pubkey or any existing tags!
      const [r1, r2] = await Promise.all([
        useNostrStore.getState().blockPubkey(pkC, 'Spammer C'),
        useNostrStore.getState().blockPubkey(pkD, 'Spammer D'),
      ])
      expect(r1.synced).toBe(true)
      expect(r2.synced).toBe(true)
      expect(publishedEvents).toHaveLength(2)
      expect(publishedEvents[1].created_at).toBeGreaterThan(publishedEvents[0].created_at)

      const finalDec = await decryptMuteListContent(signer, signer.pubkey, latestRelayEvent.content)
      expect(finalDec?.tags).toEqual([
        ['p', pkB],
        ['e', threadId],
        ['word', 'scam'],
        ['p', pkC],
        ['p', pkD],
      ])
      expect(latestRelayEvent.tags).toEqual([['p', pkA]])
      expect(useSettingsStore.getState().privateMutedPubkeys).toContain(pkC)
      expect(useSettingsStore.getState().privateMutedPubkeys).toContain(pkD)
      // Private-only synced blocks must NOT leak into localStorage-persisted mutedPubkeys
      expect(useSettingsStore.getState().mutedPubkeys).not.toContain(pkC)
      expect(useSettingsStore.getState().mutedPubkeys).not.toContain(pkD)

      // Unblocking pkA (public) and pkC (private) removes both and keeps everything else intact
      const u1 = await useNostrStore.getState().unblockPubkey(pkA)
      const u2 = await useNostrStore.getState().unblockPubkey(pkC)
      expect(u1.synced).toBe(true)
      expect(u2.synced).toBe(true)
      expect(latestRelayEvent.tags).toEqual([])
      const afterUnblock = await decryptMuteListContent(
        signer,
        signer.pubkey,
        latestRelayEvent.content,
      )
      expect(afterUnblock?.tags).toEqual([
        ['p', pkB],
        ['e', threadId],
        ['word', 'scam'],
        ['p', pkD],
      ])

      // Push local-only blocks to encrypted Nostr kind-10000 and scrub them from localStorage
      const pkLocal = 'f'.repeat(64)
      useSettingsStore.getState().mutePubkey(pkLocal)
      const pushRes = await useNostrStore.getState().pushLocalMutesToNostr()
      expect(pushRes.pushedCount).toBe(1)
      expect(pushRes.okCount).toBeGreaterThan(0)
      expect(useSettingsStore.getState().mutedPubkeys).not.toContain(pkLocal)
      expect(useSettingsStore.getState().privateMutedPubkeys).toContain(pkLocal)

      // CRITICAL FAIL-CLOSED TEST: if signer rejects decryption on a fresh encrypted remote event,
      // blockPubkey MUST NOT publish/overwrite the remote kind-10000 event!
      const countBeforeLocked = publishedEvents.length
      useNostrStore.getState().resetUserState()
      const lockedSigner = {
        method: 'nip07' as const,
        pubkey: signer.pubkey,
        canSign: true,
        canEncrypt: true,
        signEvent: (tpl: Parameters<typeof signer.signEvent>[0]) => signer.signEvent(tpl),
        nip44Encrypt: (p: string, t: string) => signer.nip44Encrypt(p, t),
        nip44Decrypt: async () => {
          throw new Error('User rejected decryption')
        },
        nip04Decrypt: async () => {
          throw new Error('User rejected decryption')
        },
        destroy: () => {},
      }
      useAuthStore.setState({ signer: lockedSigner, pubkey: signer.pubkey, method: 'nip07' })
      const pkLocked = '1'.repeat(64)
      const lockedRes = await useNostrStore.getState().blockPubkey(pkLocked)
      expect(lockedRes.synced).toBe(false)
      expect(publishedEvents).toHaveLength(countBeforeLocked)
      // Still blocked locally so UX doesn't break
      expect(useSettingsStore.getState().mutedPubkeys).toContain(pkLocked)
    } finally {
      nostrPool.query = origQuery
      nostrPool.publish = origPublish
      useNostrStore.getState().resetUserState()
      useSettingsStore.setState({ mutedPubkeys: [], mutedHashtags: [], mutedWords: [] })
      useAuthStore.setState({
        signer: prevAuth.signer,
        pubkey: prevAuth.pubkey,
        method: prevAuth.method,
      })
      signer.destroy()
    }
  })

  it('extracts bare-domain mute candidates, flags evmnest spam, and syncs NIP-51 muted words', async () => {
    const cands = extractMuteCandidates(
      '💎 Wow, AI audit actually works. Claim yours here: ai.evmnest.cc/?ref=ps2svl https://example.com/pic.png',
    )
    expect(cands).toContain('evmnest')
    expect(cands).toContain('ai.evmnest.cc')
    expect(cands).toContain('ai audit')
    expect(cands).not.toContain('pic.png')

    const spam = evaluateNoteSpam(
      {
        id: 'c'.repeat(64),
        pubkey: 'd'.repeat(64),
        kind: 1,
        tags: [],
        content: 'Flash eth airdrop campaign. Register now: ai.evmnest.cc/?ref=tq92qo',
      },
      { myPubkey: 'a'.repeat(64), follows: new Set() },
    )
    expect(spam.isSpam).toBe(true)

    const { useAuthStore } = await import('../store/useAuthStore')
    const { useNostrStore } = await import('../store/useNostrStore')
    const { useSettingsStore } = await import('../store/useSettingsStore')
    const { nostrPool } = await import('../nostr/pool')

    const prevAuth = useAuthStore.getState()
    const origQuery = nostrPool.query.bind(nostrPool)
    const origPublish = nostrPool.publish.bind(nostrPool)
    const signer = new LocalKeySigner(generateSecretKey())
    const publishedEvents: Array<Awaited<ReturnType<typeof signer.signEvent>>> = []

    try {
      // Signed-out local fallback + zero-width obfuscation check
      useAuthStore.setState({ signer: null, pubkey: null, method: null })
      useNostrStore.getState().resetUserState()
      useSettingsStore.setState({ mutedPubkeys: [], mutedHashtags: [], mutedWords: [] })

      const localRes = await useNostrStore.getState().muteWordGlobal('Evmnest')
      expect(localRes.synced).toBe(false)
      expect(useSettingsStore.getState().mutedWords).toContain('evmnest')
      expect(
        useNostrStore.getState().isEventMuted({
          id: '1'.repeat(64),
          pubkey: '2'.repeat(64),
          created_at: 1795700000,
          kind: 1,
          tags: [],
          content: 'Claim here: ai.e\u200Bvmnest.cc/?ref=abc',
          sig: '3'.repeat(128),
        }),
      ).toBe(true)

      // Signed-in encrypted NIP-51 kind-10000 sync
      useSettingsStore.setState({ mutedPubkeys: [], mutedHashtags: [], mutedWords: [] })
      useAuthStore.setState({ signer, pubkey: signer.pubkey, method: 'local' })
      useSettingsStore.setState({
        relays: [{ url: 'wss://relay.firewisp.de', read: true, write: true }],
      })
      nostrPool.query = (async () => [...publishedEvents]) as typeof nostrPool.query
      nostrPool.publish = (async (relays, ev) => {
        publishedEvents.push(ev as Awaited<ReturnType<typeof signer.signEvent>>)
        return relays.map((relay) => ({ relay, ok: true }))
      }) as typeof nostrPool.publish

      const globalRes = await useNostrStore.getState().muteWordGlobal('evmnest')
      expect(globalRes.synced).toBe(true)
      expect(useSettingsStore.getState().privateMutedWords).toContain('evmnest')
      const decrypted = JSON.parse(
        await signer.nip44Decrypt(signer.pubkey, publishedEvents[0].content),
      ) as string[][]
      expect(decrypted).toContainEqual(['word', 'evmnest'])
    } finally {
      nostrPool.query = origQuery
      nostrPool.publish = origPublish
      useNostrStore.getState().resetUserState()
      useSettingsStore.setState({ mutedPubkeys: [], mutedHashtags: [], mutedWords: [] })
      useAuthStore.setState({
        signer: prevAuth.signer,
        pubkey: prevAuth.pubkey,
        method: prevAuth.method,
      })
      signer.destroy()
    }
  })
})
