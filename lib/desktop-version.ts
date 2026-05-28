// GitHub Releases lookup for the Tauri-shipped desktop app.

const RELEASE_URL = 'https://api.github.com/repos/pagevamp/clocktopus/releases/latest';
const CACHE_MS = 6 * 60 * 60 * 1000;

interface DesktopReleaseCache {
  at: number;
  value: DesktopRelease | null;
}

let cache: DesktopReleaseCache | null = null;

export interface DesktopRelease {
  version: string;
  htmlUrl: string;
  publishedAt: string;
  downloadUrl: string | null;
}

export async function fetchLatestDesktopRelease(opts: { force?: boolean } = {}): Promise<DesktopRelease | null> {
  if (!opts.force && cache && Date.now() - cache.at < CACHE_MS) return cache.value;
  let value: DesktopRelease | null = null;
  try {
    const res = await fetch(RELEASE_URL, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'clocktopus' },
    });
    if (res.ok) {
      const body = (await res.json()) as {
        tag_name?: string;
        html_url?: string;
        published_at?: string;
        assets?: { name: string; browser_download_url: string }[];
      };
      const tag = body.tag_name ?? '';
      const version = tag.startsWith('v') ? tag.slice(1) : tag;
      const dmg = body.assets?.find((a) => a.name.toLowerCase().endsWith('.dmg'));
      value = {
        version,
        htmlUrl: body.html_url ?? '',
        publishedAt: body.published_at ?? '',
        downloadUrl: dmg?.browser_download_url ?? null,
      };
    }
  } catch {
    value = null;
  }
  cache = { at: Date.now(), value };
  return value;
}

export function __resetCacheForTests() {
  cache = null;
}
