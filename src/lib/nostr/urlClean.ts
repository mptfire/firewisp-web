/**
 * Safe universal & platform-scoped URL tracking-parameter stripper.
 * Strips known cross-site/share trackers without breaking authentication,
 * presigned media signatures, search queries, or product/episode selection.
 */

import { ALLOWED_YT_HOSTS as YOUTUBE_HOSTS } from './youtube'

const URL_TOKEN_RE = /https?:\/\/[^\s<>"{}|\\^`[\]]+/g

// Signed cloud/media URLs & OAuth/magic-link callbacks must NEVER be rewritten.
const SENSITIVE_QUERY_KEYS = new Set([
  'x-amz-signature',
  'x-amz-algorithm',
  'x-amz-credential',
  'x-amz-security-token',
  'x-goog-signature',
  'x-goog-algorithm',
  'signature',
  'sig',
  'policy',
  'key-pair-id',
  'code',
  'state',
  'redirect_uri',
  'token',
  'auth',
  'access_token',
  'id_token',
])

const SENSITIVE_PATH_RE = /\/(?:oauth|authorize|callback|unsubscribe|login)(?:\/|$)/i

const GLOBAL_TRACKING_KEYS = new Set([
  'gclid',
  'gclsrc',
  'dclid',
  'gbraid',
  'wbraid',
  'srsltid',
  'fbclid',
  'fb_action_ids',
  'fb_action_types',
  'fb_source',
  'fb_ref',
  'igshid',
  'igsh',
  'msclkid',
  'twclid',
  'ttclid',
  'li_fat_id',
  'yclid',
  '_openstat',
  'mc_cid',
  'mc_eid',
  '_hsenc',
  '_hsmi',
  '__hsfp',
  '__hssc',
  '__hstc',
  'hsctatracking',
  'mkt_tok',
  'vero_id',
  'vero_conv',
  'oly_anon_id',
  'oly_enc_id',
  'pk_campaign',
  'pk_kwd',
  'pk_source',
  'pk_medium',
  'pk_content',
  'mtm_source',
  'mtm_medium',
  'mtm_campaign',
  'mtm_keyword',
  'mtm_content',
  'mtm_cid',
  's_cid',
  'icid',
  'cmpid',
  'ncid',
  'wickedid',
  'rb_clickid',
  'guccounter',
  'guce_referrer',
  'guce_referrer_sig',
  'at_medium',
  'at_campaign',
  'at_campaign_group',
  'at_creation',
  'at_format',
  'at_link_id',
  'at_link_origin',
  'at_link_type',
  'at_ptr_name',
  'at_bbc_team',
  'at_custom1',
  'at_custom2',
  'at_custom3',
  'at_custom4',
  'xtor',
])

const YOUTUBE_TRACKING_KEYS = new Set([
  'si',
  'pp',
  'feature',
  'ab_channel',
  'app',
  'cbrd',
  'ucbcb',
  'source_ve_path',
  'embeds_referring_euri',
  'embeds_referring_origin',
  'kw',
])

const SPOTIFY_TRACKING_KEYS = new Set(['si', 'dlsi', 'sp_cid', 'pi', 'referral'])
const X_TRACKING_KEYS = new Set(['s', 't', 'ref_src', 'ref_url', 'cxt', 'cn'])
const IG_TRACKING_KEYS = new Set(['ig_rid', 'ig_mid'])
const REDDIT_TRACKING_KEYS = new Set([
  'rdt',
  'share_id',
  'ref_source',
  'ref_campaign',
  'correlation_id',
  'ref',
])
const TIKTOK_TRACKING_KEYS = new Set([
  'is_from_webapp',
  'sender_device',
  'sender_web_id',
  'is_copy_url',
  'share_app_id',
  'share_link_id',
  'share_item_id',
  'social_sharing',
  '_r',
  '_t',
  'u_code',
  'sec_uid',
  'sec_user_id',
  'checksum',
  'tt_from',
  'enter_from',
  'enter_method',
])
const AMAZON_TRACKING_KEYS = new Set([
  'tag',
  'linkcode',
  'linkid',
  'ref_',
  'pf_rd_r',
  'pf_rd_p',
  'pf_rd_m',
  'pf_rd_s',
  'pf_rd_t',
  'pf_rd_i',
  'pd_rd_r',
  'pd_rd_w',
  'pd_rd_wg',
  'pd_rd_i',
  'qid',
  'sr',
  'sprefix',
  'crid',
  'dib',
  'dib_tag',
  'dchild',
  'keywords',
  'hvadid',
  'hvdev',
  'hvlocphy',
  'hvnetw',
  'hvqmt',
  'hvrand',
  'hvtargid',
  'hydadcr',
  'mcid',
  'camp',
  'creative',
  'creativeasin',
])
const SUBSTACK_TRACKING_KEYS = new Set([
  'r',
  'triedredirect',
  'publication_id',
  'post_id',
  'isfreemail',
  'open',
])
const APPLE_MEDIA_TRACKING_KEYS = new Set(['itsct', 'itscg', 'at', 'ct', 'mt', 'ls', 'app'])
const SOUNDCLOUD_TRACKING_KEYS = new Set(['si', 'ref'])
const META_THREAD_FB_TRACKING_KEYS = new Set(['xmt', 'slof', 'mibextid', 'rdid', 'share_url'])
const LINKEDIN_TRACKING_KEYS = new Set([
  'trk',
  'trkinfo',
  'trackingid',
  'lipi',
  'licu',
  'rcm',
  'originalsubdomain',
])
const MEDIUM_TRACKING_KEYS = new Set(['source'])

function matchesHost(host: string, base: string): boolean {
  return host === base || host.endsWith(`.${base}`)
}

function getHostScopedTrackingSet(host: string): Set<string> | null {
  if (YOUTUBE_HOSTS.has(host) || matchesHost(host, 'youtube.com')) return YOUTUBE_TRACKING_KEYS
  if (matchesHost(host, 'spotify.com')) return SPOTIFY_TRACKING_KEYS
  if (matchesHost(host, 'x.com') || matchesHost(host, 'twitter.com')) return X_TRACKING_KEYS
  if (matchesHost(host, 'instagram.com')) return IG_TRACKING_KEYS
  if (matchesHost(host, 'reddit.com')) return REDDIT_TRACKING_KEYS
  if (matchesHost(host, 'tiktok.com')) return TIKTOK_TRACKING_KEYS
  if (/^(?:(?:www|m)\.)?amazon\.[a-z.]{2,10}$/i.test(host)) return AMAZON_TRACKING_KEYS
  if (matchesHost(host, 'substack.com')) return SUBSTACK_TRACKING_KEYS
  if (host === 'music.apple.com' || host === 'podcasts.apple.com') return APPLE_MEDIA_TRACKING_KEYS
  if (host === 'soundcloud.com' || host === 'm.soundcloud.com') return SOUNDCLOUD_TRACKING_KEYS
  if (
    matchesHost(host, 'threads.net') ||
    matchesHost(host, 'threads.com') ||
    matchesHost(host, 'facebook.com')
  ) {
    return META_THREAD_FB_TRACKING_KEYS
  }
  if (matchesHost(host, 'linkedin.com')) return LINKEDIN_TRACKING_KEYS
  if (matchesHost(host, 'medium.com')) return MEDIUM_TRACKING_KEYS
  return null
}

function isTrackingParam(lowerKey: string, hostScoped: Set<string> | null): boolean {
  if (lowerKey.startsWith('utm_')) return true
  if (GLOBAL_TRACKING_KEYS.has(lowerKey)) return true
  return hostScoped ? hostScoped.has(lowerKey) : false
}

export function cleanTrackingUrl(rawUrl: string): { url: string; removedParams: string[] } {
  if (!rawUrl || !/^https?:\/\//i.test(rawUrl)) {
    return { url: rawUrl, removedParams: [] }
  }
  try {
    const u = new URL(rawUrl)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      return { url: rawUrl, removedParams: [] }
    }
    if (!u.search || u.search === '?') {
      return { url: rawUrl, removedParams: [] }
    }
    if (SENSITIVE_PATH_RE.test(u.pathname)) {
      return { url: rawUrl, removedParams: [] }
    }

    const keys = [...u.searchParams.keys()]
    for (const k of keys) {
      if (SENSITIVE_QUERY_KEYS.has(k.toLowerCase())) {
        return { url: rawUrl, removedParams: [] }
      }
    }

    const host = u.hostname.toLowerCase()
    const hostScoped = getHostScopedTrackingSet(host)
    const keysToDelete: string[] = []
    for (const k of new Set(keys)) {
      if (isTrackingParam(k.toLowerCase(), hostScoped)) {
        keysToDelete.push(k)
      }
    }

    if (keysToDelete.length === 0) {
      return { url: rawUrl, removedParams: [] }
    }

    for (const k of keysToDelete) {
      u.searchParams.delete(k)
    }

    return { url: u.toString(), removedParams: keysToDelete }
  } catch {
    return { url: rawUrl, removedParams: [] }
  }
}

export function stripTrackingParamsInText(text: string): {
  text: string
  removedParams: string[]
} {
  if (!text || (!text.includes('http://') && !text.includes('https://'))) {
    return { text, removedParams: [] }
  }
  const removedAll: string[] = []
  let changed = false
  const cleanedText = text.replace(URL_TOKEN_RE, (token) => {
    const trimmed = token.replace(/[),.;!?]+$/, '')
    const trailing = token.slice(trimmed.length)
    const res = cleanTrackingUrl(trimmed)
    if (res.removedParams.length === 0) return token
    changed = true
    removedAll.push(...res.removedParams)
    return `${res.url}${trailing}`
  })

  return {
    text: changed ? cleanedText : text,
    removedParams: [...new Set(removedAll)],
  }
}
