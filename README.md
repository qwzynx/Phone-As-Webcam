# PhoneCamera

Turn an iPhone into a Windows webcam — **no app to install on the phone**, no
cloud service, no account. The iPhone just opens a page in Safari; the video
flows peer-to-peer over your local Wi-Fi straight into OBS Studio, which
exposes it system-wide via its built-in Virtual Camera.

## How it works

1. A small Node server on your PC serves a page for the phone (camera
   capture via `getUserMedia` + WebRTC) and a page for OBS (an OBS Browser
   Source that receives that WebRTC stream and displays it full-screen).
2. The two pages find each other through a signaling relay built into the
   same server — the video itself never touches the server, it goes directly
   phone → PC over the LAN.
3. OBS's **Start Virtual Camera** turns that Browser Source into a normal
   webcam device any app (Zoom, Teams, Discord, etc.) can select.

Everything stays on your local network. No internet connection is required
once the phone has the page open.

## Requirements

- **Node.js** (LTS) installed on the Windows PC — [nodejs.org](https://nodejs.org)
- **OBS Studio** installed — [obsproject.com](https://obsproject.com)
- iPhone and PC on the **same Wi-Fi network** (not a guest network with
  client isolation — see Troubleshooting)

## One-time setup

1. Install dependencies:
   ```
   npm install
   ```
2. Start the server once so OBS has something to point at:
   ```
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

```
npm start
```

- Scan the QR code with your iPhone (or reopen the same Safari tab from
  before) and tap **Start Camera**.
- In OBS, click **Start Virtual Camera**.
- In Zoom/Teams/Discord/etc., select **OBS Virtual Camera** as your camera.

## CLI options

- `--ip <address>` — force a specific LAN IP if auto-detection picks the
  wrong network adapter (common on machines with Wi-Fi + Ethernet + VPN
  adapters at once).
  ```
  node server.js --ip 192.168.1.23
  ```
- `--stun` — add a public STUN server to the WebRTC configuration. Only
  needed if the phone and OBS never manage to connect on their own (see
  Troubleshooting).

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

## Project layout

See `src/` for the server-side pieces (LAN IP detection, self-signed cert
generation, the signaling relay) and `public/` for the two browser pages
(`phone.html`/`phone.js` for the sender, `obs.html`/`obs.js` for the OBS
Browser Source). `test/manual-signaling-check.js` is a standalone smoke test
for the signaling relay logic (`npm test`).

## Current scope

This first version streams **video only** (no microphone audio), and is run
manually from a terminal rather than packaged as a background/tray app.
