# Fetch

I built Fetch because Jellyfin would not play streams that work fine in a browser.

It is a Mac app. [Download the disk image](https://github.com/rexchao1/Fetch/releases/latest/download/Fetch_0.1.0_aarch64.dmg) for Apple Silicon, open it, and drag Fetch into Applications. macOS will warn that it is unsigned. Right-click the app, click Open, then Open again.

Jellyfin is a media server you run yourself. Movies, shows, live channels, all on a machine you own. For live TV it wants an M3U file, a list of channel names and URLs. Each URL is usually an HLS playlist. HLS is Apple's way of chopping video into tiny files and handing the player a text list of what to fetch next. That list is a `.m3u8`. A master playlist points at a few quality versions. A media playlist points at the actual chunks. On a live feed those chunk names keep changing.

The fight is authorization. A lot of sites will only serve the video if the request looks like it came from their own player. They check the User-Agent and reject Jellyfin's ffmpeg. They check the Referer so a random server cannot hotlink. They set a cookie after the page loads. They sign the playlist URL with a token that dies in ten or fifteen minutes. You will see `exp=`, Akamai `hdnts`, or a JWT in the query string. Paste that URL into Jellyfin and it may work once. When the token expires you get a 403, and Jellyfin has no way to go back to the page and get a new one.

Fetch sits between them. Jellyfin only ever talks to Fetch, at a URL that does not rotate. Fetch talks to the origin with the headers and cookies a browser would send, and it rewrites the playlist so every chunk comes through Fetch too. ffmpeg never has to impersonate Chrome. When a token is about to die, Fetch goes and gets a fresh playlist before Jellyfin notices.

Sniff is how it copies what the player already sent. You give Fetch the watch page, not the `.m3u8`. It opens the page, watches the network tab, and takes the playlist the player loaded, plus the User-Agent, Referer, cookies, and Authorization header that went with it. Do that from the Capture tab, or from a terminal if you want to watch Chromium do it.

## Using it

The Guide is the lineup. Pick a channel and it plays. Add a playlist URL if you already have one. If you only have a page that plays in the browser, go to Capture, paste the page, and sniff.

Settings builds an M3U for Jellyfin. Point Jellyfin at that file and each channel is a stable Fetch URL. Fetch has to be open for those URLs to work. Open Fetch, then watch. Close the window and the path is gone. That is the point. Nothing sits in the background chewing CPU.

## From source

```
npm ci
npm run desktop:dev     # a window over the live server
npm run desktop:build   # Fetch.app
```

`npm run dev` is the same server in a browser at http://localhost:8080. Node 20. Building the app needs Rust once. `brew install rust`.

To sniff from a terminal, install Chromium once, then pass a page:

```
npx playwright install chromium
npm run sniff -- https://example.com/watch/123
```

`--dry-run` prints what it found and submits nothing. `--headed` shows the browser.
