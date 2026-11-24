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
  sanitizeRelayUrl,
} from '../sanitize'
import { extractEventHashtags, extractImetaMap, parseNoteContent } from '../nostr/content'
import { parseBolt11AmountSats, parseNwcUri, requestZapInvoice, resolveLud16ToUrl } from '../nostr/nip57'
import { evaluateNoteSpam, isTopLevelNote } from '../nostr/spamFilter'
import {
  buildLiveATag,
  decodeLiveNaddr,
  encodeLiveNaddr,
  isLiveStreamFresh,
  isPlayableStreamUrl,
  parseLiveActivity,
  shouldAcceptLiveActivityUpdate,
  sortLiveStreams,
} from '../nostr/nip53'
import { extractYouTubeRefsFromText, extractYouTubeVideo } from '../nostr/youtube'
import { parseSharedQueryParams } from '../shareTarget'

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
