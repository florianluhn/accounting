# Personal Accounting Application


## Accounts, permissions, and upgrading

The API requires a signed-in user. The first person to open the app creates the administrator account. Existing journal data is kept. Administrators can add users, set rights (`add`, `add + edit`, or `add + edit + delete`), and create API tokens for an assistant (`Authorization: Bearer acct_...`).

On the Raspberry Pi, from a clean checkout:

```bash
# In .env set BACKEND_HOST=127.0.0.1 and, behind HTTPS, COOKIE_SECURE=true
chmod +x scripts/update.sh
./scripts/update.sh
```

The script refuses a dirty working tree, copies the database and attachments into `backups/pre-update-<timestamp>/`, fast-forwards `main`, runs `npm ci` and the production build, applies startup migrations, and restarts only `accounting-backend` and `accounting-frontend`. It writes the full transcript to `logs/update-<timestamp>.log` and prints that path. If a step fails it resets to the commit from before the pull, rebuilds that commit, and restarts those two processes only when that rebuild succeeds. Vite prints two "Build failed" lines for one `npm run build` because the browser bundle and the server bundle are separate.

You can also seed or reset an administrator from the machine:

```bash
ADMIN_USERNAME=florian ADMIN_PASSWORD='a-long-password' npx tsx scripts/create-admin.ts
# or add --reset to replace that user's password and keep them as admin
```

After upgrading, check one balance sheet (opening balances now stay on the statement), one foreign-currency report (entries in that currency keep their original amount), and one depreciation schedule if you use half-year or mid-quarter straight-line. Money is stored as integer cents. The migrator copies the database file first and refuses to continue if cent totals do not match.

NAS backups no longer put the password on the command line. They still use `sudo mount` unless the share is already mounted. Set `AVAILABILITY_ROOT` if booking availability sync should be limited to a directory other than the home directory.


A comprehensive double-entry bookkeeping system built with SvelteKit 5, TypeScript, and Fastify. This application provides a complete solution for managing personal or small business finances with support for multiple currencies, journal entries, and financial reporting.

## Tech Stack

**Frontend:**
- **SvelteKit 5** - Modern full-stack framework with Svelte 5 runes
- **TypeScript** - Type-safe development
- **TailwindCSS + DaisyUI** - Utility-first styling with UI components
- **Vite** - Fast build tool and dev server

**Backend:**
- **Fastify** - High-performance web framework
- **Drizzle ORM** - Type-safe database queries
- **SQLite** - Lightweight file-based database
- **TypeScript** - End-to-end type safety

**Deployment:**
- **Node.js** adapter for production
- **PM2** - Process manager with auto-restart
- **PWA** - Progressive Web App for mobile installation

## Features

### Core Accounting
- **Double-Entry Bookkeeping**: Every transaction maintains the fundamental accounting equation (Assets = Liabilities + Equity)
- **Chart of Accounts**: Manage General Ledger (GL) accounts and Subledger accounts
- **Journal Entries**: Record financial transactions with debit and credit entries
- **Multi-Currency Support**: Track transactions in multiple currencies with automatic USD conversion

### Account Management
- **GL Accounts**: Create accounts for different types (Asset, Cash, Accounts Receivable, Equity, Accounts Payable, Profit, Loss, Opening Balance)
- **Subledger Accounts**: Link detailed accounts to GL accounts with currency-specific tracking
- **Account Status**: Enable/disable accounts as needed
- **Hierarchical Structure**: Organize accounts with account numbers and types

### Financial Reports
- **Balance Sheet**: View your financial position with assets, liabilities, and equity
- **Profit & Loss Statement**: Track revenue and expenses over time periods
- **Trial Balance**: Verify that debits equal credits across all accounts
- **Account Ledger**: View detailed transaction history for individual accounts
- **Date Range Filtering**: Generate reports for specific time periods
- **Multi-Currency Reports**: View reports in any configured currency

### Dashboard
- **Real-Time Financial Overview**: See total assets, liabilities, equity at a glance
- **Transaction Counter**: Track journal entries created this month
- **Balance Verification**: Instant notification if books are balanced
- **Currency Selector**: Switch between currencies for dashboard view
- **Quick Actions**: Create new journal entries directly from dashboard
- **PWA Support**: Install as mobile app for offline access

### Journal Entries
- **File Attachments**: Upload receipts, invoices, and supporting documents (max 10MB per file)
- **Multiple Attachments**: Attach multiple files to each journal entry
- **Download & Delete**: Manage attachments with download and delete capabilities
- **Date Range Filtering**: Filter journal entries by start and end date
- **Search Functionality**: Search entries by description, category, or account name
- **Edit & Delete**: Modify or remove journal entries with full attachment support

### Settings & Configuration
- **Currency Management**: Add, edit, and manage multiple currencies
- **Exchange Rates**: Configure exchange rates for currency conversion
- **Default Currency**: Set a default currency for the application
- **Database Information**: View database and attachment storage paths
- **Network Access**: Configure server to allow LAN/mobile device access
- **Backup Management**: Configure and monitor automated daily backups

### Backup System
- **Automated Daily Backups**: Schedule backups using cron syntax (e.g., daily at 2 AM)
- **Synology NAS Integration**: Automatic transfer to NAS via SMB/CIFS for off-site storage
- **Retention Policy**: Automatic cleanup of old backups based on configurable retention period
- **Manual Backup Trigger**: On-demand backups from the Settings page or API
- **Complete Data Backup**: Includes both database and all attachments
- **Timestamped Archives**: Organized backups with date/time stamps for easy recovery
- **Platform Support**: Works on Windows (net use/xcopy) and Linux/macOS (mount/cp)
- **Status Monitoring**: View backup status, schedule, and NAS configuration in real-time
- See [BACKUP.md](BACKUP.md) for detailed setup and configuration instructions

### Audit Trail
- **Complete Change History**: Track all CREATE, UPDATE, and DELETE operations across all entities
- **Before/After States**: View full JSON representation of data before and after changes
- **Source Tracking**: Identify whether changes came from Web UI, CSV Import, or API
- **Advanced Filtering**: Filter audit logs by date range, resource type, operation, and source
- **Batch Operations**: CSV imports tracked as single batch entries with summary information
- **Export Capabilities**: Download audit logs in CSV or JSON format for archival
- **Detailed View**: Click any audit log entry to see complete details including old and new data
- **Immutable Records**: Audit logs cannot be modified or deleted, ensuring data integrity

## Technology Stack

### Frontend
- **SvelteKit 5**: Modern frontend framework with Svelte 5 runes ($state, $effect, $derived)
- **@sveltejs/adapter-node**: Production adapter for Node.js deployment
- **TypeScript**: Type-safe development
- **TailwindCSS**: Utility-first styling
- **DaisyUI**: Beautiful UI components
- **Vite 5.4.11**: Fast build tool and development server (requires 5.x for SvelteKit compatibility)
- **PWA Support**: Progressive Web App with offline capabilities via vite-plugin-pwa

### Backend
- **Fastify**: Fast and low overhead web framework
- **Drizzle ORM**: Type-safe database ORM
- **SQLite**: Lightweight, file-based database
- **TypeScript**: End-to-end type safety
- **Multipart File Upload**: Handle file attachments with @fastify/multipart
- **UUID**: Unique file naming for attachments

## Project Structure

```
accounting/
 src/
    routes/                 # SvelteKit pages
       +page.svelte       # Dashboard
       accounts/          # GL & Subledger accounts
       journals/          # Journal entries
       reports/           # Financial reports
         audit/             # Audit trail and change history
    lib/
       api.ts             # API client and types
    app.html
 server/
    index.ts               # Fastify server
      db/
         connection.ts      # Database setup and migrations
         schema.ts          # Database schema definitions
      routes/                # API endpoints
         audit-logs.ts      # Audit log API
      services/
         audit.ts           # Audit logging service
 data/
    accounting.db          # SQLite database
    attachments/           # File uploads
 vite.config.ts
```

## Getting Started

### Prerequisites
- Node.js 18+
- npm or yarn

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd accounting
```

2. Install dependencies:
```bash
npm install
```

3. Start the backend server:
```bash
npm run server
```

4. In a new terminal, start the frontend development server:
```bash
npm run dev
```

5. Open your browser to `http://localhost:5173`

### First-Time Setup

1. **Add a Currency** (Settings page)
   - Go to Settings
   - Add USD or your preferred currency
   - Set it as default
   - Configure exchange rate (1.0 for USD)

2. **Create GL Accounts** (Accounts page)
   - Create accounts for different types:
     - Asset accounts (e.g., "1000 - Cash", "1100 - Bank")
     - Equity accounts (e.g., "3000 - Owner's Equity")
     - Accounts Payable (e.g., "2000 - Credit Cards")

3. **Create Subledger Accounts** (Accounts page)
   - Link detailed accounts to GL accounts
   - Specify currency for each account
   - Example: "1001 - Checking Account" linked to "1000 - Cash"

4. **Record Journal Entries** (Journals page)
   - Record your opening balances
   - Start tracking daily transactions

## Usage Guide

### Recording a Transaction

Every transaction requires:
- **Entry Date**: When the transaction occurred
- **Amount**: Transaction value
- **Currency**: Transaction currency
- **Debit Account**: Account to debit
- **Credit Account**: Account to credit
- **Description**: What the transaction is for
- **Category** (optional): For organizing transactions
- **Comment** (optional): Additional notes

Example: Recording a $100 cash purchase
- Debit: "Expenses - Office Supplies" (+$100)
- Credit: "Cash - Checking Account" (-$100)

### Viewing Reports

#### Balance Sheet
- Shows financial position at a specific date
- Assets = Liabilities + Equity
- Select currency and date
- Automatically calculates retained earnings

#### Profit & Loss
- Shows revenue and expenses over a period
- Select start date, end date, and currency
- Calculates net income

#### Trial Balance
- Verifies debits = credits
- Select date and currency
- Shows all account balances

### Managing Accounts

#### GL Accounts
- Create high-level account categories
- Choose account type (Asset, Liability, etc.)
- Assign account numbers
- Enable/disable as needed

#### Subledger Accounts
- Must link to a GL account
- Can have different currencies
- More detailed tracking
- Example: Multiple bank accounts under "Cash" GL account

## API Endpoints

### Currencies
- `GET /api/currencies` - List all currencies
- `POST /api/currencies` - Create currency
- `PUT /api/currencies/:code` - Update currency
- `DELETE /api/currencies/:code` - Delete currency

### GL Accounts
- `GET /api/gl-accounts` - List GL accounts
- `POST /api/gl-accounts` - Create GL account
- `PUT /api/gl-accounts/:id` - Update GL account
- `DELETE /api/gl-accounts/:id` - Delete GL account

### Subledger Accounts
- `GET /api/subledger-accounts` - List subledger accounts
- `POST /api/subledger-accounts` - Create subledger account
- `PUT /api/subledger-accounts/:id` - Update subledger account
- `DELETE /api/subledger-accounts/:id` - Delete subledger account

### Journal Entries
- `GET /api/journal-entries` - List journal entries
- `POST /api/journal-entries` - Create journal entry
- `PUT /api/journal-entries/:id` - Update journal entry
- `DELETE /api/journal-entries/:id` - Delete journal entry

### Reports
- `GET /api/reports/balance-sheet` - Balance sheet report
- `GET /api/reports/profit-loss` - P&L report
- `GET /api/reports/trial-balance` - Trial balance report
- `GET /api/reports/account-ledger/:id` - Account ledger

## Development

### Running in Development

Terminal 1 - Backend:
```bash
npm run server
```

Terminal 2 - Frontend:
```bash
npm run dev
```

### Building for Production

```bash
npm run build
```

### Key Development Notes

#### Svelte 5 Migration
This project uses Svelte 5 with the new runes system:
- `$state()` for reactive variables
- `$effect()` for side effects (replaces `onMount`)
- `$derived()` for computed values
- `onclick` instead of `on:click`
- `onsubmit` instead of `on:submit`

#### Vite Proxy Configuration
The development setup uses Vite proxy to forward `/api` requests to the backend:
- Frontend: `http://localhost:5173`
- Backend: `http://localhost:3000`
- API calls use relative paths (e.g., `/api/currencies`)

## Database Schema

### Tables
- **currencies**: Currency definitions and exchange rates
- **gl_accounts**: General Ledger accounts
- **subledger_accounts**: Detailed subledger accounts
- **journal_entries**: Transaction records
- **attachments**: File uploads (receipts, invoices)

## Accounting Principles

### Double-Entry Bookkeeping
Every transaction has two sides:
- **Debit**: Increases assets/expenses, decreases liabilities/equity/revenue
- **Credit**: Increases liabilities/equity/revenue, decreases assets/expenses

### The Accounting Equation
```
Assets = Liabilities + Equity
```

This equation must always balance.

### Account Types
- **Asset**: What you own (cash, bank accounts, receivables)
- **Liability**: What you owe (payables, loans)
- **Equity**: Your ownership stake
- **Revenue/Profit**: Income earned
- **Expense/Loss**: Costs incurred

## Troubleshooting

### Accounts Page Shows Loading Spinner
- Ensure backend server is running on port 3000
- Check browser console for errors
- Verify Vite proxy is configured correctly

### Books Not Balancing
- Review all journal entries
- Ensure every debit has a corresponding credit
- Check Trial Balance report for discrepancies

### Currency Issues
- Ensure at least one currency is created
- Set a default currency in Settings
- Verify exchange rates are configured

## Completed Features

✅ **Implemented**:
- File attachments for journal entries (receipts, invoices)
- Account ledger view with running balance (API endpoint available)
- Date range filtering for journal entries
- Multi-currency support with exchange rates
- All core financial reports (Balance Sheet, P&L, Trial Balance)
- PWA support for mobile installation
- Network access for LAN devices

## Future Enhancements

Potential features for future development:
- [ ] Cash flow statement
- [ ] Budget tracking
- [ ] Recurring transactions
- [ ] Multi-user support with authentication
- [ ] Data export (CSV, Excel, PDF)
- [ ] Audit trail and change history
- [ ] Bank account reconciliation
- [ ] Tax reporting and categorization
- [ ] Custom report builder
- [ ] Email notifications for reminders

## Production Deployment on Raspberry Pi

> **⚡ Quick Reference**: See [DEPLOYMENT.md](DEPLOYMENT.md) for a quick reference card with common commands and troubleshooting.
>
> **📖 This section**: Complete step-by-step deployment guide for first-time setup.

### Important Note About Vite Version
This application requires **Vite 5.4.11** for production builds. Vite 6.x has compatibility issues with SvelteKit adapters that cause build failures. The setup instructions below include steps to install the correct version.

### Included Deployment Files
The repository includes ready-to-use deployment configurations:
- **`ecosystem.config.cjs`** - PM2 process manager configuration (ports, memory, environment)
- **`deploy.sh`** - Automated deployment script that handles updates, builds, and restarts
- **`.env.production`** (optional) - Application-specific settings like database paths
- **`DEPLOYMENT.md`** - Quick reference card for common tasks

### Prerequisites
- Raspberry Pi 3/4/5 (recommended: 4GB+ RAM)
- Raspberry Pi OS (64-bit recommended)
- Node.js 18+ installed
- Git installed
- Static IP address or domain name (optional but recommended)

### Step 1: Prepare Raspberry Pi

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js 18.x (or higher)
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs

# Verify installation
node --version  # Should be 18.x or higher
npm --version

# Install Git if not already installed
sudo apt install -y git

# Install PM2 for process management
sudo npm install -g pm2
```

### Step 2: Clone and Setup Application

```bash
# Navigate to home directory or preferred location
cd ~

# Clone the repository
git clone <your-repository-url> accounting
cd accounting

# Install dependencies with Vite 5.4.11 (required for SvelteKit compatibility)
npm install --legacy-peer-deps
npm uninstall vite
npm install --legacy-peer-deps vite@5.4.11

# Build the frontend for production
npm run build
```

### Step 3: Create Production Configuration (Optional)

Create a production environment file for database and application settings:

```bash
nano .env.production
```

Add the following (adjust as needed):

```env
# Database Configuration
DATABASE_PATH=./data/accounting.db
ATTACHMENTS_PATH=./data/attachments

# Optional: Enable HTTPS (requires SSL certificates)
# SSL_CERT_PATH=/path/to/cert.pem
# SSL_KEY_PATH=/path/to/key.pem
```

**Note**: Port configuration (HOST, PORT, NODE_ENV) is handled by the PM2 ecosystem config in the next step, not here. This avoids duplication and keeps all process management in one place.

### Step 4: Setup PM2 Process Manager

A pre-configured PM2 ecosystem file (`ecosystem.config.cjs`) is included in the repository. You can use it directly or customize it:

**Option A: Use the included file (recommended)**
```bash
# The file is already in the repo, just verify the paths match your setup
cat ecosystem.config.cjs
```

**Option B: Create/customize manually**
```bash
nano ecosystem.config.cjs
```

The configuration should look like this:

```javascript
module.exports = {
  apps: [
    {
      name: 'accounting-backend',
      script: './start-backend.sh',  // Wrapper script to ensure NODE_ENV=production
      cwd: process.cwd(),  // Uses current directory
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      error_file: './logs/backend-error.log',
      out_file: './logs/backend-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
    },
    {
      name: 'accounting-frontend',
      script: 'node',
      args: 'build/index.js',
      cwd: process.cwd(),  // Uses current directory
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: 'production',
        PORT: 5173,
        HOST: '0.0.0.0',
        ORIGIN: 'http://localhost:5173'
      },
      error_file: './logs/frontend-error.log',
      out_file: './logs/frontend-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
    }
  ]
};
```

**Note**: The ecosystem config uses `process.cwd()` so it works from any installation directory. Logs are stored in `./logs/` directory.

**About the Backend Wrapper Script**: The backend uses `start-backend.sh` to explicitly set environment variables. This file is included in the repository:

```bash
#!/bin/bash
export NODE_ENV=production
export PORT=3000
export HOST=0.0.0.0
npx tsx src/server/index.ts
```

This ensures the backend always runs in production mode with the correct CORS configuration.

### Step 5: Initialize Database

Before starting the application, you need to create the database schema and seed initial data:

**IMPORTANT**: If PM2 is already running the application, stop it first to prevent the backend from overwriting your database changes:

```bash
# Stop PM2 if it's running
pm2 stop accounting-backend

# Run database migrations to create tables
npm run migrate

# Seed initial data (currencies and sample accounts)
npm run seed
```

This creates the SQLite database with all necessary tables and populates it with:
- USD currency as the default
- Empty chart of accounts ready for customization

**Note**: The backend auto-saves the database every 5 seconds. If it's running while you seed the database, it may overwrite your changes with stale data. Always stop PM2 before running migrations or seed scripts.

### Step 6: Start Application with PM2

```bash
# Create logs directory
mkdir -p logs

# Start both backend and frontend
pm2 start ecosystem.config.cjs

# Save PM2 configuration
pm2 save

# Setup PM2 to start on boot
pm2 startup
# Follow the command output to complete startup configuration

# Check application status
pm2 status

# View logs
pm2 logs accounting-backend
pm2 logs accounting-frontend
```

**How it works:**
- **Backend** (`accounting-backend`): Runs the Fastify API server on port 3000
- **Frontend** (`accounting-frontend`): Runs the built SvelteKit Node.js server on port 5173
- Both services run as separate PM2 processes and restart automatically on failure
- The frontend proxies API requests to the backend via Vite's proxy configuration

### Step 7: Configure Firewall (Optional but Recommended)

```bash
# Install UFW if not already installed
sudo apt install -y ufw

# Allow SSH (important!)
sudo ufw allow 22/tcp

# Allow application ports
sudo ufw allow 3000/tcp  # Backend
sudo ufw allow 5173/tcp  # Frontend

# Enable firewall
sudo ufw enable

# Check status
sudo ufw status
```

### Step 8: Setup Nginx Reverse Proxy (Recommended)

For production, it's better to use Nginx as a reverse proxy:

```bash
# Install Nginx
sudo apt install -y nginx

# Create Nginx configuration
sudo nano /etc/nginx/sites-available/accounting
```

Add this configuration:

```nginx
server {
    listen 80;
    server_name your-domain.com;  # or your Raspberry Pi's IP

    # Frontend
    location / {
        proxy_pass http://localhost:5173;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    # Backend API
    location /api {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # File upload size limit (adjust as needed)
        client_max_body_size 10M;
    }
}
```

Enable the site:

```bash
# Enable the site
sudo ln -s /etc/nginx/sites-available/accounting /etc/nginx/sites-enabled/

# Remove default site (optional)
sudo rm /etc/nginx/sites-enabled/default

# Test configuration
sudo nginx -t

# Restart Nginx
sudo systemctl restart nginx

# Enable Nginx to start on boot
sudo systemctl enable nginx
```

### Step 9: Setup SSL with Let's Encrypt (Optional but Recommended)

```bash
# Install Certbot
sudo apt install -y certbot python3-certbot-nginx

# Obtain SSL certificate (replace with your domain)
sudo certbot --nginx -d your-domain.com

# Certbot will automatically update your Nginx configuration

# Test auto-renewal
sudo certbot renew --dry-run
```

### Step 10: Access Your Application

- **Without Nginx**: `http://raspberry-pi-ip:5173`
- **With Nginx (HTTP)**: `http://raspberry-pi-ip` or `http://your-domain.com`
- **With Nginx + SSL**: `https://your-domain.com`

### Step 11: Backup Configuration

Create a backup script:

```bash
nano ~/backup-accounting.sh
```

Add the following:

```bash
#!/bin/bash
BACKUP_DIR="$HOME/accounting-backups"
DATE=$(date +%Y%m%d_%H%M%S)

# Create backup directory if it doesn't exist
mkdir -p "$BACKUP_DIR"

# Backup database and attachments
cd ~/accounting
tar -czf "$BACKUP_DIR/accounting-backup-$DATE.tar.gz" \
    data/accounting.db \
    data/attachments

# Keep only last 30 days of backups
find "$BACKUP_DIR" -name "accounting-backup-*.tar.gz" -mtime +30 -delete

echo "Backup completed: accounting-backup-$DATE.tar.gz"
```

Make it executable and add to crontab:

```bash
chmod +x ~/backup-accounting.sh

# Schedule daily backup at 2 AM
crontab -e
# Add this line:
# 0 2 * * * /home/pi/backup-accounting.sh
```

### Maintenance Commands

#### Quick Update (Using Deploy Script)

The easiest way to update your application:

```bash
cd ~/accounting
chmod +x deploy.sh  # First time only
./deploy.sh
```

The `deploy.sh` script automatically:
- Pulls latest changes from Git
- Installs dependencies with correct Vite version
- Builds the application
- Restarts PM2 services
- Shows application status

#### Manual Maintenance Commands

```bash
# View application status
pm2 status

# Restart application
pm2 restart all

# View logs (all apps)
pm2 logs

# View logs for specific app
pm2 logs accounting-frontend
pm2 logs accounting-backend

# Stop application
pm2 stop all

# Monitor resources
pm2 monit

# Manual update application
cd ~/accounting
git pull
npm install --legacy-peer-deps
npm run build
pm2 restart all
```

#### Database Management

```bash
# Check database contents
npm run db:check

# Reset database (WARNING: This deletes all data!)
pm2 stop accounting-backend
rm data/accounting.db
npm run migrate
npm run seed
pm2 restart accounting-backend

# Backup database
cp data/accounting.db data/accounting-backup-$(date +%Y%m%d).db

# Restore database from backup
pm2 stop accounting-backend
cp data/accounting-backup-YYYYMMDD.db data/accounting.db
pm2 restart accounting-backend
```

**Important**: Always stop the backend before modifying the database file directly. The backend keeps the database in memory and auto-saves every 5 seconds, which can overwrite manual changes.

### Accessing from Mobile Devices

1. **Find Raspberry Pi IP address**:
   ```bash
   hostname -I
   ```

2. **On your mobile device**:
   - Open browser and navigate to `http://RASPBERRY_PI_IP` (if using Nginx)
   - Or `http://RASPBERRY_PI_IP:5173` (direct access)

3. **Install as PWA**:
   - Chrome/Edge: Menu → "Install app" or "Add to Home Screen"
   - Safari: Share → "Add to Home Screen"

### Troubleshooting

**Application won't start:**
```bash
pm2 logs accounting-backend --lines 50
pm2 logs accounting-frontend --lines 50
```

**Can't connect from other devices:**
```bash
# Check if ports are listening
sudo netstat -tlnp | grep -E '3000|5173|80'

# Check firewall
sudo ufw status

# Check Nginx status
sudo systemctl status nginx
```

**Database locked errors:**
```bash
# Stop all instances
pm2 stop all

# Wait a few seconds
sleep 5

# Restart
pm2 start all
```

**Out of memory:**
```bash
# Check memory usage
free -h

# Increase swap if needed
sudo dphys-swapfile swapoff
sudo nano /etc/dphys-swapfile  # Set CONF_SWAPSIZE=1024
sudo dphys-swapfile setup
sudo dphys-swapfile swapon
```

### Performance Optimization for Raspberry Pi

For better performance on Raspberry Pi:

1. **Reduce build size** - The production build is already optimized
2. **Use single instance** - PM2 configuration uses 1 instance per app
3. **Enable swap** - Ensure at least 1GB swap space
4. **Use SD card class 10+** - For better I/O performance
5. **Monitor resources** - Use `pm2 monit` to watch memory usage

### Security Recommendations

1. **Change default passwords** - If using Raspberry Pi OS default user
2. **Setup firewall** - Use UFW as shown above
3. **Enable SSL** - Use Let's Encrypt for HTTPS
4. **Regular updates** - Keep system and dependencies updated
5. **Backup regularly** - Use the backup script provided
6. **Restrict network access** - Only allow trusted devices/networks
7. **No authentication yet** - This app doesn't have user auth, so restrict network access

## License

This project is provided as-is for personal or educational use.

## Support

For issues, questions, or contributions, please open an issue on the repository.
