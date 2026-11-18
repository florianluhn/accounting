#!/bin/bash
export NODE_ENV=production
export PORT=3000
# Bind address comes from BACKEND_HOST (default 127.0.0.1). Do not force 0.0.0.0 here.
npx tsx src/server/index.ts
