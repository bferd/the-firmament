# The Firmament

A self-hosted homelab portal with an AI guardian 
character, live infrastructure metrics, and a 
fully configurable admin panel.

![Hero](https://raw.githubusercontent.com/bferd/the-firmament/main/public/images/preview-hero.png)

[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-support%20this%20project-FFDD00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black)](https://buymeacoffee.com/schrothdotca)

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

## License

MIT — see LICENSE file.

## Credits

Created by [Brad Schroth](https://linkstack.schroth.ca/@brad) — [schroth.ca](https://schroth.ca)
