# The Firmament

A self-hosted homelab portal with an AI guardian 
character, live infrastructure metrics, and a 
fully configurable admin panel.

![The Firmament](https://raw.githubusercontent.com/bferd/the-firmament/main/public/images/preview.png)

## Features

- AI guardian character with scroll-driven video animations
- Service card dashboard with full admin CRUD panel
- Live Proxmox/InfluxDB node metrics in side panel
- Borg-UI backup status integration
- Authelia SSO forward auth integration
- Auth-gated and offline-detection service cards
- Full theme system with presets, colour pickers, font selector
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
# Edit docker-compose.yml with your IPs
docker compose up -d --build
```

Then visit `http://your-server-ip:3000`

## Configuration

All configuration is done through the admin 
panel at `/admin` — protected by Authelia.

Configure services, categories, theme, 
metrics, backup status, and more without 
touching any code.

## Character Videos

This repo does not include character videos.
Generate your own using Higgsfield.ai or 
similar AI video tools and place them in 
the `/videos` directory:

- `engel-welcome.webm` — plays once on load
- `engel-idle-loop.webm` — loops on hero
- `engel-transition.webm` — scroll trigger
- `engel-browse-idle.webm` — side panel loop
- `hero-background.mp4` — hero background

## Requirements

- Docker + Docker Compose
- Authelia (for admin auth)
- NPMplus or nginx reverse proxy
- InfluxDB v2 with Proxmox metrics (optional)
- Borg-UI (optional)

## License

MIT — see LICENSE file.

## Credits

Created by Brad Schroth
schroth.ca
