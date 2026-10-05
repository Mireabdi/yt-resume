# YT Resume

A small Chrome extension that remembers where you left off in YouTube videos and picks up from there the next time you open them.

<!-- TODO: add demo GIF here, e.g. ![YT Resume demo](docs/demo.gif) -->
*Demo GIF coming soon.*

## Features

- Resumes a video from where you stopped, including after a reload or a browser restart.
- Works with YouTube's single-page navigation: moving between videos saves the one you leave.
- Waits out pre-roll ads and resumes the real video once the ad ends.
- Popup lists saved videos, newest first, with the title, channel name, time position and a progress bar. Click one to reopen it at that moment.
- Search box in the popup filters the list by title as you type.
- Playlist aware: videos watched inside a playlist reopen inside that playlist.
- Options page to turn the extension on or off and tune the minimum video length, the finished threshold and the number of stored videos. Changes apply immediately, no page reload.
- Delete single entries or clear everything.
- Ignores short videos (under 60 s by default) and live streams, and forgets videos you have finished.
- Light and dark popup that follows your system theme.
- Plain JavaScript, no build step, no dependencies. The only permission is `storage`.

## Install (Load unpacked)

1. Download or clone this repository.
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode** (top right).
4. Click **Load unpacked** and select the project folder (the one containing `manifest.json`).
5. Optional: pin YT Resume from the puzzle-piece menu to get quick access to the popup.

After editing any file, click the reload icon on the extension card and reload your YouTube tabs.

## Options

Open them from the extension card on `chrome://extensions` (**Details** > **Extension options**) or by right-clicking the toolbar icon and choosing **Options**. Changes save as you make them.

| Setting | Default | Meaning |
| --- | --- | --- |
| Enabled | on | When off, nothing is saved or resumed. Existing entries are kept. |
| Minimum video length | 60 s | Shorter videos are not tracked. |
| Finished threshold | 15 s | A video this close to its end counts as finished and is forgotten. |
| Maximum stored videos | 500 | The oldest entries are dropped beyond this. |

Settings live in `chrome.storage.local` under `settings`. Blank or invalid values fall back to the defaults, and out-of-range values are clamped (seconds up to 86400, entries 1 to 5000).

## How it works

**Content script.** `content.js` runs on `https://www.youtube.com/*`. When the URL has a `v` parameter it finds the main `<video>` element and tracks playback. There is no background service worker.

**Storage.** Positions are stored in `chrome.storage.local` under `v:<videoId>` as `{time, duration, title, updatedAt}`, plus `channel` (read from the watch page, left out if it can't be found) and `list` (the playlist ID, only when the URL had a `list` parameter). Writes are throttled to once every 5 seconds during playback, and also happen on pause, when the tab is hidden, and when the page closes. Entries older than 90 days are dropped and the newest entries up to your maximum are kept; this runs when a YouTube page loads and whenever you change settings.

**Resuming.** When a video's metadata loads, the script seeks to the saved position if it is over 10 seconds, the URL has no `t` parameter, and the playhead is still near the start (so it never overrides you). A video within 15 seconds of its end is treated as finished and its entry is deleted.

**Settings.** The content script reads `settings` on load and listens to `chrome.storage.onChanged`, so changes made on the options page take effect in already-open tabs. Defaults and validation live in `settings.js`, which the content script and the options page share.

**SPA navigation.** YouTube does not reload the page when you move between videos, so the script listens for `yt-navigate-start` and `yt-navigate-finish`. On start it saves the last known position of the video you are leaving (the URL may already point at the next one), and on finish it sets up tracking for the new video.

**Ads.** While `#movie_player` has the `ad-showing` class, nothing is saved and nothing is seeked. If a pre-roll ad is playing when the video loads, a `MutationObserver` waits for the ad to end and then resumes once, provided the main video is still near the start.

## Known limitations

- YouTube Shorts are not supported (they have no `v` parameter).
- Positions are stored per browser profile and do not sync across devices.
- It relies on YouTube's page structure and events (`#movie_player`, `ad-showing`, `yt-navigate-*`), so a YouTube redesign could break it.
- Positions of 10 seconds or less are not stored, since they would never be resumed.
- The channel name is scraped from the page, so it may be missing if YouTube changes its markup. Older entries saved before this feature have no channel.
- Playlist links only keep the playlist ID, not the position within it. YouTube works out where the video sits in the playlist.

## Privacy

All data stays on your device in `chrome.storage.local`. The extension makes no network requests, has no analytics, and sends nothing anywhere. It only reads the video ID, title, current time and duration of videos you watch on youtube.com. Removing the extension, or using **Clear all** in the popup, deletes the data.

## Manual testing

Tip: to inspect storage, right-click the popup, choose **Inspect**, and run `chrome.storage.local.get(null, console.log)`.

**Resume on reload**
1. Open a video longer than 60 s and let it play past 0:30.
2. Wait about 6 s, then reload the tab. Playback should jump back to roughly where you were.
3. Open the popup. The video should be listed with its position and progress bar.

**SPA navigation**
1. Play video A past 0:30, then click a recommended video B (no page reload).
2. The popup should show A at the position you left it, not 0:00.
3. Play B past 0:30, then press Back. A should resume at its saved time.

**Ads**
1. Use a video with a saved position that shows a pre-roll ad.
2. Reload it. The ad should play, then the video should jump to the saved position.
3. While the ad plays, that popup entry should not change.

**`?t=` links**
1. Save a position, then open `https://www.youtube.com/watch?v=<id>&t=120s` for the same video.
2. It should start at 2:00, not at the saved position.
3. Clicking a popup row opens such a link in a new tab at the saved time.

**Finished videos**
1. Drag the playhead to within 15 s of the end and let it play or pause there.
2. After about 6 s, or on pause, the popup entry should be gone, and reopening the video starts at 0:00.

**Playlists**
1. Open a video from a playlist (the URL has `&list=...`), play past 0:30, wait about 6 s.
2. Click its row in the popup. The new tab's URL should contain `&t=...s&list=<same id>` and the playlist panel should show.
3. Open a video with no playlist, save it, and click its row. The URL should have no `list` parameter.

**Search**
1. Save at least three videos with different titles.
2. Type part of a title in lowercase or uppercase. Only matching rows should remain, updating as you type.
3. Type something that matches nothing. You should see "No saved videos match your search."
4. Type `<b>` or other HTML. It should be treated as plain text and nothing should render.
5. Delete a row while a filter is active. The filter should stay applied.

**Channel name**
1. Play a video on a normal watch page for 30 s or more and open the popup. The channel name should appear in grey under the title.
2. Videos saved before this feature show no channel line, and that is expected.

**Options**
1. Open the options page. It should show 60, 15 and 500 with Enabled on.
2. Keep a video playing in another tab, turn **Enabled** off (no page reload), wait 10 s, and open the popup. Its entry should not update. Turn it back on and it should start updating again.
3. Set **Minimum video length** to 300, play a 3-minute video for 30 s, and confirm it does not appear. Set it back to 60 and confirm it does, without reloading the page.
4. Set **Finished threshold** to 120, move a video to 1 minute from the end and wait 6 s. The entry should vanish. Reset it to 15 afterwards.
5. Set **Maximum stored videos** to 2 with 3 or more saved. Within a second the popup (reopen it) should list only the 2 newest.
6. Clear a number field and click away, or type a huge number. It should snap back to the default or the limit.
7. Press **Reset to defaults** and confirm the values return to 60, 15 and 500.

**Other checks**
- A video under 60 s and a live stream should never appear in the popup.
- Per-row delete and **Clear all** work, and the empty state appears when the list is empty.
- Switch your OS between light and dark mode to check the popup theme.

## License

[MIT](LICENSE)
