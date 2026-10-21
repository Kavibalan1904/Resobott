# Reso audio-reactive visualizer: implementation status

## What is implemented in this branch

`src/utils/audioReactiveVisualizer.js` provides a PCM-driven signal-processing and GIF-rendering foundation:

- Radix-2 FFT magnitude analysis.
- Hann windowing.
- Logarithmic frequency-band aggregation.
- Bounded, smoothed spectrum values.
- GIF frames rendered from supplied spectrum arrays.
- Input validation and deterministic unit tests using synthetic sine waves.

The renderer consumes measured spectrum frames. It does not infer audio from a title or create random bar heights.

## Important integration blocker

The current bot uses `lavalink-client` to control a separate Lavalink server. Normal Lavalink player events and track metadata do not expose the decoded PCM frames being sent to Discord. The existing `src/utils/visualizer.js` generator is a decorative title-seeded animation; it does not analyze the music.

Therefore, the new PCM renderer is not yet wired into `/visualizer` or automatic Now Playing posts. Wiring it to fabricated data would misrepresent the feature as audio-reactive.

## Required next step for true live-audio data

Implement and deploy a server-side capture component that can access decoded audio from the exact active Lavalink player. It must expose only short-lived spectrum frames (preferred) or bounded PCM chunks to the bot over an authenticated, TLS-protected interface.

Before selecting an implementation, verify the exact Lavalink core/plugin API and version. Do not assume an ordinary plugin can intercept decoded frames. If it cannot, a maintained Lavalink core patch/fork or an independent stream decoder may be necessary; each has different deployment, compatibility and synchronization costs.

Suggested service contract:

- Request identifies the guild/player and current track identity.
- Response includes a bounded sequence of timestamped spectrum frames, sample rate/analysis metadata, and the track identity used for capture.
- Reject stale track IDs, oversized payloads, invalid values, and unauthenticated requests.
- Never expose source URLs, credentials, or an unrestricted public audio stream.
- The bot renders and uploads a short GIF only after validating the response.
- If capture is unavailable, the command must clearly report that audio capture is not configured; it must not silently fall back to fake bars.

## Tests

Run:

```sh
npm test
```

The new tests verify FFT peak detection, different frequency patterns for low/high sine waves, silence handling, smoothing bounds, and invalid input rejection. These tests validate DSP/rendering foundations only; they do not prove Lavalink PCM capture or end-to-end Discord upload.

## Rollout safety

Keep the new module isolated until the capture source is proven against the exact deployed Lavalink version. Do not modify queue advancement, source resolution, player filters, or existing playback event handling as part of audio capture. Enable the feature only after a YouTube track and a Spotify-resolved track both pass an end-to-end test.
