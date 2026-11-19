// Load environment variables from .env file
require('dotenv').config();

function positiveInt(value, fallback) {
  const parsed = parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

// adapter-node's own default is 512KB, which rejects normal receipt photos.
// Multipart framing is a bit larger than the file, so stay above MAX_FILE_SIZE_MB.
const maxFileSizeMb = positiveInt(process.env.MAX_FILE_SIZE_MB, 10);
const bodySizeLimit = process.env.BODY_SIZE_LIMIT || `${maxFileSizeMb + 2}M`;

const frontendEnv = {
  NODE_ENV: process.env.NODE_ENV || 'production',
  PORT: process.env.FRONTEND_PORT || '5173',
  HOST: process.env.FRONTEND_HOST || '0.0.0.0',
  // Byte count or a K/M/G suffix. See .env.example.
  BODY_SIZE_LIMIT: bodySizeLimit,
  BACKEND_PORT: process.env.BACKEND_PORT || '3000',
  FRONTEND_PORT: process.env.FRONTEND_PORT || '5173',
  API_URL: process.env.API_URL || '',
  APP_NAME: process.env.APP_NAME || 'Accounting App',
  APP_SHORT_NAME: process.env.APP_SHORT_NAME || 'Accounting',
  APP_DESCRIPTION: process.env.APP_DESCRIPTION || 'Personal finance accounting with double-entry bookkeeping'
};

// SvelteKit compares this with the browser Origin header before the /api proxy
// runs, and only for multipart/form posts. API_URL stays empty on purpose, so
// it must not be reused here. Falling back to http://localhost:5173 rejects
// uploads from the public https host with
// "Cross-site POST form submissions are forbidden".
// Leave ORIGIN unset to infer https://<Host>. Set it when the tunnel does not
// forward the public host, for example https://accounting.florianluhn.com.
if (process.env.ORIGIN) {
  frontendEnv.ORIGIN = process.env.ORIGIN;
}

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
        BACKEND_HOST: process.env.BACKEND_HOST || '127.0.0.1',
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
      env: frontendEnv,
      error_file: `${process.env.LOG_DIR || './logs'}/frontend-error.log`,
      out_file: `${process.env.LOG_DIR || './logs'}/frontend-out.log`,
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
    }
  ]
};
