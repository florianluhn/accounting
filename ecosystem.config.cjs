// Load environment variables from .env file
require('dotenv').config();

module.exports = {
  apps: [
    {
      name: process.env.PM2_BACKEND_NAME || 'accounting-backend',
      script: './start-backend.sh',
      cwd: process.cwd(),
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: process.env.NODE_ENV || 'production',
        BACKEND_PORT: process.env.BACKEND_PORT || '3000',
        BACKEND_HOST: process.env.BACKEND_HOST || '0.0.0.0',
        DATABASE_PATH: process.env.DATABASE_PATH || './data/accounting.db',
        ATTACHMENTS_PATH: process.env.ATTACHMENTS_PATH || './data/attachments',
        MAX_FILE_SIZE_MB: process.env.MAX_FILE_SIZE_MB || '10',
        MAX_STORAGE_GB: process.env.MAX_STORAGE_GB || '40',
        APP_NAME: process.env.APP_NAME || 'Accounting App',
        APP_SHORT_NAME: process.env.APP_SHORT_NAME || 'Accounting',
        APP_DESCRIPTION: process.env.APP_DESCRIPTION || 'Personal finance accounting with double-entry bookkeeping'
      },
      error_file: `${process.env.LOG_DIR || './logs'}/backend-error.log`,
      out_file: `${process.env.LOG_DIR || './logs'}/backend-out.log`,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
    },
    {
      name: process.env.PM2_FRONTEND_NAME || 'accounting-frontend',
      script: 'node',
      args: 'build/index.js',
      cwd: process.cwd(),
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      env: {
        NODE_ENV: process.env.NODE_ENV || 'production',
        PORT: process.env.FRONTEND_PORT || '5173',
        HOST: process.env.FRONTEND_HOST || '0.0.0.0',
        ORIGIN: process.env.API_URL || `http://localhost:${process.env.FRONTEND_PORT || '5173'}`,
        BACKEND_PORT: process.env.BACKEND_PORT || '3000',
        FRONTEND_PORT: process.env.FRONTEND_PORT || '5173',
        API_URL: process.env.API_URL || '',
        APP_NAME: process.env.APP_NAME || 'Accounting App',
        APP_SHORT_NAME: process.env.APP_SHORT_NAME || 'Accounting',
        APP_DESCRIPTION: process.env.APP_DESCRIPTION || 'Personal finance accounting with double-entry bookkeeping'
      },
      error_file: `${process.env.LOG_DIR || './logs'}/frontend-error.log`,
      out_file: `${process.env.LOG_DIR || './logs'}/frontend-out.log`,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
    }
  ]
};
