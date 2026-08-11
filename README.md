# PhoneCamera

![Node.js](https://img.shields.io/badge/Node.js-LTS-339933?logo=node.js&logoColor=white)
![Platform](https://img.shields.io/badge/platform-Windows-0078D6?logo=windows&logoColor=white)
![WebRTC](https://img.shields.io/badge/streaming-WebRTC%20P2P-333333?logo=webrtc&logoColor=white)
![No app required](https://img.shields.io/badge/phone%20app-none%20required-success)
![Status](https://img.shields.io/badge/status-v1-blue)

Turn an iPhone into a Windows webcam — **no app to install on the phone**, no
cloud service, no account. The iPhone just opens a page in Safari; the video
flows peer-to-peer over your local Wi-Fi straight into OBS Studio, which
exposes it system-wide via its built-in Virtual Camera.

Useful if you want a sharper/wider camera than a laptop webcam for video
calls, without buying capture hardware or installing a phone-side app.

## Contents

- [How it works](#how-it-works)
- [Features](#features)
- [Tech stack](#tech-stack)
- [Requirements](#requirements)
- [One-time setup](#one-time-setup)
- [Everyday use](#everyday-use)
- [CLI options](#cli-options)
- [Project structure](#project-structure)
- [Troubleshooting](#troubleshooting)
- [Current scope](#current-scope)

## How it works

1. A small Node server on your PC serves a page for the phone (camera
   capture via `getUserMedia` + WebRTC) and a page for OBS (an OBS Browser
   Source that receives that WebRTC stream and displays it full-screen).
2. The two pages find each other through a signaling relay built into the
   same server — the video itself never touches the server, it goes directly
   phone → PC over the LAN.
3. OBS's **Start Virtual Camera** turns that Browser Source into a normal
   webcam device any app (Zoom, Teams, Discord, etc.) can select.

```
 iPhone (Safari)                 Windows PC (Node server)              OBS Studio
┌────────────────┐   HTTPS/WSS  ┌──────────────────────────┐   HTTP   ┌──────────────┐
│  phone.html/js  │◄────────────►│  signaling relay (/ws)    │◄────────►│  obs.html/js  │
│  getUserMedia   │              │  static file server        │          │  Browser Src  │
└────────┬────────┘              └──────────────────────────┘          └───────┬──────┘
         │                                                                       │
         └───────────────────── WebRTC media (peer-to-peer, LAN) ───────────────┘
                                                                          │
                                                                 Start Virtual Camera
                                                                          │
                                                                 Zoom / Teams / Discord
```

Everything stays on your local network. No internet connection is required
once the phone has the page open.

## Features

- **No phone-side app** — the iPhone just opens a page in Safari over
  HTTPS; no App Store install, no account, no pairing app.
- **Peer-to-peer video** — after signaling, video flows directly
  phone → PC over WebRTC; the server never touches the media stream.
- **Front/back camera switching** — swap cameras live from a dropdown on
  the phone page without reloading or dropping the OBS connection.
- **Auto LAN IP detection** — picks the right network adapter automatically
  (with `--ip` to override when it guesses wrong).
- **Self-signed HTTPS, generated and cached automatically** — required for
  `getUserMedia` to work over a LAN IP instead of `localhost`; regenerated
  only when your IP changes.
- **QR code in the terminal** — scan it with the iPhone's Camera app to open
  the phone page, no typing URLs.
- **Auto-reconnect signaling** — both the phone and OBS pages reconnect with
  exponential backoff if the WebSocket connection drops.
- **Stale-tab eviction** — reopening/reloading the phone or OBS page cleanly
  replaces the previous session instead of conflicting with it.
- **Optional STUN fallback** (`--stun`) for the rare case ICE can't connect
  the two sides directly.

## Tech stack

| Layer | Technology | Purpose |
|---|---|---|
| Runtime | [Node.js](https://nodejs.org) | Server runtime (built-in `http`/`https`) |
| Signaling | [`ws`](https://www.npmjs.com/package/ws) | WebSocket relay for WebRTC offer/answer/ICE |
| Media transport | WebRTC (browser-native) | Peer-to-peer video, phone → PC |
| TLS | [`selfsigned`](https://www.npmjs.com/package/selfsigned) | Generates the self-signed HTTPS cert `getUserMedia` requires on a LAN IP |
| Pairing | [`qrcode`](https://www.npmjs.com/package/qrcode) | Renders a scannable QR code in the terminal |
| Frontend | Vanilla HTML/CSS/JS | No build step — plain `<script>` tags, no framework |
| Webcam output | [OBS Studio](https://obsproject.com) (external) | Browser Source + built-in Virtual Camera |

## Requirements

- **Node.js** (LTS) installed on the Windows PC — [nodejs.org](https://nodejs.org)
- **OBS Studio** installed — [obsproject.com](https://obsproject.com)
- iPhone and PC on the **same Wi-Fi network** (not a guest network with
  client isolation — see [Troubleshooting](#troubleshooting))

## One-time setup

1. Install dependencies:
   ```sh
   npm install
   ```
2. Start the server once so OBS has something to point at:
   ```sh
   npm start
   ```
3. In OBS Studio: **Sources → + → Browser**, create a new source (e.g.
   "iPhone Cam") with:
   - URL: `http://localhost:8080/obs`
   - Width/Height: matching your canvas (e.g. 1920×1080)
   - **Uncheck** "Shutdown source when not visible" (keeps the connection
     alive even if this scene isn't active)
4. On your iPhone: open the **Camera** app and scan the QR code printed in
   the terminal. Tap the banner to open it in Safari.
   - The **first time only**, Safari will warn "This Connection Is Not
     Private" (this is the server's self-signed certificate — everything is
     still local and encrypted, Safari just doesn't recognize the issuer).
     Tap **Show Details → visit this website**. Safari remembers this
     per-site afterward.
   - Tap **Start Camera** and allow the camera permission prompt.

## Everyday use

```sh
npm start
```

- Scan the QR code with your iPhone (or reopen the same Safari tab from
  before) and tap **Start Camera**.
- Use the **Camera** dropdown on the phone page to switch between back and
  front camera at any time — the OBS feed updates live.
- In OBS, click **Start Virtual Camera**.
- In Zoom/Teams/Discord/etc., select **OBS Virtual Camera** as your camera.

## CLI options

- `--ip <address>` — force a specific LAN IP if auto-detection picks the
  wrong network adapter (common on machines with Wi-Fi + Ethernet + VPN
  adapters at once).
  ```sh
  node server.js --ip 192.168.1.23
  ```
- `--stun` — add a public STUN server to the WebRTC configuration. Only
  needed if the phone and OBS never manage to connect on their own (see
  [Troubleshooting](#troubleshooting)).
  ```sh
  npm start -- --stun
  ```

## Project structure

```
PhoneCamera/
├── server.js                  # Entry point: starts the HTTP (OBS-facing) and
│                               # HTTPS (phone-facing) servers, wires everything up
├── src/
│   ├── network.js              # LAN IP auto-detection (+ --ip override)
│   ├── certs.js                # Self-signed HTTPS cert generation & caching
│   ├── session.js              # SessionManager: pairs one "phone" + one "obs" socket
│   ├── wsHandler.js             # WebSocket signaling relay (offer/answer/ICE)
│   ├── staticServer.js          # Static file server + route mapping (/phone, /obs)
│   ├── qrDisplay.js             # Terminal banner + QR code rendering
│   └── logger.js                # Human-readable connection-state logging
├── public/
│   ├── phone.html, css/phone.css, js/phone.js   # Camera capture page (sender)
│   ├── obs.html, css/obs.css, js/obs.js         # OBS Browser Source page (receiver)
│   └── js/ws-client.js                           # Shared WebSocket client (auto-reconnect)
├── certs/                     # Auto-generated self-signed cert (gitignored)
├── test/
│   └── manual-signaling-check.js   # Signaling relay smoke test — `npm test`
└── package.json
```

- **HTTP `:8080`** is bound to `127.0.0.1` only and serves the OBS Browser
  Source (`/obs`) — no LAN exposure needed since OBS runs on the same PC.
- **HTTPS `:8443`** is bound to `0.0.0.0` and serves the phone page
  (`/phone`) — HTTPS is required here because `getUserMedia` refuses camera
  access on a non-`localhost` origin without it.
- Both servers share the same in-memory `SessionManager` and WebSocket
  signaling path (`/ws`), so a phone and an OBS tab can find each other
  regardless of which port they connected through.

## Troubleshooting

- **Windows Firewall prompt on first run**: allow Node.js access on
  "Private networks" — this is what lets the phone reach the server.
- **Phone can't load the page at all**: confirm both devices are on the same
  Wi-Fi network, and that it isn't a guest network with client/AP isolation
  enabled (common on hotel/office guest Wi-Fi — isolated clients can't reach
  each other even on the same SSID). If your PC has multiple network
  adapters (e.g. Wi-Fi + Ethernet + a VPN), the auto-detected IP might be
  wrong — check the terminal output and use `--ip` to override it.
- **Phone connects and OBS shows the page, but the video never appears**:
  iOS Safari gathers privacy-obfuscated `.local` (mDNS) ICE candidates by
  default. Whether OBS's embedded browser can resolve those depends on its
  bundled Chromium version. If the status in the phone page gets stuck on
  "Connecting to OBS...", try:
  1. Updating OBS Studio to the latest version, or
  2. Restarting with `npm start -- --stun` to add a public STUN server as a
     fallback.
- **Cert warning reappears every time**: this happens if your PC's LAN IP
  address changes (e.g. DHCP lease renewal, switching networks) — the
  certificate is tied to the IP it was generated for. Just accept the
  warning again; it'll be stable again as long as the IP doesn't keep
  changing.
- **Switching front/back camera fails or freezes for a moment**: this is
  usually the OS taking a beat to release the previous camera; the phone
  page automatically retries a few times before giving up.

## Current scope

This first version streams **video only** (no microphone audio), and is run
manually from a terminal rather than packaged as a background/tray app.
