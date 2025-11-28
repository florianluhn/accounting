# Quick Deployment Reference

## Architecture Overview

This application uses **@sveltejs/adapter-node** for production deployment, running two separate Node.js processes:

1. **Backend Server** (Port 3000) - Fastify API server
2. **Frontend Server** (Port 5173) - SvelteKit SSR server

Both are managed by PM2 for automatic restarts and monitoring.

## Key Files

- **`ecosystem.config.cjs`** - PM2 configuration for both processes
- **`deploy.sh`** - Automated deployment script
- **`svelte.config.js`** - Uses @sveltejs/adapter-node
- **`vite.config.ts`** - Proxy configuration for /api routes

## Important: Vite Version

⚠️ **Must use Vite 5.4.11** - Vite 6.x has compatibility issues with SvelteKit adapters.

```bash
npm uninstall vite
npm install --legacy-peer-deps vite@5.4.11
```

## Quick Commands

### First Time Setup
```bash
git clone <repo-url> accounting
cd accounting
npm install --legacy-peer-deps
npm uninstall vite && npm install --legacy-peer-deps vite@5.4.11
npm run build
mkdir -p logs
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup  # Follow instructions
```

### Updates (Automated)
```bash
cd ~/accounting
./deploy.sh
```

### Updates (Manual)
```bash
cd ~/accounting
git pull
npm install --legacy-peer-deps
npm run build
pm2 restart all
```

### Monitoring
```bash
pm2 status              # Check status
pm2 logs                # View all logs
pm2 logs accounting-frontend
pm2 logs accounting-backend
pm2 monit               # Resource monitor
```

### Troubleshooting
```bash
pm2 restart all         # Restart both services
pm2 stop all            # Stop both services
pm2 delete all          # Remove from PM2
pm2 start ecosystem.config.cjs  # Restart from config
```

## Port Configuration

- **Frontend**: 5173 (SvelteKit server)
- **Backend**: 3000 (Fastify API)
- **Nginx** (optional): 80/443 (reverse proxy)

## Environment Variables

Create `.env.production`:

```env
HOST=0.0.0.0
PORT=3000
NODE_ENV=production
DATABASE_PATH=./data/accounting.db
ATTACHMENTS_PATH=./data/attachments
```

## Access Points

- Direct: `http://<raspberry-pi-ip>:5173`
- With Nginx: `http://<raspberry-pi-ip>`
- PWA: Install from browser

## Build Output

After running `npm run build`:
- `build/` - SvelteKit server code (frontend)
- `.svelte-kit/output/` - Compiled assets

## Common Issues

### Build fails with Vite manifest error
**Solution**: Downgrade to Vite 5.4.11 (see above)

### Cannot access from other devices
**Solution**:
- Check firewall: `sudo ufw allow 5173/tcp`
- Verify HOST is set to `0.0.0.0` in ecosystem config

### Database locked errors
**Solution**:
```bash
pm2 stop all
sleep 5
pm2 start all
```

### Out of memory
**Solution**: Increase swap or reduce PM2 `max_memory_restart` values

## Backup

```bash
# Backup database and attachments
tar -czf backup-$(date +%Y%m%d).tar.gz data/

# Restore
tar -xzf backup-20250101.tar.gz
```

## PM2 Ecosystem Config

The `ecosystem.config.cjs` file defines:
- Process names
- Scripts to run
- Memory limits (500M backend, 300M frontend)
- Environment variables
- Log file locations (`./logs/`)

## Updates Checklist

1. ✅ Pull latest code: `git pull`
2. ✅ Install dependencies: `npm install --legacy-peer-deps`
3. ✅ Verify Vite version: `npm list vite` (should be 5.4.11)
4. ✅ Build application: `npm run build`
5. ✅ Restart services: `pm2 restart all`
6. ✅ Check status: `pm2 status`
7. ✅ Test access: `curl http://localhost:5173`

## Security Notes

- No built-in authentication - restrict network access
- Use firewall to limit access
- Consider Nginx reverse proxy with SSL
- Regular backups recommended
- Keep dependencies updated

## Performance Tips

- Use SD card class 10+ for better I/O
- Enable swap (1GB minimum)
- Monitor with `pm2 monit`
- Single instance per process (suitable for Pi)
- PWA enables offline functionality

## Further Reading

- See [README.md](README.md) for full deployment guide
- PM2 docs: https://pm2.keymetrics.io/
- SvelteKit adapter-node: https://kit.svelte.dev/docs/adapter-node
