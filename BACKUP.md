# Backup System Documentation

## Overview

The accounting application includes a comprehensive automated backup system that creates daily backups of your database and attachments, with optional transfer to a Synology NAS for off-site storage.

## Features

- **Automated Daily Backups**: Schedule backups using cron syntax
- **NAS Integration**: Automatic transfer to Synology NAS via SMB/CIFS
- **Retention Policy**: Automatic cleanup of old backups
- **Manual Backup**: Trigger backups on-demand from the Settings page
- **Local Backups**: Always keeps local copies before NAS transfer
- **Timestamped Archives**: Organized by date and time for easy recovery

## Configuration

### 1. Environment Variables

Add the following to your `.env` file:

```bash
# Enable/disable automatic backups
BACKUP_ENABLED=true

# Backup schedule (cron format: minute hour day month weekday)
# Default: "0 2 * * *" = Daily at 2:00 AM
BACKUP_CRON=0 2 * * *

# Synology NAS Configuration
BACKUP_NAS_HOST=192.168.1.30
BACKUP_NAS_SHARE=backup
BACKUP_NAS_FOLDER=accounting-backups
BACKUP_NAS_USERNAME=accounting-backup
BACKUP_NAS_PASSWORD=your-secure-password

# Backup retention (days)
BACKUP_RETENTION_DAYS=30

# Local backup directory (before transfer to NAS)
BACKUP_LOCAL_DIR=./backups
```

### 2. Synology NAS Setup

#### Creating a Backup User

1. Log into your Synology DSM
2. Go to **Control Panel** → **User & Group**
3. Click **Create** to add a new user
4. Set username: `accounting-backup` (or your chosen name)
5. Set a strong password
6. **Do not** give admin privileges
7. In the **Permissions** tab:
   - Grant **Read/Write** access to your backup shared folder
   - Deny access to all other folders

#### Creating a Backup Shared Folder

1. Go to **Control Panel** → **Shared Folder**
2. Click **Create**
3. Name: `backup` (or your chosen name)
4. Set permissions for the `accounting-backup` user: **Read/Write**
5. Optionally enable encryption for added security

#### Network Requirements

- Ensure SMB/CIFS file service is enabled:
  - Go to **Control Panel** → **File Services**
  - Enable **SMB service**
  - Set minimum SMB protocol to SMB2 or SMB3 for security

## Backup Schedule

The backup schedule uses standard cron syntax:

```
* * * * *
│ │ │ │ │
│ │ │ │ └─── Day of week (0-6, Sunday = 0)
│ │ │ └───── Month (1-12)
│ │ └─────── Day of month (1-31)
│ └───────── Hour (0-23)
└─────────── Minute (0-59)
```

### Common Schedules

- Daily at 2 AM: `0 2 * * *`
- Every 12 hours: `0 */12 * * *`
- Weekly on Sunday at 3 AM: `0 3 * * 0`
- Twice daily (6 AM & 6 PM): `0 6,18 * * *`

## Backup Process

### What Gets Backed Up

1. **Database File**: `accounting.db` - Complete SQLite database
2. **Attachments**: Entire `./data/attachments` directory with all uploaded files

### Backup Flow

1. **Create Local Backup**:
   - Creates timestamped folder: `./backups/YYYY-MM-DD_HH-mm-ss/`
   - Copies database file
   - Copies all attachments recursively

2. **Transfer to NAS** (if configured):
   - Mounts NAS share using credentials
   - Copies backup folder to NAS
   - Unmounts share

3. **Cleanup Old Backups**:
   - Removes local backups older than retention period
   - NAS backups are preserved (manual cleanup required)

### Platform-Specific Implementation

#### Windows
- Uses `net use` to map network drive
- Uses `xcopy` for file transfer
- Automatically unmounts drive after transfer

#### Linux/macOS
- Uses `mount` with CIFS filesystem
- Uses `cp -r` for file transfer
- Requires `sudo` access for mount operations

## Manual Backup

### Via Settings Page

1. Navigate to **Settings** in the application
2. Scroll to **Backup Management** section
3. Click **Trigger Manual Backup**
4. Confirm the action
5. Wait for backup completion (progress shown in UI)

### Via API

```bash
curl -X POST http://localhost:3000/api/backup/manual
```

## Monitoring

### Check Backup Status

Navigate to Settings → Backup Management to view:

- Backup enabled/disabled status
- Next scheduled backup time
- NAS configuration status
- Retention policy
- Last backup timestamp

### Backup Logs

Check server console logs for backup activity:

```bash
# For PM2-managed processes
pm2 logs accounting-backend

# Or check log files
tail -f logs/accounting-backend-out.log
```

## Restoration

### Restoring from Local Backup

1. Stop the application:
   ```bash
   pm2 stop accounting-backend
   pm2 stop accounting-frontend
   ```

2. Navigate to backup directory:
   ```bash
   cd backups
   ls  # List available backups
   ```

3. Copy files from desired backup:
   ```bash
   cp backups/2024-01-15_02-00-00/accounting.db data/
   cp -r backups/2024-01-15_02-00-00/attachments/* data/attachments/
   ```

4. Restart the application:
   ```bash
   pm2 start accounting-backend
   pm2 start accounting-frontend
   ```

### Restoring from NAS Backup

1. Mount your NAS or access via file explorer
2. Navigate to `//{NAS_HOST}/{SHARE}/{FOLDER}/`
3. Copy the desired backup folder to your local machine
4. Follow local restoration steps above

## Troubleshooting

### Backup Failing to Transfer to NAS

**Symptoms**: Backups created locally but not appearing on NAS

**Possible Causes**:
1. Incorrect credentials
2. Network connectivity issues
3. Insufficient permissions
4. SMB service not enabled on NAS

**Solutions**:
- Verify credentials in `.env` file
- Test NAS connectivity: `ping 192.168.1.30`
- Check Synology user permissions
- Ensure SMB service is enabled
- Review server logs for detailed error messages

### Permission Denied on Linux

**Symptoms**: "Permission denied" when mounting NAS

**Solution**: Ensure the user running the application can use `sudo`:
```bash
# Add user to sudoers for mount command (use with caution)
# Or run the application as a user with mount privileges
```

### Backups Not Running Automatically

**Symptoms**: Manual backups work but scheduled backups don't run

**Possible Causes**:
1. `BACKUP_ENABLED` not set to `true`
2. Invalid cron syntax
3. Server not running during scheduled time

**Solutions**:
- Verify `BACKUP_ENABLED=true` in `.env`
- Validate cron syntax using an online cron validator
- Check server uptime with `pm2 status`

### Disk Space Issues

**Symptoms**: Backup failures due to insufficient disk space

**Solutions**:
- Reduce `BACKUP_RETENTION_DAYS` to keep fewer backups
- Manually delete old backups from NAS
- Increase disk space on server or NAS
- Monitor backup sizes in Settings page

## Security Considerations

### Protecting Backup Credentials

- Never commit `.env` file to version control
- Use strong passwords for NAS backup user
- Restrict NAS user permissions to backup folder only
- Consider encrypting the NAS shared folder

### Network Security

- Keep NAS on private network (not exposed to internet)
- Use SMB3 protocol for encrypted transfers
- Consider VPN for remote backup access
- Regularly update NAS firmware for security patches

### Backup Encryption

For additional security:
1. Enable Synology shared folder encryption
2. Or use encrypted volumes on NAS
3. Protect NAS with 2FA enabled for admin access

## API Reference

### GET /api/backup/status

Returns current backup configuration and status.

**Response**:
```json
{
  "enabled": true,
  "schedule": "0 2 * * *",
  "nasConfigured": true,
  "config": {
    "nasHost": "192.168.1.30",
    "nasShare": "backup",
    "nasFolder": "accounting-backups",
    "retentionDays": 30,
    "localDir": "./backups"
  }
}
```

### POST /api/backup/manual

Triggers an immediate backup.

**Response** (success):
```json
{
  "success": true,
  "message": "Backup completed successfully",
  "timestamp": "2024-01-15T02:00:00.000Z",
  "localPath": "/path/to/backups/2024-01-15_02-00-00",
  "nasPath": "//192.168.1.30/backup/accounting-backups/2024-01-15_02-00-00",
  "size": 15728640
}
```

**Response** (error):
```json
{
  "error": "Backup Failed",
  "message": "NAS credentials not configured"
}
```

## Best Practices

1. **Test Restores Regularly**: Verify backups are restorable by performing test restores
2. **Monitor Backup Size**: Track backup sizes to anticipate storage needs
3. **Off-Site Backups**: NAS backups provide protection against local hardware failure
4. **Secure Credentials**: Rotate NAS passwords periodically
5. **Document Configuration**: Keep backup configuration documented for disaster recovery
6. **Multiple Retention Tiers**: Consider keeping different retention periods for daily/weekly/monthly backups

## Support

For issues or questions:
- Check server logs for detailed error messages
- Review this documentation
- File issues on GitHub repository
