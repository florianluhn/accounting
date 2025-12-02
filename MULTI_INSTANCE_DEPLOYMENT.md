# Multi-Instance Deployment Guide

This guide explains how to run multiple instances of the accounting application on the same device (e.g., Raspberry Pi), each serving a different entity (personal, business, different companies, etc.).

## Overview

Each instance requires:
- **Unique ports** for both frontend and backend
- **Separate database** and attachments directory
- **Unique PM2 process names**
- **Custom app name/branding** (optional)

## Quick Start

### 1. Create Multiple Installation Directories

```bash
# Create separate directories for each instance
mkdir -p ~/accounting-personal
mkdir -p ~/accounting-business

# Clone or copy the application to each directory
cd ~/accounting-personal
git clone <repository-url> .

cd ~/accounting-business
git clone <repository-url> .
```

### 2. Configure Each Instance

For each instance directory, create a `.env` file from the provided examples:

#### Instance 1 (Personal):
```bash
cd ~/accounting-personal
cp .env.instance1.example .env

# Edit the .env file
nano .env
```

Example configuration for personal instance:
```env
APP_NAME=Personal Accounting
APP_SHORT_NAME=Personal
BACKEND_PORT=3001
FRONTEND_PORT=5174
DATABASE_PATH=./data/personal/accounting.db
ATTACHMENTS_PATH=./data/personal/attachments
PM2_BACKEND_NAME=personal-accounting-backend
PM2_FRONTEND_NAME=personal-accounting-frontend
LOG_DIR=./logs/personal
```

#### Instance 2 (Business):
```bash
cd ~/accounting-business
cp .env.instance2.example .env

# Edit the .env file
nano .env
```

Example configuration for business instance:
```env
APP_NAME=Business Accounting
APP_SHORT_NAME=Business
BACKEND_PORT=3002
FRONTEND_PORT=5175
DATABASE_PATH=./data/business/accounting.db
ATTACHMENTS_PATH=./data/business/attachments
PM2_BACKEND_NAME=business-accounting-backend
PM2_FRONTEND_NAME=business-accounting-frontend
LOG_DIR=./logs/business
```

### 3. Install and Build Each Instance

For each instance:

```bash
# Install dependencies
pnpm install

# Build the application
pnpm run build

# Create data directories
mkdir -p data logs

# Run database migrations
pnpm run migrate

# (Optional) Seed with initial data
pnpm run seed
```

### 4. Start Each Instance

```bash
# Instance 1 (Personal)
cd ~/accounting-personal
pm2 start ecosystem.config.cjs
pm2 save

# Instance 2 (Business)
cd ~/accounting-business
pm2 start ecosystem.config.cjs
pm2 save
```

### 5. Access Your Instances

- **Personal Accounting**: `http://your-pi-ip:5174`
- **Business Accounting**: `http://your-pi-ip:5175`

## Configuration Reference

### Required Unique Settings Per Instance

| Setting | Description | Example Values |
|---------|-------------|----------------|
| `BACKEND_PORT` | Backend API server port | 3001, 3002, 3003 |
| `FRONTEND_PORT` | Frontend web server port | 5174, 5175, 5176 |
| `DATABASE_PATH` | SQLite database file path | `./data/personal/accounting.db` |
| `ATTACHMENTS_PATH` | Uploaded files directory | `./data/personal/attachments` |
| `PM2_BACKEND_NAME` | PM2 backend process name | `personal-accounting-backend` |
| `PM2_FRONTEND_NAME` | PM2 frontend process name | `personal-accounting-frontend` |
| `LOG_DIR` | Log files directory | `./logs/personal` |

### Optional Branding Settings

| Setting | Description | Default |
|---------|-------------|---------|
| `APP_NAME` | Full application name | `Accounting App` |
| `APP_SHORT_NAME` | Short name for UI | `Accounting` |
| `APP_DESCRIPTION` | Application description | `Personal finance accounting...` |

### Port Recommendations

Use sequential ports for easier management:

| Instance | Backend Port | Frontend Port |
|----------|--------------|---------------|
| Instance 1 | 3001 | 5174 |
| Instance 2 | 3002 | 5175 |
| Instance 3 | 3003 | 5176 |
| Instance 4 | 3004 | 5177 |

## Managing Multiple Instances

### View All Running Instances
```bash
pm2 list
```

### Stop a Specific Instance
```bash
# Stop personal instance
pm2 stop personal-accounting-backend personal-accounting-frontend

# Stop business instance
pm2 stop business-accounting-backend business-accounting-frontend
```

### Restart a Specific Instance
```bash
# Restart personal instance
pm2 restart personal-accounting-backend personal-accounting-frontend

# Restart business instance
pm2 restart business-accounting-backend business-accounting-frontend
```

### View Logs for a Specific Instance
```bash
# Personal instance logs
pm2 logs personal-accounting-backend
pm2 logs personal-accounting-frontend

# Business instance logs
pm2 logs business-accounting-backend
pm2 logs business-accounting-frontend
```

### Delete an Instance
```bash
# Stop and delete from PM2
pm2 delete personal-accounting-backend personal-accounting-frontend

# Remove the directory
rm -rf ~/accounting-personal
```

## Updating an Instance

```bash
cd ~/accounting-personal  # or ~/accounting-business

# Pull latest changes
git pull

# Install any new dependencies
pnpm install

# Run migrations (if any)
pnpm run migrate

# Rebuild
pnpm run build

# Restart PM2 processes
pm2 restart personal-accounting-backend personal-accounting-frontend
```

## Troubleshooting

### Port Already in Use
If you get a port conflict error:
1. Check which process is using the port: `sudo lsof -i :5174`
2. Update your `.env` file to use different ports
3. Restart the instance

### Database Not Found
1. Ensure data directory exists: `mkdir -p data/personal`
2. Run migrations: `pnpm run migrate`

### PM2 Process Name Conflict
If PM2 complains about duplicate process names:
1. Ensure each instance has unique `PM2_BACKEND_NAME` and `PM2_FRONTEND_NAME` in `.env`
2. Delete existing processes: `pm2 delete accounting-backend accounting-frontend`
3. Restart with new names

### Changes Not Appearing
1. Rebuild the app: `pnpm run build`
2. Restart PM2: `pm2 restart <instance-name>`
3. Clear browser cache (Ctrl+Shift+R or Cmd+Shift+R)

## Security Considerations

1. **Firewall**: Configure firewall to only allow access from trusted networks
2. **Database Backups**: Set up regular backups for each instance's database
3. **File Permissions**: Ensure proper file permissions on data directories
4. **Network Access**: Consider using a reverse proxy (nginx) for HTTPS support

## Example: Three Instances on Same Device

```bash
# Personal
~/accounting-personal     → http://192.168.1.100:5174 (Backend: 3001)

# Business
~/accounting-business     → http://192.168.1.100:5175 (Backend: 3002)

# Client Work
~/accounting-client       → http://192.168.1.100:5176 (Backend: 3003)
```

Each instance operates independently with its own:
- Database
- Attachments
- Logs
- PM2 processes
- Custom branding

## Backup Strategy

For each instance:

```bash
#!/bin/bash
# backup-instance.sh

INSTANCE_NAME="personal"
BACKUP_DIR="~/backups/$INSTANCE_NAME/$(date +%Y%m%d)"

mkdir -p "$BACKUP_DIR"

# Backup database
cp ~/accounting-$INSTANCE_NAME/data/$INSTANCE_NAME/accounting.db "$BACKUP_DIR/"

# Backup attachments
cp -r ~/accounting-$INSTANCE_NAME/data/$INSTANCE_NAME/attachments "$BACKUP_DIR/"

# Compress
tar -czf "$BACKUP_DIR.tar.gz" "$BACKUP_DIR"
rm -rf "$BACKUP_DIR"
```

Set up a cron job to run daily backups for each instance.

## Advanced: Nginx Reverse Proxy

If you want to access instances via domain names instead of ports:

```nginx
# /etc/nginx/sites-available/accounting

# Personal instance
server {
    listen 80;
    server_name personal.accounting.local;

    location / {
        proxy_pass http://localhost:5174;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /api {
        proxy_pass http://localhost:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}

# Business instance
server {
    listen 80;
    server_name business.accounting.local;

    location / {
        proxy_pass http://localhost:5175;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /api {
        proxy_pass http://localhost:3002;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

Then add to `/etc/hosts`:
```
192.168.1.100  personal.accounting.local
192.168.1.100  business.accounting.local
```
