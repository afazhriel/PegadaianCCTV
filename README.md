# ProjectCCTV

**100% Local • Self-Hosted • Zero Cloud** Smart Home Dashboard

Monitor CCTV streams (WebRTC, sub-second latency) and control Tuya IoT switches — all on your LAN, no internet required.

---

## Architecture

```
┌─────────────┐     HTTP/WS      ┌─────────────┐     Local LAN      ┌─────────────┐
│  Browser    │ ◄──────────────► │  Backend    │ ◄────────────────► │  Tuya       │
│  (Frontend) │   Port 3000      │  (Node.js)  │   TuyAPI + Key     │  Devices    │
└──────┬──────┘                  └─────────────┘                    └─────────────┘
       │
       │ WebRTC (WS)
       ▼
┌─────────────┐     RTSP          ┌─────────────┐
│   go2rtc    │ ◄──────────────── │  NVR /      │
│  (Media)    │   Port 1984/1985  │  Tuya Bridge│
└─────────────┘                   └─────────────┘
```

| Component | Role | Port |
|-----------|------|------|
| **Frontend** | UI, Video (`<video-stream>`), Controls | 8080 (static) |
| **Backend** | Tuya Switch API (REST) | 3000 |
| **go2rtc** | RTSP → WebRTC Transcoder | 1984 (REST), 1985 (WS) |
| **Tuya-RTSP-Bridge** | Tuya Cam → RTSP | 8554 |

---

## Quick Start

### 1. Prerequisites
- **Node.js 18+**
- **go2rtc** — [Download](https://github.com/AlexxIT/go2rtc/releases) (single binary)
- **Tuya-RTSP-Bridge** (for Tuya cameras) — Docker:
  ```bash
  docker run -d --name tuya-bridge \
    -p 8554:8554 \
    -e TUYA_DEVICES='[{"id":"xxx","key":"yyy","ip":"192.168.1.x"}]' \
    synack/tuya-rtsp-bridge
  ```
- **NVR** with RTSP enabled (user/pass/IP/channel)

### 2. Configure Environment
```bash
# Copy and edit
cp .env.example .env  # (create this file)
```

**Required variables:**
```bash
TUYA_DEVICE_COUNT=2
TUYA_DEVICE_1_ID=bfxxxxxxxxxxxxxxxx
TUYA_DEVICE_1_KEY=xxxxxxxxxxxxxxxx
TUYA_DEVICE_1_IP=192.168.1.50
TUYA_DEVICE_1_NAME=Living Room Light
TUYA_DEVICE_1_DPS=1
TUYA_DEVICE_1_VERSION=3.3

TUYA_DEVICE_2_ID=bfyyyyyyyyyyyyyyyy
TUYA_DEVICE_2_KEY=yyyyyyyyyyyyyyyy
TUYA_DEVICE_2_IP=192.168.1.51
TUYA_DEVICE_2_NAME=Bedroom Switch
TUYA_DEVICE_2_DPS=1
TUYA_DEVICE_2_VERSION=3.3
```

> **Get Tuya Local Key:** Use [Tuya IoT Platform](https://iot.tuya.com) → Device List → "Local Key" or use `tuyapi-cli` / `tinytuya` wizard.

### 3. Configure Streams (`config/go2rtc.yaml`)
Edit the `streams:` section with your actual RTSP URLs:
```yaml
streams:
  cam_front_yard: rtsp://admin:password@192.168.1.100:554/Streaming/Channels/101
  cam_tuya_doorbell: rtsp://192.168.1.150:8554/doorbell
```

### 4. Run All Services (4 terminals)

```bash
# Terminal 1: Media Server
go2rtc -c config/go2rtc.yaml

# Terminal 2: Tuya-RTSP-Bridge (if using Tuya cams)
docker start tuya-bridge

# Terminal 3: Backend API
cd ProjectCCTV
npm install
npm start
# → http://localhost:3000/api/devices

# Terminal 4: Frontend (any static server)
npx serve frontend -p 8080
# → Open http://localhost:8080
```

> **No static server?** Just open `frontend/index.html` directly in browser (`file://` works).

---

## API Reference

### Backend (Port 3000)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/devices` | List configured Tuya devices |
| GET | `/api/tuya/status?deviceId=<id>` | Get switch state (true/false) |
| POST | `/api/tuya/switch` | Set switch state `{deviceId, state: boolean}` |

**Example:**
```bash
# Get status
curl "http://localhost:3000/api/tuya/status?deviceId=bfxxxxxxxxxxxxxxxx"

# Turn ON
curl -X POST http://localhost:3000/api/tuya/switch \
  -H "Content-Type: application/json" \
  -d '{"deviceId":"bfxxxxxxxxxxxxxxxx","state":true}'

# Turn OFF
curl -X POST http://localhost:3000/api/tuya/switch \
  -H "Content-Type: application/json" \
  -d '{"deviceId":"bfxxxxxxxxxxxxxxxx","state":false}'
```

### go2rtc (Port 1984/1985)

| Endpoint | Description |
|----------|-------------|
| `GET /api/streams` | List all streams with status |
| `GET /api/streams/<name>` | Stream info |
| `WS /<stream_name>` | WebRTC signaling (used by `<video-stream>`) |

---

## Customization

### Add More Cameras
1. Add RTSP URL to `config/go2rtc.yaml` under `streams:`
2. Add entry to `CONFIG.streams` in `frontend/index.html`
3. Restart go2rtc

### Add More Switches
1. Add `TUYA_DEVICE_N_*` vars to `.env`
2. Increment `TUYA_DEVICE_COUNT`
3. Restart backend (`npm start`)

### Change Theme
Edit `tailwind.config` in `index.html` `<head>` — colors, fonts, dark/light mode.

### Production Deploy
- Self-host Tailwind: `npx tailwindcss -i input.css -o output.css --watch`
- Download `html-api.min.js` locally: `curl -o html-api.min.js https://cdn.jsdelivr.net/npm/@go2rtc/html-api@latest/dist/html-api.min.js`
- Update `<script src>` in `index.html` to local paths
- Run behind reverse proxy (nginx/Caddy) with TLS for WSS

---

## Troubleshooting

| Symptom | Check |
|---------|-------|
| Backend: "Device not configured" | `.env` vars match `TUYA_DEVICE_N_ID` |
| Backend: "Failed to connect" | Device IP pingable? Correct Local Key? Protocol version (3.1/3.3)? |
| Video: Black screen / "connecting..." | go2rtc running? WS port 1985 open? RTSP URL works in VLC? |
| Video: High latency | Use `rtsp_transport: tcp` in go2rtc.yaml; ensure LAN (not WiFi) |
| Switch: State not updating | Correct DPS? (usually 1 for main switch) |
| CORS errors | Backend sends `Access-Control-Allow-Origin: *` |

---

## File Structure

```
ProjectCCTV/
├── backend/
│   └── server.js           # Node.js API + TuyAPI
├── frontend/
│   └── index.html          # Dashboard (Tailwind + html-api.js)
├── config/
│   └── go2rtc.yaml         # Stream definitions
├── .opencode/
│   └── PROJECT_MEMORY.md   # Architecture rules for AI agents
├── package.json            # Dependencies (tuyapi)
└── README.md               # This file
```

---

## License

MIT — Free for personal use. No warranty.