#!/bin/bash

# Deployment script for Accounting App on Raspberry Pi
# This script automates the deployment process

set -e  # Exit on any error

echo "========================================"
echo "Accounting App Deployment Script"
echo "========================================"
echo ""

# Check if running on Raspberry Pi or Linux
if [[ ! "$OSTYPE" == "linux-gnu"* ]]; then
    echo "Warning: This script is designed for Linux/Raspberry Pi"
    read -p "Continue anyway? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Step 1: Pull latest changes
echo "Step 1: Pulling latest changes from Git..."
git pull origin main || {
    echo "Warning: Git pull failed. Continuing anyway..."
}
echo ""

# Step 2: Install/Update dependencies
echo "Step 2: Installing dependencies..."
npm install --legacy-peer-deps

# Ensure correct Vite version
echo "Ensuring Vite 5.4.11 is installed..."
npm uninstall vite 2>/dev/null || true
npm install --legacy-peer-deps vite@5.4.11
echo ""

# Step 3: Build application
echo "Step 3: Building application for production..."
npm run build
echo ""

# Step 4: Run database migrations
echo "Step 4: Running database migrations..."
if [ ! -f "data/accounting.db" ]; then
    echo "Database not found. Running migrations and seed..."
    npm run migrate
    npm run seed
else
    echo "Database exists. Running migrations only..."
    npm run migrate
fi
echo ""

# Step 5: Create logs directory
echo "Step 5: Creating logs directory..."
mkdir -p logs
echo ""

# Step 6: Restart PM2 services
echo "Step 6: Restarting PM2 services..."
if command -v pm2 &> /dev/null; then
    # Check if services are running
    if pm2 list | grep -q "accounting"; then
        echo "Restarting existing PM2 services..."
        pm2 restart ecosystem.config.cjs
    else
        echo "Starting PM2 services for the first time..."
        pm2 start ecosystem.config.cjs
        pm2 save
    fi

    echo ""
    echo "Checking PM2 status..."
    pm2 status
else
    echo "Warning: PM2 not found. Please install PM2 with:"
    echo "  sudo npm install -g pm2"
    echo ""
    echo "Then start the application with:"
    echo "  pm2 start ecosystem.config.cjs"
    echo "  pm2 save"
fi

echo ""
echo "========================================"
echo "Deployment Complete!"
echo "========================================"
echo ""
echo "Access your application at:"
echo "  Frontend: http://$(hostname -I | awk '{print $1}'):5173"
echo "  Backend API: http://$(hostname -I | awk '{print $1}'):3000"
echo ""
echo "Useful commands:"
echo "  pm2 status          - Check application status"
echo "  pm2 logs            - View logs"
echo "  pm2 restart all     - Restart all services"
echo "  pm2 monit           - Monitor resources"
echo ""
