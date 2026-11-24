import type Hls from 'hls.js'
import type { HlsConfig, LoaderContext, LoaderConfiguration, LoaderCallbacks } from 'hls.js'
import { sanitizePublicHttpsUrl } from '../sanitize'

/**
 * Wraps HLS.js's default loader so EVERY sub-playlist, media segment, and
 * `#EXT-X-KEY` URI referenced inside an untrusted `.m3u8` manifest is validated
 * against `sanitizePublicHttpsUrl` (blocking cleartext http://, credentials,
 * localhost, RFC1918 LAN, link-local, and cloud metadata SSRF), and sends
 * zero `Referer` / credentials.
 */
export function createSafeHlsConfig(
  HlsCtor: typeof Hls,
  overrides: Partial<HlsConfig> = {},
): Partial<HlsConfig> {
  const BaseLoader = HlsCtor.DefaultConfig.loader

  class SafePublicHttpsLoader extends BaseLoader {
    override load(
      context: LoaderContext,
      config: LoaderConfiguration,
      callbacks: LoaderCallbacks<LoaderContext>,
    ): void {
      const safeUrl = sanitizePublicHttpsUrl(context.url)
      if (!safeUrl) {
        callbacks.onError(
          { code: 0, text: 'Blocked unsafe or non-public HLS resource URL' },
          context,
          null,
          this.stats,
        )
        return
      }
      context.url = safeUrl
      super.load(context, config, callbacks)
    }
  }

  return {
    enableWorker: false, // Required by strict CSP worker-src 'self'
    loader: SafePublicHttpsLoader as unknown as HlsConfig['loader'],
    xhrSetup: (xhr: XMLHttpRequest) => {
      xhr.withCredentials = false
    },
    fetchSetup: (context: { url: string }, initParams: RequestInit) => {
      const safeUrl = sanitizePublicHttpsUrl(context.url)
      if (!safeUrl) {
        throw new Error('Blocked unsafe or non-public HLS resource URL')
      }
      return new Request(safeUrl, {
        ...initParams,
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      })
    },
    ...overrides,
  }
}
