import { finalizeEvent, getPublicKey, verifyEvent } from 'nostr-tools/pure'
import { SimplePool } from 'nostr-tools/pool'
import * as nip04 from 'nostr-tools/nip04'
import { hexToBytes } from 'nostr-tools/utils'
import type { FireWispSigner } from './signer'
import { sanitizePublicHttpsUrl, sanitizeRelayUrl } from '../sanitize'

export interface LnurlPayMetadata {
  callback: string
  minSendable: number
  maxSendable: number
  allowsNostr?: boolean
  nostrPubkey?: string
}

export interface ParsedNwcUri {
  walletPubkey: string
  relay: string
  secretHex: string
}

export function parseNwcUri(raw: string): ParsedNwcUri | null {
  const trimmed = raw.trim()
  if (!trimmed.startsWith('nostr+walletconnect://')) return null
  try {
    const normalized = trimmed.replace('nostr+walletconnect://', 'https://')
    const url = new URL(normalized)
    const walletPubkey = url.hostname.toLowerCase()
    const relay = sanitizeRelayUrl(url.searchParams.get('relay'))
    const secretHex = (url.searchParams.get('secret') || '').toLowerCase()
    if (!/^[0-9a-f]{64}$/.test(walletPubkey)) return null
    if (!relay) return null
    if (!/^[0-9a-f]{64}$/.test(secretHex)) return null
    return { walletPubkey, relay, secretHex }
  } catch {
    return null
  }
}

export function resolveLud16ToUrl(lud16: string): string | null {
  const parts = lud16.trim().split('@')
  if (parts.length !== 2) return null
  const [name, domain] = parts
  if (!name || !domain || !/^[a-z0-9._-]+$/i.test(name)) return null
  return sanitizePublicHttpsUrl(`https://${domain}/.well-known/lnurlp/${encodeURIComponent(name)}`)
}

export async function fetchLnurlPayMetadata(
  lud16: string,
  fetchImpl: typeof fetch = fetch,
): Promise<LnurlPayMetadata> {
  const url = resolveLud16ToUrl(lud16)
  if (!url) throw new Error('Invalid or unsafe Lightning Address')

  const resp = await fetchImpl(url, { headers: { Accept: 'application/json' } })
  if (!resp.ok) throw new Error(`Lightning provider returned HTTP ${resp.status}`)
  const data = (await resp.json()) as Partial<LnurlPayMetadata> & { status?: string; reason?: string }
  if (data.status === 'ERROR') {
    throw new Error(data.reason || 'Lightning provider returned an error')
  }
  const safeCallback = sanitizePublicHttpsUrl(data.callback)
  if (!safeCallback) {
    throw new Error('Lightning provider callback URL failed safety checks')
  }
  return {
    callback: safeCallback,
    minSendable: Number(data.minSendable) || 1000,
    maxSendable: Number(data.maxSendable) || 100_000_000_000,
    allowsNostr: Boolean(data.allowsNostr),
    nostrPubkey: data.nostrPubkey,
  }
}

export function parseBolt11AmountSats(invoice: string): number | null {
  const m = invoice.trim().toLowerCase().match(/^lnbc(\d+)([munp])1/)
  if (!m) return null
  const num = Number(m[1])
  if (!Number.isFinite(num) || num <= 0) return null
  switch (m[2]) {
    case 'm':
      return Math.round(num * 100_000)
    case 'u':
      return Math.round(num * 100)
    case 'n':
      return Math.round(num * 0.1)
    case 'p':
      return Math.round(num * 0.0001)
    default:
      return null
  }
}

export async function requestZapInvoice(params: {
  lud16: string
  amountSats: number
  recipientPubkey: string
  eventId?: string
  comment?: string
  relays: string[]
  signer?: FireWispSigner | null
  fetchImpl?: typeof fetch
}): Promise<string> {
  const fetchFn = params.fetchImpl || fetch
  const meta = await fetchLnurlPayMetadata(params.lud16, fetchFn)
  const amountMsats = Math.round(params.amountSats * 1000)
  if (amountMsats < meta.minSendable || amountMsats > meta.maxSendable) {
    throw new Error(
      `Amount must be between ${Math.ceil(meta.minSendable / 1000)} and ${Math.floor(meta.maxSendable / 1000)} sats`,
    )
  }

  const cbUrl = new URL(meta.callback)
  cbUrl.searchParams.set('amount', String(amountMsats))

  if (meta.allowsNostr && params.signer?.canSign) {
    const tags: string[][] = [
      ['relays', ...params.relays.slice(0, 6)],
      ['amount', String(amountMsats)],
      ['p', params.recipientPubkey],
    ]
    if (params.eventId) tags.push(['e', params.eventId])
    const zapRequest = await params.signer.signEvent({
      kind: 9734,
      created_at: Math.floor(Date.now() / 1000),
      content: params.comment?.trim() || '',
      tags,
    })
    cbUrl.searchParams.set('nostr', JSON.stringify(zapRequest))
  } else if (params.comment?.trim()) {
    cbUrl.searchParams.set('comment', params.comment.trim().slice(0, 200))
  }

  const resp = await fetchFn(cbUrl.toString())
  if (!resp.ok) throw new Error(`Invoice fetch failed (HTTP ${resp.status})`)
  const data = (await resp.json()) as { pr?: string; status?: string; reason?: string }
  if (data.status === 'ERROR' || !data.pr) {
    throw new Error(data.reason || 'Lightning provider did not return an invoice')
  }
  const invoice = data.pr.trim()
  if (!/^lnbc[0-9a-z]+$/i.test(invoice)) {
    throw new Error('Provider returned an invalid or non-mainnet BOLT-11 invoice')
  }
  // CRITICAL: Pre-pay BOLT-11 amount verification (fail-closed against malicious LNURL servers)
  const invoicedSats = parseBolt11AmountSats(invoice)
  if (invoicedSats === null || invoicedSats !== Math.round(params.amountSats)) {
    throw new Error(
      `Invoice amount mismatch: requested ${params.amountSats} sats, provider returned ${invoicedSats ?? 'amountless'} sats`,
    )
  }
  return invoice
}

export async function payInvoiceWithWebln(invoice: string): Promise<string> {
  if (!window.webln) throw new Error('WebLN wallet not detected in browser')
  await window.webln.enable()
  const res = await window.webln.sendPayment(invoice)
  return res.preimage
}

export async function payInvoiceWithNwc(nwcUri: string, invoice: string): Promise<string> {
  const parsed = parseNwcUri(nwcUri)
  if (!parsed) throw new Error('Invalid NWC connection URI')

  const secretBytes = hexToBytes(parsed.secretHex)
  const clientPubkey = getPublicKey(secretBytes)
  const pool = new SimplePool()

  try {
    const reqPayload = JSON.stringify({
      method: 'pay_invoice',
      params: { invoice },
    })
    const encrypted = await nip04.encrypt(parsed.secretHex, parsed.walletPubkey, reqPayload)
    const reqEvent = finalizeEvent(
      {
        kind: 23194,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['p', parsed.walletPubkey]],
        content: encrypted,
      },
      secretBytes,
    )

    const responsePromise = new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        sub.close()
        reject(new Error('NWC wallet payment timed out (25s)'))
      }, 25000)

      const sub = pool.subscribeMany(
        [parsed.relay],
        {
          kinds: [23195],
          authors: [parsed.walletPubkey],
          '#p': [clientPubkey],
          '#e': [reqEvent.id],
          limit: 1,
        },
        {
          onevent: async (ev) => {
            if (!verifyEvent(ev) || ev.pubkey.toLowerCase() !== parsed.walletPubkey) {
              return
            }
            clearTimeout(timeout)
            sub.close()
            try {
              const dec = await nip04.decrypt(parsed.secretHex, parsed.walletPubkey, ev.content)
              const parsedResp = JSON.parse(dec) as {
                error?: { message?: string; code?: string }
                result?: { preimage?: string }
              }
              if (parsedResp.error) {
                reject(new Error(parsedResp.error.message || parsedResp.error.code || 'NWC error'))
              } else {
                resolve(parsedResp.result?.preimage || 'paid')
              }
            } catch (e) {
              reject(e instanceof Error ? e : new Error(String(e)))
            }
          },
        },
      )
    })

    await Promise.any(pool.publish([parsed.relay], reqEvent))
    return await responsePromise
  } finally {
    secretBytes.fill(0)
    pool.close([parsed.relay])
  }
}
