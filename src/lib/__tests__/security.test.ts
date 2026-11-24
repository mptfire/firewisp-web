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

  it('refuses cleartext http:// inline media embedding', () => {
    const parsed = parseNoteContent({
      content: 'Cleartext image http://insecure.example/photo.png',
      tags: [],
    })
    expect(parsed.media).toHaveLength(0)
    expect(parsed.segments.some((s) => s.type === 'link')).toBe(true)
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

    // Followed accounts are always exempt
    expect(
      evaluateNoteSpam(
        { id: 'f'.repeat(64), pubkey: '9'.repeat(64), kind: 1, content: 'free btc', tags: [] },
        { follows: new Set(['9'.repeat(64)]) },
      ).isSpam,
    ).toBe(false)
  })
})
