#!/bin/bash
export NODE_ENV=production
export PORT=3000
export HOST=0.0.0.0
npx tsx src/server/index.ts
