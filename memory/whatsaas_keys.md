# WhatSaaS Deployment Keys

## Domain
- Main: mitiendapro.com
- Evolution API subdomain: evolution.mitiendapro.com

## Evolution API Keys (generated at https://generate-random.org/api-keys)

| Variable | Value | Used in |
|---|---|---|
| `WA_BUSINESS_TOKEN_WEBHOOK` | `HXrAcUGUXTWeeni8EPM8a7ewTVxRpYwY` | Evolution API `.env` |
| `AUTHENTICATION_API_KEY` | `YLDZW0atMRTzAaZz78rxapxzKMZVeqmf` | Evolution API `.env` AND WhatSaaS `pnpm db:setup` (Global API Key) |

## Notes
- `AUTHENTICATION_API_KEY` is reused when running `pnpm db:setup` for WhatSaaS — it's the "Global API Key (Authentication)" prompt.
- `WA_BUSINESS_TOKEN_WEBHOOK` is also requested by `pnpm db:setup` as "WA Business Token Webhook".
- Keep these secret. Never commit to git.

## Server
- Control panel: aaPanel
- OS: Ubuntu
- Docker: 29.4.1
- Docker Compose: v5.1.3
- Node.js: NOT YET INSTALLED (needed later for WhatSaaS, v20 LTS)
- PM2: NOT YET INSTALLED (needed later for WhatSaaS)
