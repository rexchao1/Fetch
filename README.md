# Fetch

I built Fetch because I got tired of using my browser for streaming and having ads pop up left and right. Fetch is a macOS desktop app that simplifies this. It contains a beautiful UI with an easy video player. Just take a link off of the internet that has some kind of video content, and Fetch will go grab that video and stream it for you. Say goodbye to those ads!!!

Download it here (I promise it's safe):
[Fetch.dmg](https://github.com/rexchao1/Fetch/releases/latest/download/Fetch_0.1.0_aarch64.dmg)

## Here's some things I learned while making it:

Jellyfin is an open-source media server you run yourself. Movies, shows, live channels, all on a machine you own. For live TV it wants an M3U file, a list of channel names and URLs. Each URL is usually an HLS (HTTP Live Stream) playlist. HLS is Apple's way of chopping video into tiny files and handing the player a text list of what to fetch next. That list is called a `.m3u8`. A master playlist would point at a few quality versions, while a media playlist points at the actual chunks. On a live feed those chunk names keep changing.

When streaming, these websites get these .m3u8 urls through their network. Every streaming browser gets it, and it is public information.

The fight is authorization. A lot of sites will only serve the video if the request looks like it came from their own player. They check the name of the recipient first, of course. Then they check the Referer, the supposed server that gave them the url. They set a cookie after the page loads. Or, very commonly, they sign the playlist URL with a token, that may die in ten or fifteen minutes. 

Jellyfin needs a public, solid url. Paste these websites' URL into Jellyfin and it may work once. When the token expires you get a 403, and Jellyfin has no way to go back to the page and get a new one. Fetch sits between them. Jellyfin only ever talks to Fetch, at a URL that does not rotate. Fetch talks to the origin with the headers and cookies a browser would send, and it rewrites the playlist so every chunk comes through Fetch too. 

We do not have to impersonate any browser, and when a token is about to die, Fetch goes and gets a fresh playlist before Jellyfin notices.


## Using it

The Guide is the lineup. Pick a channel and it plays. Add a playlist URL if you already have one. 

More commonly, if you only have a website that plays in the browser, go to the Capture tab, paste the page, and sniff.
Sniff is how Fetch finds the .m3u8. You give Fetch the website, it finds the player, watches the network tab, and takes the playlist plus any authorization that came with it.


Fetch is built to be in the background. Close the window and the path is gone. That is the point. Nothing sits eating your CPU.

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
