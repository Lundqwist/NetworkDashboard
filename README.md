# Network Dashboard

A self-hosted, always-on home network dashboard designed for a **1920×1080 side monitor**.
One screen shows your PC, Raspberry Pi, NAS, Pi-hole, website and server, hallway camera,
printer, task list, network reachability and weather, refreshing every few seconds.

![Network Dashboard screenshot (demo data)](docs/screenshot.png)

- **No build step, no cloud.** It's a small Node.js server plus a plain HTML/CSS/JS frontend.
- **Secrets stay on the server.** Camera images, Pi-hole and NAS calls are proxied. The browser never sees credentials.
- **Demo mode** lets you preview the whole layout without configuring anything.

## Panels

| Panel | Type | What it shows | Data source |
| --- | --- | --- | --- |
| This PC | `local` | CPU, per-thread load, RAM, GPU (load/temp/VRAM/power), temps, disks, network throughput, uptime | [systeminformation](https://systeminformation.io/) |
| Raspberry Pi 5 / Linux host | `agent` | CPU, RAM, temperature, fan RPM, throttling or under-voltage, disks, network, systemd services, Docker containers, pending apt updates | the included [Python agent](agent/) |
| Any host with Glances | `glances` | CPU, RAM, temps, disks, network, containers | [Glances](https://nicolargo.github.io/glances/) REST API (v4/v3) |
| NAS (Synology) | `synology` | CPU, RAM, temperature, volumes with status, drive temperatures and health | DSM Web API |
| Pi-hole | `pihole` | Blocking state, pause/enable buttons, queries/blocked/% today, hourly stacked chart, top blocked domains, blocklist size | Pi-hole v6 REST API (v5 supported) |
| Website & server | `http` | Up/down per URL, HTTP status, response time history, TLS certificate days left, uptime %. Optional server metrics via agent/Glances | HTTP(S) checks |
| Hallway camera | `camera` | Live snapshot refresh or MJPEG stream; click to enlarge | Any camera with a snapshot/MJPEG URL (Basic or Digest auth) |
| Printer | `printer` | State, alerts (e.g. "toner low"), ink/toner levels with colors, queued jobs, or 3D-print progress and temperatures | IPP/AirPrint, OctoPrint, Moonraker (Klipper) |
| Tasks | `tasks` | Local to-do list with priority and due dates, editable from the dashboard | `data/tasks.json` |
| Network | `network` | Reachability and latency history for every device and the internet | ICMP ping or TCP connect |
| Weather | `weather` | Current conditions, 24 h temperature curve, 6-day forecast, sunrise/sunset | [Open-Meteo](https://open-meteo.com/) (free, no key) |

The header shows a clock, the date with ISO week number, current weather and an overall health summary.

## Quick start

Requirements: **Node.js 20.12+** on the PC that drives the side monitor (Windows, macOS or Linux).

```powershell
git clone <this repo> NetworkDashboard
cd NetworkDashboard
npm install
npm run demo          # preview with fake data at http://localhost:3000
```

Then configure your own devices:

```powershell
copy config.example.json config.json
copy .env.example .env      # passwords and tokens go here
npm start
```

`config.json` and `.env` are git-ignored. Any `"${NAME}"` in `config.json` is replaced by the
environment variable `NAME` (from `.env` or the system), so secrets stay out of the config file.

> If `config.json` is missing, the server falls back to demo mode and shows a **Demo data** badge.

## Showing it on the side monitor

```powershell
npm run launch                           # Edge/Chrome app window, no tabs or address bar
.\scripts\launch.ps1 -X -1920            # side monitor is to the LEFT of the main screen
.\scripts\launch.ps1 -X 1920 -Kiosk      # true full screen instead of maximised window
```

`launch.ps1` opens the dashboard in a separate browser profile at the given screen position
(`-X`/`-Y` = top-left corner of the side monitor in Windows display coordinates), maximised.
The layout fills the window exactly at 1920×1080 with the taskbar and title bar visible. It switches to a
scrollable two-column layout when the window is smaller than about 1280×760.

**Start at login:** press <kbd>Win</kbd>+<kbd>R</kbd>, type `shell:startup`, and put a shortcut to
`start-dashboard.cmd` there. It starts the server minimised and opens the window.
Arguments are passed through, e.g. a shortcut target of `start-dashboard.cmd -X -1920`.

## Configuration

`config.json` has three parts:

```jsonc
{
  "title": "Home Network",
  "host": "127.0.0.1",      // use "0.0.0.0" to reach the dashboard from other devices
  "port": 3000,
  "locale": null,           // e.g. "sv-SE"; null = browser default
  "clock24h": true,
  "layout": {
    "columns": 4, "rows": 3,
    "areas": [               // CSS grid-template-areas, using panel ids; "." = empty cell
      "pc      pi       pihole   camera",
      "pc      nas      website  tasks",
      "network printer  weather  tasks"
    ]
  },
  "panels": [ /* one object per panel, see below */ ]
}
```

Devices with a self-made certificate authority (Pi-hole, many routers) can be checked with full
certificate validation instead of `"insecure": true`. List their root CA files (PEM) at the top level:
`"extraCaCerts": ["certs/pi-hole-root-ca.crt"]`. Node.js doesn't use the Windows certificate store,
so trusting the CA in Windows isn't enough.

A panel only appears if its `id` is in `layout.areas`. A panel spanning two rows (like `pc`
above) automatically shows extra charts (network graph and per-thread load).
Every panel accepts `id`, `type`, `title`, `refresh` (seconds), `icon`, and `"enabled": false`.

### This PC (`local`)

```json
{ "id": "pc", "type": "local", "title": "This PC", "refresh": 3 }
```

GPU load and temperature work for NVIDIA cards (through `nvidia-smi`). Everything else runs as a
normal user, so **don't run the dashboard as administrator**.

On Windows, the CPU temperature can't be read without a kernel driver, so it shows "no sensor" by default.
To get it, run [LibreHardwareMonitor](https://github.com/LibreHardwareMonitor/LibreHardwareMonitor)
(which runs elevated) with **Options → Remote Web Server** enabled on port 8085, and set `lhmUrl`:

```json
{ "id": "pc", "type": "local", "title": "This PC", "refresh": 3, "lhmUrl": "http://127.0.0.1:8085" }
```

`scripts\setup-cpu-temp-admin.ps1` (run it yourself as administrator) installs LibreHardwareMonitor and
starts it elevated at sign-in. Only LibreHardwareMonitor runs elevated; the dashboard stays unelevated.

### Raspberry Pi 5 and other Linux hosts (`agent`)

The [agent](agent/dashboard_agent.py) is one Python file using only the standard library.
On the Pi:

```bash
scp -r agent pi@raspberrypi.local:~/dashboard-agent
ssh pi@raspberrypi.local
cd ~/dashboard-agent
sudo bash install.sh "$(openssl rand -hex 16)" pihole-FTL,docker   # token, services to watch
```

This installs a systemd service on port **61209**. Then add the panel:

```json
{ "id": "pi", "type": "agent", "title": "Raspberry Pi 5",
  "url": "http://raspberrypi.local:61209", "token": "${PI_AGENT_TOKEN}", "refresh": 5 }
```

Agent options (edit `/etc/systemd/system/dashboard-agent.service`):
`--services a,b` (systemd units), `--docker` (container list; the user must be in the `docker` group),
`--apt` (pending updates, checked hourly), `--mounts /mnt/x` (always include a mount).
On a Pi it also reports fan RPM and `vcgencmd get_throttled` flags (under-voltage, throttling).

### Glances (`glances`)

TrueNAS, Unraid, OpenMediaVault and most Linux boxes can run `glances -w` (port 61208):

```json
{ "id": "nas", "type": "glances", "title": "NAS", "url": "http://nas.local:61208" }
```

### Synology NAS (`synology`)

Create a dedicated DSM user (Control Panel → User) **without 2-step verification**, in the
`administrators` group (DSM requires this for storage information). Then:

```json
{ "id": "nas", "type": "synology", "title": "NAS", "url": "https://nas.local:5001",
  "username": "dashboard", "password": "${NAS_PASSWORD}", "insecure": true }
```

`insecure: true` accepts the NAS's self-signed certificate. Not on Synology? Use `glances` or
`agent` instead.

**Without a DSM admin account:** run the agent in Docker on the NAS with
[agent/synology/compose.yaml](agent/synology/compose.yaml) and use an `agent` panel. It runs unprivileged
and read-only and can't see your files. You get CPU, RAM, temperature, volume usage and network, but not
RAID status or drive health.

### Pi-hole (`pihole`)

```json
{ "id": "pihole", "type": "pihole", "title": "Pi-hole", "url": "http://pi.hole",
  "password": "${PIHOLE_PASSWORD}", "version": 6 }
```

For Pi-hole v6, create an **app password** (Settings → Web interface / API → Configure app password)
and use it as `password`. For v5, set `"version": 5` and `"token"` to the API token from
Settings → API. The **Pause 5 min / 1 h / Enable** buttons call the Pi-hole API directly.

### Website & server (`http`)

```json
{ "id": "website", "type": "http", "title": "Website & Server", "refresh": 60,
  "sites": [
    { "name": "Website", "url": "https://example.com" },
    { "name": "API",     "url": "https://example.com/health", "keyword": "ok" },
    { "name": "Admin",   "url": "https://example.com/admin", "expectStatus": 401 }
  ],
  "host": { "type": "agent", "url": "http://my-server:61209", "token": "${SERVER_AGENT_TOKEN}" } }
```

Site options: `method`, `timeout`, `insecure`, `headers`, `username`/`password`, `keyword` (body
must contain it), `expectStatus`. Certificate expiry turns warning-colored under 21 days and
critical under 7. `host` is optional and accepts an `agent` or `glances` block to show the server's
CPU, memory and disk usage.

### Camera (`camera`)

```json
{ "id": "camera", "type": "camera", "title": "Hallway Camera",
  "snapshotUrl": "http://hallway-cam.local/snapshot.jpg",
  "mjpegUrl": null, "username": "viewer", "password": "${CAMERA_PASSWORD}", "refresh": 2 }
```

The server fetches the image (Basic and Digest auth are handled) and passes it to the browser.
Set `mjpegUrl` instead for a live stream. Click the panel to enlarge it; press <kbd>Esc</kbd> to close.
Common snapshot URLs:

| Camera / software | Snapshot URL |
| --- | --- |
| Reolink | `http://CAM/cgi-bin/api.cgi?cmd=Snap&channel=0&user=USER&password=PASS` |
| Hikvision | `http://CAM/ISAPI/Streaming/channels/101/picture` (Digest) |
| Dahua / Amcrest | `http://CAM/cgi-bin/snapshot.cgi` (Digest) |
| Axis | `http://CAM/axis-cgi/jpg/image.cgi` |
| Tapo / RTSP-only cameras | run [go2rtc](https://github.com/AlexxIT/go2rtc), then `http://GO2RTC:1984/api/frame.jpeg?src=hallway` |
| Frigate | `http://FRIGATE:5000/api/hallway/latest.jpg` |
| Home Assistant | `http://HA:8123/api/camera_proxy/camera.hallway` + `"headers": {"Authorization": "Bearer TOKEN"}` |

### Printer (`printer`)

Almost every network printer made in the last decade speaks IPP (AirPrint), so no driver or SNMP is needed:

```json
{ "id": "printer", "type": "printer", "title": "Printer", "protocol": "ipp", "host": "printer.local" }
```

Optional: `port` (631), `path` (`/ipp/print`), or a full `"uri": "ipps://printer.local/ipp/print"`.
A USB printer on the dashboard PC (Windows): `"protocol": "windows", "name": "<name from Get-Printer>"`.
That shows state, queued jobs and driver-reported errors (no paper, jam, low toner), but no toner levels.
For a 3D printer, use `"protocol": "octoprint"` with `url` and `apiKey`, or `"protocol": "moonraker"` with `url`.

### Tasks (`tasks`)

```json
{ "id": "tasks", "type": "tasks", "title": "Tasks" }
```

To show a [Vikunja](https://vikunja.io) task list instead, add `"source": "vikunja"`:

```json
{ "id": "tasks", "type": "tasks", "title": "Tasks", "source": "vikunja",
  "url": "http://vikunja:3456", "token": "${VIKUNJA_TOKEN}", "defaultProject": 1, "refresh": 30 }
```

It shows open tasks from all projects (or only `"projects": [1, 2]`) plus those completed in the last 24 h.
Ticking, starring (Vikunja priority 3) and adding work as usual; new tasks go to `defaultProject`.
Deleting is turned off in this mode, and "Clear completed" only hides tasks on the dashboard.

Otherwise tasks are stored in `data/tasks.json` (change with top-level `"tasksFile"`). Quick-add syntax:
`Buy toner ! @fri` means important and due Friday. Supported: `!`, `@today`, `@tomorrow`,
`@mon`…`@sun`, `@+3` (in 3 days), `@2026-12-24`. Click ☆ to toggle priority, hover a task to delete it.

### Network (`network`)

```json
{ "id": "network", "type": "network", "title": "Network", "refresh": 10,
  "devices": [
    { "name": "Router", "host": "192.168.1.1" },
    { "name": "Internet", "host": "1.1.1.1" },
    { "name": "Pi-hole DNS", "host": "pi.hole", "port": 53 }
  ] }
```

Without `port`, the system `ping` is used. With `port`, a TCP connection is timed, which is useful
for devices that ignore ping.

### Weather (`weather`)

```json
{ "id": "weather", "type": "weather", "title": "Weather", "location": "Stockholm",
  "latitude": 59.3293, "longitude": 18.0686, "refresh": 900 }
```

Optional: `"temperatureUnit": "fahrenheit"`, `"windUnit": "kmh" | "mph" | "ms"`.

## HTTP API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/config` | Layout and public panel settings (no secrets) |
| GET | `/api/state` | Latest data, status and error for every panel |
| POST | `/api/panels/:id/refresh` | Collect a panel now |
| GET | `/api/camera/:id/snapshot` · `/stream` | Camera proxy |
| POST | `/api/pihole/:id/blocking` | `{ "enabled": false, "timer": 300 }` |
| GET/POST | `/api/tasks` | List or add tasks |
| PATCH/DELETE | `/api/tasks/:id` | Update (`done`, `priority`, `text`, `due`) or delete |
| POST | `/api/tasks/clear-done` | Remove completed tasks |

## Project layout

```
server/
  index.js            Express server, scheduler, API routes
  collectors/         one module per data source (collect(panel, ctx) → data)
  lib/                HTTP client (TLS/Digest), IPP client, history buffers
  demo.js             generated demo data
  tasks.js            JSON-file task store
public/
  index.html, css/dashboard.css
  js/app.js           layout, polling, header
  js/panels.js        one renderer per panel type
  js/ui.js            formatters, gauges, charts, tooltips, icons
agent/                Python agent and systemd service for Linux hosts
scripts/launch.ps1    open as an app window on the side monitor
```

### Adding a new panel type

1. Create `server/collectors/<type>.js` exporting `defaultRefresh` and `async collect(panel, ctx)`.
   `ctx.cache` and `ctx.history` persist between runs.
2. Register it in the `collectors` map in `server/index.js`.
3. Add a renderer `{ update(body, data, cfg, api) }` to `renderers` in `public/js/panels.js`.

## Security notes

- By default the server listens on `127.0.0.1`, so only the PC itself can open the dashboard. If you set
  `"host": "0.0.0.0"`, anyone on your LAN can view it, edit tasks and pause Pi-hole. Don't expose it to the internet.
- Always set an agent `--token`. Use read-only or dedicated accounts for the NAS, camera and Pi-hole (app password).

## License

[MIT](LICENSE)
