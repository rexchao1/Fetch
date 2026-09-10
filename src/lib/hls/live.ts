export function isLiveMediaPlaylist(text: string) {
  if (/#EXT-X-ENDLIST/im.test(text)) return false;
  if (/#EXT-X-PLAYLIST-TYPE:\s*VOD/i.test(text)) return false;
  if (/#EXT-X-PLAYLIST-TYPE:\s*(EVENT|LIVE)/i.test(text)) return true;
  return /#EXT-X-TARGETDURATION/i.test(text) || /#EXT-X-MEDIA-SEQUENCE/i.test(text);
}

export function urlLooksLive(url: string) {
  return /\/live\//i.test(url) || /\.isml/i.test(url) || /index\.fmp4\.m3u8/i.test(url);
}
