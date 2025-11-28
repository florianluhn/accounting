# Quick Deployment Reference

> **📖 Full deployment guide**: See [README.md](README.md#production-deployment-on-raspberry-pi) for complete step-by-step instructions.

This is a quick reference card for common deployment tasks. For first-time setup, use the full guide in README.md.

---

## Architecture

```
Raspberry Pi
├─ PM2 Process Manager
│  ├─ Backend (Port 3000) - Fastify API + SQLite
│  └─ Frontend (Port 5173) - SvelteKit SSR + PWA
```

**Key Point**: Uses `@sveltejs/adapter-node` to run SvelteKit as a Node.js server (not static files).

---

## Quick Start (First Time)

```bash
# 1. Install dependencies
cd ~/accounting
npm install --legacy-peer-deps
npm uninstall vite && npm install --legacy-peer-deps vite@5.4.11

# 2. Build
npm run build

# 3. Start with PM2
mkdir -p logs
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup  # Follow instructions

# 4. Check status
pm2 status
```

---

## Updates

**Automated (Recommended)**
```bash
cd ~/accounting
chmod +x deploy.sh  # First time only
./deploy.sh
```

**Manual**
```bash
cd ~/accounting
git pull
npm install --legacy-peer-deps
npm run build
pm2 restart all
```

---

## Common Commands

```bash
# Status & Monitoring
pm2 status                    # Check status
pm2 logs                      # View all logs
pm2 logs accounting-backend   # Backend logs only
pm2 logs accounting-frontend  # Frontend logs only
pm2 monit                     # Resource monitor

# Control
pm2 restart all               # Restart both services
pm2 stop all                  # Stop both services
pm2 delete all                # Remove from PM2
pm2 start ecosystem.config.cjs # Start from config

# Troubleshooting
pm2 logs --lines 100          # View last 100 log lines
pm2 flush                     # Clear all logs
pm2 reset all                 # Reset restart counters
```

---

## Important: Vite Version

⚠️ **Must use Vite 5.4.11** (Vite 6.x breaks SvelteKit builds)

```bash
npm uninstall vite
npm install --legacy-peer-deps vite@5.4.11
```

---

## Configuration Files

| File | Purpose |
|------|---------|
| `ecosystem.config.cjs` | PM2 config (ports, memory, processes) |
| `.env.production` | Optional (database paths only) |
| `deploy.sh` | Automated deployment script |

**Port Configuration**: Defined in `ecosystem.config.cjs` (not .env)
- Backend: 3000
- Frontend: 5173

---

## Access Points

- **Direct**: `http://raspberry-pi-ip:5173`
- **With Nginx**: `http://raspberry-pi-ip`
- **PWA**: Install from browser menu

---

## Troubleshooting

**Build fails**
```bash
# Check Vite version (should be 5.4.11)
npm list vite

# Reinstall with correct version
npm uninstall vite
npm install --legacy-peer-deps vite@5.4.11
npm run build
```

**Can't connect from other devices**
```bash
# Check if ports are listening
sudo netstat -tlnp | grep -E '3000|5173'

# Check firewall
sudo ufw status
sudo ufw allow 5173/tcp
sudo ufw allow 3000/tcp
```

**Database locked**
```bash
pm2 stop all
sleep 5
pm2 start all
```

**Out of memory**
```bash
# Check memory
free -h

# Increase swap
sudo dphys-swapfile swapoff
sudo nano /etc/dphys-swapfile  # Set CONF_SWAPSIZE=1024
sudo dphys-swapfile setup
sudo dphys-swapfile swapon
```

---

## Files Included

- ✅ `ecosystem.config.cjs` - PM2 configuration (in repo)
- ✅ `deploy.sh` - Deployment script (in repo)
- 📝 `.env.production` - You create this (optional)

---

## Need Help?

- 📖 **Full Guide**: [README.md - Production Deployment](README.md#production-deployment-on-raspberry-pi)
- 🔧 **PM2 Docs**: https://pm2.keymetrics.io/
- 🚀 **SvelteKit adapter-node**: https://kit.svelte.dev/docs/adapter-node

---

**Quick Architecture Notes:**
- Both frontend and backend run as separate Node.js processes
- Frontend is NOT static files - it's a SvelteKit SSR server
- PM2 manages both processes with auto-restart
- Logs stored in `./logs/` directory
- Database stored in `./data/accounting.db`
