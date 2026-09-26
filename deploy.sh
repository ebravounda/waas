#!/usr/bin/env bash
# Despliegue rápido de WhatSaaS en VPS.
# Uso: ./deploy.sh
#
# Hace en orden:
#   1. git pull
#   2. drizzle-kit push (si detecta cambios de schema)
#   3. pnpm build (con memoria alta)
#   4. pm2 restart
#
# Si algún paso falla, se detiene y muestra el error.

set -e  # abort on error

cd "$(dirname "$0")"

# Colores
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}▶ 1/4 Pulling latest changes...${NC}"
git pull origin main

echo -e "${BLUE}▶ 2/4 Applying DB migrations (drizzle-kit push)...${NC}"
if pnpm drizzle-kit push --force 2>&1 | tee /tmp/drizzle.log; then
  echo -e "${GREEN}   DB up to date${NC}"
else
  echo -e "${YELLOW}   drizzle-kit push exited with non-zero (may be OK if no schema changes)${NC}"
fi

echo -e "${BLUE}▶ 3/4 Building Next.js (this takes 3-5 min)...${NC}"
NODE_OPTIONS="--max-old-space-size=4096" pnpm build

echo -e "${BLUE}▶ 4/4 Restarting PM2...${NC}"
pm2 restart mitiendapro --update-env

echo -e "${GREEN}✅ Deploy complete!${NC}"
echo -e "${YELLOW}   Tail logs with:${NC} pm2 logs mitiendapro --lines 30"
