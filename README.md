# WhatSaaS - mitiendapro.com

Deployment de WhatSaaS para `mitiendapro.com` con Evolution API en `evolution.mitiendapro.com`.

## Stack
- **Framework**: Next.js 16 (App Router)
- **Database**: PostgreSQL (vía Docker)
- **ORM**: Drizzle
- **WhatsApp Engine**: Evolution API v2.3.7
- **Pagos**: Stripe / Razorpay (configurable)
- **Emails**: Resend
- **Realtime**: Pusher
- **UI**: shadcn/ui + Tailwind CSS 4
- **Auth**: iron-session + bcryptjs

## Infraestructura
- **Servidor**: AWS EC2 (Ubuntu 24.04 LTS arm64)
- **Panel**: aaPanel
- **Dominio**: mitiendapro.com (Cloudflare DNS, Proxied)
- **Subdominio Evolution API**: evolution.mitiendapro.com

## Status de despliegue
- [x] Evolution API corriendo (Docker)
- [x] Reverse proxy + SSL para evolution.mitiendapro.com
- [ ] Push código a GitHub
- [ ] Clonar repo en VPS
- [ ] `pnpm install`
- [ ] `pnpm db:setup` (interactivo)
- [ ] `pnpm db:migrate` + `pnpm db:seed`
- [ ] `pnpm build`
- [ ] PM2 + reverse proxy mitiendapro.com
- [ ] Cron job para campañas

## Cuentas de servicios externos requeridas
Antes de ejecutar `pnpm db:setup` necesitas tener cuenta y keys en:
1. **Stripe** → `STRIPE_SECRET_KEY` y `STRIPE_WEBHOOK_SECRET`
2. **Resend** → `RESEND_API_KEY` y email verificado
3. **Pusher** → App ID, Key, Secret, Cluster

## Documentación de instalación
Ver PDF: `WhatSaaS_Installation.pdf`

## Tech Stack original
- **Framework**: [Next.js](https://nextjs.org/)
- **Database**: [Postgres](https://www.postgresql.org/)
- **ORM**: [Drizzle](https://orm.drizzle.team/)
- **Payments**: [Stripe](https://stripe.com/)
- **UI Library**: [shadcn/ui](https://ui.shadcn.com/)
