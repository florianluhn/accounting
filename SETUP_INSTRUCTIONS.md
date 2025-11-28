# Setup Instructions - Windows

## Issue: better-sqlite3 Compilation

You're currently using Node.js v24.11.0, which requires Visual Studio C++ build tools to compile better-sqlite3.

## Solution Options

### Option 1: Use Node.js 20 LTS (Recommended - Easier)

1. **Download and install Node.js 20 LTS**:
   - Visit: https://nodejs.org/
   - Download "20.x.x LTS" version
   - Install (it will replace Node 24)

2. **Verify installation**:
   ```bash
   node --version  # Should show v20.x.x
   ```

3. **Reinstall dependencies**:
   ```bash
   pnpm install
   ```

4. **Continue with setup**:
   ```bash
   pnpm db:generate
   pnpm migrate
   pnpm seed
   ```

### Option 2: Install Visual Studio Build Tools (For Node 24)

1. **Download Visual Studio Build Tools 2022**:
   - Visit: https://visualstudio.microsoft.com/downloads/#build-tools-for-visual-studio-2022
   - Download "Build Tools for Visual Studio 2022"

2. **Install with C++ workload**:
   - Run the installer
   - Select "Desktop development with C++"
   - Click Install (this will take 5-10 minutes)

3. **Rebuild better-sqlite3**:
   ```bash
   pnpm rebuild better-sqlite3
   ```

4. **Continue with setup**:
   ```bash
   pnpm db:generate
   pnpm migrate
   pnpm seed
   ```

## Recommended Approach

**We recommend Option 1 (Node.js 20 LTS)** because:
- No additional software to install
- Better compatibility with npm packages
- Faster setup
- Node.js 20 is the current LTS (Long Term Support) version
- All features will work identically

## After Fixing

Once you've chosen an option and it's working, continue with:

```bash
# Generate database schema
pnpm db:generate

# Run migrations
pnpm migrate

# Seed initial data
pnpm seed

# Start development servers (in 2 terminals)
pnpm server:dev  # Terminal 1
pnpm dev         # Terminal 2
```

The app will be available at:
- Frontend: http://localhost:5173
- API: http://localhost:3000
