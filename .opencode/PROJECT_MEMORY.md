# ProjectCCTV - Opencode Memory & Development Instructions

## Project Vision
**100% Local, Self-Hosted Smart Home Dashboard** — Zero cloud dependencies, zero external APIs, runs entirely on LAN.

## Architecture (Immutable Rules)

```
┌─────────────────────────────────────────────────────────────────┐
│                     FRONTEND (Browser)                          │
│  HTML5 + Tailwind CSS + Vanilla JS (ES6+)                      │
│  - Video: <video-stream> from go2rtc html-api.js               │
│  - Controls: Fetch API → Backend                                │
└─────────────────────────┬───────────────────────────────────────┘
                          │ HTTP/WS (Localhost/LAN)
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                    BACKEND (Node.js)                            │
│  HTTP API Server (port 3000)                                    │
│  - TuyAPI → Tuya Local Devices (IP + Local Key)                │
│  - Endpoints: /api/tuya/switch, /api/tuya/status, /api/devices │
│  - Zero external dependencies                                   │
└─────────────────────────┬───────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────────┐
│                  MEDIA SERVER (go2rtc)                          │
│  RTSP → WebRTC Transcoder (ports 1984/1985)                    │
│  - Input: NVR RTSP + Tuya-RTSP-Bridge                          │
│  - Output: WebRTC via WS (html-api.js)                         │
│  - Config: config/go2rtc.yaml                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Separation of Concerns (Strict)

| Layer | Responsibility | Tech | Port |
|-------|---------------|------|------|
| Frontend | UI, Video Display, User Interaction | HTML/Tailwind/JS | 8080 (static) |
| Backend | Tuya Device Control, Auth, Logic | Node.js + TuyAPI | 3000 |
| Media | RTSP→WebRTC, Stream Routing | go2rtc (Go) | 1984 (REST), 1985 (WS) |

**NEVER mix responsibilities.** Frontend never talks to Tuya directly. Backend never handles video.

## Folder Structure
```
ProjectCCTV/
├── backend/
│   └── server.js           # Node.js HTTP API + TuyAPI
├── frontend/
│   └── index.html          # Single-file dashboard (Tailwind CDN)
├── config/
│   └── go2rtc.yaml         # go2rtc stream configuration
├── .opencode/
│   └── PROJECT_MEMORY.md   # This file
├── package.json            # npm dependencies (tuyapi only)
└── README.md               # Run instructions
```

## Development Workflow

### 1. Prerequisites
- Node.js 18+
- go2rtc binary (download from GitHub releases)
- Tuya-RTSP-Bridge (Docker) for Tuya cameras
- NVR with RTSP enabled

### 2. Environment Variables (Backend)
Create `.env` in project root or export:
```bash
TUYA_DEVICE_COUNT=2
TUYA_DEVICE_1_ID=xxxxxxxxxxxxxxxxxxxx
TUYA_DEVICE_1_KEY=xxxxxxxxxxxxxxxx
TUYA_DEVICE_1_IP=192.168.1.xxx
TUYA_DEVICE_1_NAME=Living Room Light
TUYA_DEVICE_1_DPS=1
TUYA_DEVICE_1_VERSION=3.3

TUYA_DEVICE_2_ID=yyyyyyyyyyyyyyyyyyyy
TUYA_DEVICE_2_KEY=yyyyyyyyyyyyyyyy
TUYA_DEVICE_2_IP=192.168.1.xxx
TUYA_DEVICE_2_NAME=Bedroom Switch
TUYA_DEVICE_2_DPS=1
```

### 3. Run Order
```bash
# Terminal 1: Media Server
go2rtc -c config/go2rtc.yaml

# Terminal 2: Tuya-RTSP-Bridge (for Tuya cams)
docker run -d --name tuya-bridge -p 8554:8554 ...

# Terminal 3: Backend
npm install && npm start

# Terminal 4: Frontend (any static server)
npx serve frontend -p 8080
# OR open frontend/index.html directly in browser (file://)
```

### 4. Verification
- Backend health: `curl http://localhost:3000/api/devices`
- go2rtc streams: `curl http://localhost:1984/api/streams`
- Dashboard: Open `http://localhost:8080`

## Key Technical Decisions

### Why TuyAPI?
- Pure local LAN communication (no cloud)
- Supports Tuya protocol 3.3+ (most devices)
- Handles encryption with Local Key
- Event-based (connected/disconnected/error)

### Why go2rtc?
- Sub-second WebRTC latency (~200-500ms LAN)
- Single binary, no runtime deps
- REST + WS API for frontend integration
- Supports multiple RTSP sources

### Why html-api.js (go2rtc)?
- Native `<video-stream>` Web Component
- Zero JS bundle, loads from CDN
- Handles WebRTC signaling automatically
- Works with go2rtc WS endpoint directly

### Why Single-file Frontend?
- Zero build step, zero bundler
- Tailwind via CDN (dev only; production: self-host)
- Portable, works via `file://` protocol
- Easy to modify and deploy

## Extension Points (Future Work)

### Add Motion Detection
```yaml
# go2rtc.yaml
motion:
  enabled: true
  threshold: 0.1
```
→ Backend: Add `/api/events` SSE endpoint
→ Frontend: Toast notifications, recording triggers

### Add Camera PTZ
```javascript
// Backend: New endpoint
POST /api/camera/ptz { deviceId, action: 'up|down|left|right|preset' }

// go2rtc: onvif passthrough or custom script
```

### Add Persistent State
- SQLite for switch history, schedules
- Backend: `better-sqlite3` (zero-dep)

### Add Authentication
- Backend: Simple token auth (header-based)
- Frontend: Login screen, token in localStorage

## Common Issues & Fixes

| Issue | Cause | Fix |
|-------|-------|-----|
| Tuya "connection refused" | Wrong IP/Key/Version | Verify device IP pingable; try version 3.1/3.3 |
| WebRTC black screen | go2rtc WS port blocked | Check firewall; WS on 1985 |
| Stream not loading | RTSP URL wrong | Test with VLC: `vlc rtsp://...` |
| Switch state not updating | DPS wrong | Check Tuya device config (usually DPS 1) |
| CORS errors | Backend missing headers | Verify `Access-Control-Allow-Origin: *` |

## Coding Standards for This Project

1. **No external CDN in production** — Self-host Tailwind, html-api.js
2. **No framework** — Vanilla JS only (ES6+ modules ok)
3. **No database unless needed** — In-memory state preferred
4. **Error handling everywhere** — Try/catch + user feedback
5. **Comments on critical logic** — Especially Tuya protocol, WebRTC
6. **Modular functions** — Single responsibility, testable
7. **Environment config** — No hardcoded IPs/keys

## Opencode Agent Instructions

When working on this project:
- **Always** respect the 3-layer architecture
- **Never** add cloud dependencies (AWS, Firebase, MQTT brokers, etc.)
- **Prefer** extending existing files over creating new ones
- **Test** locally before suggesting changes
- **Document** new env vars in this file
- **Update** this memory when architecture changes

## Version History
- v1.0: Initial scaffold — Backend, go2rtc config, Frontend dashboard