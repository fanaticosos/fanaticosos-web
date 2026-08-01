const allowedHosts = new Set(["music.fanaticosos.com", "musica.fanaticosos.com"]);

function parseWindowJson(html, variableName) {
  const escapedName = variableName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = html.match(new RegExp(`window\\.${escapedName}\\s*=\\s*("(?:[^"\\\\]|\\\\.)*")`));
  if (!match) throw new Error(`${variableName} is missing`);
  return JSON.parse(JSON.parse(match[1]));
}

export function parseNavidromeShare(html, shareUrl) {
  const baseUrl = new URL(shareUrl);
  if (baseUrl.protocol !== "https:" || !allowedHosts.has(baseUrl.hostname)) {
    throw new Error("Unsupported Navidrome share URL");
  }
  const share = parseWindowJson(html, "__SHARE_INFO__");
  const track = share?.tracks?.[0];
  if (!track?.id || !track?.title || !track?.artist) {
    throw new Error("Navidrome share does not contain a playable track");
  }
  const coverMatch = html.match(/<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']/i);
  const publishedCover = coverMatch ? new URL(coverMatch[1], baseUrl) : null;
  const coverUrl = publishedCover
    && publishedCover.protocol === "https:"
    && allowedHosts.has(publishedCover.hostname)
    && publishedCover.pathname.startsWith("/share/img/")
    ? publishedCover.href
    : new URL(`/share/img/${encodeURIComponent(track.id)}?size=600&square=true`, baseUrl).href;
  return {
    title: track.title,
    artist: track.artist,
    album: track.album || "",
    duration: Number(track.duration) || 0,
    coverUrl,
    streamUrl: new URL(`/share/s/${encodeURIComponent(track.id)}`, baseUrl).href,
  };
}

export async function fetchNavidromeShare(shareUrl, fetchImpl = fetch) {
  try {
    const response = await fetchImpl(shareUrl, { signal: AbortSignal.timeout(8_000) });
    if (!response.ok) return null;
    return parseNavidromeShare(await response.text(), shareUrl);
  } catch {
    return null;
  }
}
