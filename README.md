# YT Resume

A small Chrome extension that remembers where you left off in YouTube videos and resumes from there.

<!-- TODO: add demo GIF here, e.g. ![YT Resume demo](docs/demo.gif) -->
*Demo GIF coming soon.*

## Features

- Resumes videos where you stopped, across reloads and restarts, including when you move between videos.
- Waits out pre-roll ads before resuming.
- Popup with saved videos (title, channel, position, progress bar), title search, and delete or clear all.
- Playlist aware: videos watched in a playlist reopen in it.
- Options page for the on/off switch, minimum video length, finished threshold and max stored videos.
- Skips short videos and live streams, and forgets videos you finish.
- Plain JavaScript, no build step, no dependencies. Only the `storage` permission.

## Install (Load unpacked)

1. Clone or download this repository.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and select the folder containing `manifest.json`.

After editing a file, reload the extension card and your YouTube tabs.

## Options

Right-click the toolbar icon and choose **Options**. Changes apply immediately, with no page reload.

| Setting | Default |
| --- | --- |
| Enabled | on |
| Minimum video length | 60 s |
| Finished threshold | 15 s |
| Maximum stored videos | 500 |

## How it works

- **Content script** (`content.js`) runs on `youtube.com`, tracks the main `<video>` on pages with a `v` parameter, and needs no background worker.
- **Storage:** positions are kept in `chrome.storage.local` as `v:<videoId>` with time, duration, title, channel and playlist. Writes happen at most every 5 s while playing, and on pause, tab hidden and page close. Entries older than 90 days are pruned, and the newest are kept up to your maximum. Settings are stored under `settings`, and open tabs pick up changes through `storage.onChanged`.
- **Resuming:** on load it seeks to the saved position if it is over 10 s, the URL has no `t` parameter, and the playhead is still near the start.
- **SPA navigation:** YouTube doesn't reload between videos, so it saves the outgoing video on `yt-navigate-start` and sets up the new one on `yt-navigate-finish`.
- **Ads:** nothing is saved or seeked while `#movie_player` has `ad-showing`. After a pre-roll, a `MutationObserver` resumes once the ad ends.

## Known limitations

- No YouTube Shorts.
- No sync across devices; data is per browser profile.
- It depends on YouTube's page markup and events, so a redesign could break it. The channel name in particular is read from the page and may be missing.

## Privacy

All data stays on your device in `chrome.storage.local`. The extension makes no network requests and has no analytics. It reads only the video ID, title, channel, current time and duration of videos you watch on youtube.com. **Clear all** in the popup, or removing the extension, deletes it.

## Quick check

Play a video past 0:30, wait a few seconds, and reload: it should jump back. Open the popup to see it listed, then try `&t=120s` in the URL to confirm a timestamp link wins over the saved position.

## License

[MIT](LICENSE)
