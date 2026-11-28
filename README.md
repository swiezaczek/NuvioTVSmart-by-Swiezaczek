> [!NOTE]
>
> ## NuvioTVSmart by Swiezaczek (`build/samsung-vetro`)
>
> Public community custom build of `NuvioMedia/NuvioTVSmart` maintained for **Samsung Tizen** and **Samsung Tizen + Vetro** users (while `main` remains a clean mirror of `upstream/main`).
>
> **Download:** [Latest unsigned Tizen `.wgt` Release](https://github.com/swiezaczek/NuvioTVSmart-by-Swiezaczek/releases/latest) (sign with your TV certificate via Nuvio TV Installer, Apps2Samsung, or Tizen Studio).
>
> ### Changes & Benefits for Samsung Tizen Users (no Vetro required)
>
> - **Smoother UI navigation & fewer micro-stutters**: self-contained Hero artwork Blob Worker, `FileReaderSync` data-URL poster/logo commits, camera-scroll-aware poster & row hydration pacing, vertical fast-scroll guard, bounded artwork caching, and `Home`-scoped `watchTvFramePace` (with burst/repeat protection) + Tizen 9 EngineFS loopback hardening.
> - **Frame-synced trailer unmute (zero audio-before-video)**: keeps trailer audio muted until `firstFrame` / `requestVideoFrameCallback` visual reveal (`0 ms` reveal delay) with an autoplay-policy pause fallback.
> - **OLED-friendly HDR & subtitle upgrades**: instant flicker-free HDR UI dimming before the first HDR frame (including the loading overlay and buffering spinner), linear HDR bitmap subtitle dimming, accurate SDR/HDR stream detection (avoiding false HDR triggers on tone-mapped/HLS SDR), live `hdrTextColor` editing during HDR playback, calibrated `75%–150%` line spacing aligned with Android TV (`1.15`), and subtitle outline thickness.
> - **Extra UX & session hygiene**: Profile edit/copy PIN gate, FolderDetail poster hold-menu & top-header scroll snap, and cleaner sign-out/worker/cache teardown.
>
> ### Additional Benefits for Samsung Tizen + Vetro Users
>
> Paired with the **[vetro-trailer-resolver](https://github.com/swiezaczek/vetro-trailer-resolver/releases/latest)** Vetro Shard (`v0.1.2`):
>
> - **Instant ad-free 1080p trailers from `0:00`**: plays clean MPEG-DASH (`SegmentBase` H.264 + default-track AAC), HLS (full local playlist & segment proxy), or MP4 streams directly inside Home Hero, Detail backdrop, and Post-Play with zero YouTube buttons or pre-roll ads, non-tripping per-video miss handling, and seamless Home-to-Detail `<video>` handoff.
> - **WebVTT trailer subtitles**: automatic `<track>` subtitles synchronized with Nuvio's trailer subtitle setting.
> - **Tizen 9+ self-only LAN discovery & security**: automatically discovers the TV's LAN IP via `webapis.network.getIp()` when Tizen 9 WRT blocks `127.0.0.1`, while the Shard rejects external LAN devices with HTTP `403` and runs with zero root permissions (`permissions: []`).
> - **Instant live controls**: toggle in **Nuvio Settings → Playback → Audio (`Direct Ad-Free Trailers (Vetro)`)** or **Vetro Dashboard (`Trailers` tab)**, with seamless fallback to standard YouTube playback whenever turned off.

<div align="center">

  <img src="assets/brand/app_logo_wordmark.png" alt="Nuvio" width="300" />

  <p>
    A free, open-source media app for your phone, your desktop, and the TV you already own.
    <br />
    Bring your own sources. Nuvio turns them into a library with artwork, ratings, subtitles, and your place saved on every screen.
  </p>

[Website](https://nuvio.tv) · [GitHub releases](https://github.com/NuvioMedia/NuvioTVSmart/releases/latest) · [Support Nuvio](https://nuvio.tv/support)

</div>

## Get Nuvio TV

Nuvio TV supports **Samsung Tizen TVs from 2018 onward (Tizen 4+)** and **LG webOS TVs from 2020 onward (webOS 5+)**.
The startup compatibility baseline is Samsung Tizen 4.0 / Chromium 56 and LG webOS 5.0 / Chromium 68 when the platform reports those versions.

Platform capabilities are intentionally version-dependent:

- **Samsung Tizen 4.x** — the app and direct playback are supported, but torrent/P2P playback is unavailable by design. Some advanced audio and subtitle features may also be limited.
- **Samsung Tizen 5.x** — torrent/P2P playback is supported through the bundled local EngineFS service. The packaged PluginService, plugin execution and remote plugin synchronization also run on Tizen 5.x, including the Node 4.4.3 service runtime of Tizen 5.5.
- **Samsung Tizen 6+** — torrent/P2P and the packaged PluginService are supported. Plugin execution requires the packaged service plus the TV runtime's Worker and WebAssembly support. Tizen 6 and later use the same current Tizen service pipeline.
- **LG webOS 5.x** — torrent/P2P and the packaged plugin service are supported, with the limited plugin resource quotas used by the older webOS runtime.
- **LG webOS 6+** — torrent/P2P and the packaged plugin service are supported with the modern plugin resource quotas.

On Tizen 5+ and LG webOS, torrent/P2P uses only the bundled local companion service; no external torrent streaming server is configured or required.

- [Nuvio TV Installer](https://github.com/NuvioMedia/NuvioTVSmart/releases/latest) for Windows, macOS, and Linux
- [Nuvio TV Installer for iPhone and iPad](https://github.com/NuvioMedia/NuvioTVSmart/releases/latest) as an unsigned IPA, also available as an [AltStore/SideStore source](https://github.com/NuvioMedia/NuvioTVSmart/releases/latest/download/NuvioTVSmart-Installer-AltStore.json)
- [Nuvio TV Installer for Android](https://github.com/NuvioMedia/NuvioTVSmart/releases/latest) as an APK for phones and tablets
- [Samsung Tizen WGT](https://github.com/NuvioMedia/NuvioTVSmart/releases/latest) for manual installation
- [LG webOS Homebrew repository](https://raw.githubusercontent.com/NuvioMedia/NuvioTVWebOS/main/webosbrew/apps.json)
- [LG webOS IPK](https://github.com/NuvioMedia/NuvioTVSmart/releases/latest) for manual installation

## Build from source

```bash
git clone https://github.com/NuvioMedia/NuvioTVSmart.git NuvioTVSmart
cd NuvioTVSmart
npm install
npm run build
```

Build TV packages with:

```bash
npm run package:tizen
npm run package:tizen:store
npm run package:webos
```

`package:tizen` creates the unsigned WGT used by development and the Nuvio TV Installer. The installer signs it locally for the target TV before installation. `package:tizen:store` is a separate Seller Office build: it requires Tizen Studio/Web CLI and a configured security profile, and creates the signed Store package with the local EngineFS service included so Tizen 5+ retains torrent/P2P playback. Tizen 4 still reports P2P as unsupported at runtime. Nuvio TV is built with JavaScript, HTML, CSS, and platform TV APIs. Building requires Node.js and npm; package installation additionally requires the relevant Tizen or webOS tools.

## License

[GNU General Public License v3.0](./LICENSE)
