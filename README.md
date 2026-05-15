# The Firmament

A self-hosted homelab portal with an AI guardian 
character, live infrastructure metrics, and a 
fully configurable admin panel.

![Hero](https://raw.githubusercontent.com/bferd/the-firmament/main/public/images/preview-hero.png)

[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-support%20this%20project-FFDD00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black)](https://buymeacoffee.com/schrothdotca)

## Features

- AI guardian character with scroll-driven video animations
- Service card dashboard with full admin CRUD panel
- Four card styles: glassmorphism, solid, minimal, bordered
- Live Proxmox/InfluxDB node metrics in side panel
- Borg-UI backup status integration
- Authelia SSO forward auth integration
- Auth-gated and offline-detection service cards
- Configurable welcome modal (title, body, button text)
- Full theme system with presets, dual accent colours, colour pickers, font selector, card opacity
- Custom font upload (.woff2/.woff/.ttf) for heading, body, and mono slots
- ENGEL side panel with per-node and per-metric visibility controls
- Character blend mode, status overlay, and mobile panel visibility controls
- Mobile responsive
- Docker deployment

## Stack

- Node.js + Express
- SQLite (better-sqlite3)
- Vanilla HTML/CSS/JS
- Docker (two-stage build, ~400MB image)

## Quick Start

```bash
git clone https://github.com/bferd/the-firmament
cd the-firmament
cp .env.example .env
cp docker-compose.example.yml docker-compose.yml
```

Edit `.env` and fill in your values:
- `AUTHELIA_URL` — your Authelia instance IP and port
- `NPMPLUS_IP` — your NPMplus reverse proxy IP
- `BIND_IP` — your server IP
- `PROXY_SECRET` — generate a random secret (see below)

Make the same IP and PROXY_SECRET changes in `docker-compose.yml`.

Generate a secure PROXY_SECRET:
```bash
openssl rand -hex 32
```

Then add the same value to your NPMplus Advanced config for the schroth.ca proxy host:
```nginx
proxy_set_header X-Proxy-Secret your-generated-secret;
```

> **Security note:** PROXY_SECRET prevents admin API bypass. 
> Without it any device on your LAN could access the admin 
> API directly without going through Authelia.

Then build and start:
```bash
# Create the data directory with correct permissions
mkdir -p data
sudo chown -R 1000:1000 data

docker compose up -d --build
```

Then visit `http://your-server-ip:3000`

> **Note:** InfluxDB and Borg-UI tokens are configured through the admin panel at `/admin` — not in `.env`.

## Services Dashboard

![Services](https://raw.githubusercontent.com/bferd/the-firmament/main/public/images/preview-services.png)

All configuration is done through the admin 
panel at `/admin` — protected by Authelia.

Configure services, categories, theme, 
metrics, backup status, and more without 
touching any code.

## Mobile


<img src="https://raw.githubusercontent.com/bferd/the-firmament/main/public/images/preview-mobile_fullpage.jpg" width="300" alt="Mobile Full Page">

The portal is fully responsive. On mobile 
the hero works as on desktop. The services 
section shows one card per row. The side 
panel can be shown or hidden on mobile 
via the admin panel.

## Admin Panel

### Live Metrics
![Admin Live Metrics](https://raw.githubusercontent.com/bferd/the-firmament/main/public/images/preview-metrics.png)

### Services & Categories
![Admin Add Service](https://raw.githubusercontent.com/bferd/the-firmament/main/public/images/preview-add_service.png)

![Admin Categories](https://raw.githubusercontent.com/bferd/the-firmament/main/public/images/preview-categories.png)

### Layout Settings
![Admin Layout](https://raw.githubusercontent.com/bferd/the-firmament/main/public/images/preview-layout.png)

## Theming & Customization

Themes are fully configured through the admin panel — no CSS edits required for normal use. If you do customize the stylesheet directly, the primary and secondary accent colours use these CSS variables:

| Variable | Description |
|----------|-------------|
| `--accent` | Primary accent colour (maps to `theme_accent_primary`) |
| `--accent-rgb` | Comma-separated RGB of `--accent`, e.g. `0,229,255` |
| `--accent2` | Secondary accent colour (maps to `theme_accent_secondary`) |
| `--accent2-rgb` | Comma-separated RGB of `--accent2`, e.g. `139,92,246` |

These are set at runtime by `applyTheme()` in `main.js`. Use them in custom CSS as `rgba(var(--accent-rgb), 0.4)` rather than hardcoding hex values, so your additions stay theme-aware.

> **Note:** These variables were renamed from `--cyan`/`--purple` in an earlier version. If you have local CSS overrides that reference `--cyan` or `--purple`, update them to `--accent` and `--accent2`.

## Character Videos

This repo does not include character videos.
Generate your own using Higgsfield.ai or 
similar AI video tools and place them in 
the `/videos` directory:

- `hero-welcome.webm` — plays once on load
- `hero-idle-loop.webm` — loops on hero
- `hero-transition.webm` — scroll trigger
- `hero-browse-idle.webm` — side panel loop
- `hero-background.mp4` — hero background

## Requirements

- Docker + Docker Compose
- Authelia (for admin auth)
- NPMplus (recommended — has built-in Authelia integration)
- NPM or nginx (supported but requires manual Authelia auth_request configuration)
- InfluxDB v2 with Proxmox metrics (optional)
- Borg-UI (optional)

## Docker Compose Configuration

Before running, edit `docker-compose.yml` and 
update these values for your setup:

```yaml
ports:
  - "YOUR_SERVER_IP:3000:3000"  # Change to your server IP

environment:
  - AUTHELIA_URL=http://YOUR_AUTHELIA_IP:9091  # Your Authelia instance
  - NPMPLUS_IP=YOUR_NPMPLUS_IP                 # Your reverse proxy IP
  - PROXY_SECRET=your-random-secret-here       # Generate a random string
```

### PROXY_SECRET

Generate a secure random secret:
```bash
openssl rand -hex 32
```

Use the same value in both `docker-compose.yml` 
and your reverse proxy Advanced config:
```nginx
proxy_set_header X-Proxy-Secret your-secret-here;
```

### Volumes

The compose file expects these directories:
- `./data/` — SQLite database (created automatically)
- `./videos/` — Character and background videos (add your own)
- `./fonts/` — Custom uploaded fonts (created automatically)
- `./public/` — Static assets

### Ports

The app runs on port 3000 internally. Bind it 
to your server IP rather than 0.0.0.0 to avoid 
exposing it beyond your local network.

## Notes & Troubleshooting

### Proxmox Backup Server (PBS) node metrics

PBS nodes expose memory differently from standard PVE nodes. A PBS node reports memory as a **float percentage (0–100)** rather than used/total bytes. Similarly, disk usage for PBS represents **datastore usage in GB**, not raw bytes like LXC/QEMU containers.

To handle this correctly, add `"node_type": "pbs"` to the node mapping for any PBS node in the admin panel (Settings → InfluxDB → Node Mappings). PVE nodes do not need this field (it defaults to `"pve"`).

```json
{ "host": "proxmox-backup-server", "display": "PBS", "node_type": "pbs" }
```

Without this flag, PBS memory and disk values will be misread — memory will appear as a near-zero percentage and disk will be off by several orders of magnitude.

---

## License

MIT — see LICENSE file.

## Credits

Created by [Brad Schroth](https://linkstack.schroth.ca/@brad) — [schroth.ca](https://schroth.ca)
