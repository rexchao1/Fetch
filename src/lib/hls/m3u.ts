import { channelProxyPath, type Channel } from "./catalog";

export function buildM3U(
  channels: Channel[],
  origin: string,
  opts: { includeLogos: boolean; viaProxy: boolean },
) {
  const lines = ["#EXTM3U"];
  for (const channel of channels) {
    const logo = opts.includeLogos
      ? `${origin}/api/logo?m=${encodeURIComponent(channel.mark)}`
      : "";
    const attrs = [
      "-1",
      `tvg-id="${channel.id}"`,
      opts.includeLogos ? `tvg-logo="${logo}"` : "",
      `group-title="${escapeAttr(channel.group)}"`,
    ]
      .filter(Boolean)
      .join(" ");
    lines.push(`#EXTINF:${attrs},${escapeAttr(channel.name)}`);
    const url = opts.viaProxy
      ? `${origin}${channelProxyPath(channel)}`
      : channelUpstreamAbsolute(channel, origin);
    lines.push(url);
  }
  return lines.join("\n") + "\n";
}

function channelUpstreamAbsolute(channel: Channel, origin: string) {
  if (channel.url.startsWith("/")) return new URL(channel.url, origin).href;
  return channel.url;
}

function escapeAttr(value: string) {
  return value.replaceAll('"', "'");
}
