# Omnichat Backend

NestJS API for the CberHunt/Omnichat frontend.

## Stack

- NestJS
- TypeORM
- PostgreSQL
- JWT session cookie (`cber_session`)
- Stripe checkout/webhook support

## Local Setup

```bash
npm install
copy .env.example .env
npm run db:prepare:dev
npm run start:dev
```

Default local URL:

```text
http://localhost:4000/api
```

Local setup expects PostgreSQL running natively on `127.0.0.1:5432` with database `db-omnichat`.

Keep `TYPEORM_SYNC=false`. Table creation is handled by `npm run db:prepare:dev` locally and by the Heroku release phase in production.

## Required Env

```env
PORT=4000
FRONTEND_ORIGIN=http://localhost:3000
FRONTEND_ORIGIN_SUFFIXES=
FRONTEND_ORIGIN_HOSTNAME_PATTERNS=omnichat-saas-*.vercel.app
APP_URL=http://localhost:3000
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/db-omnichat?schema=public
JWT_SECRET=change-me
TYPEORM_SYNC=false
```

Stripe variables are optional until billing checkout is enabled:

```env
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRICE_STARTER=
STRIPE_PRICE_PROFESSIONAL=
STRIPE_PRICE_ENTERPRISE=
```

For checkout, `STRIPE_PRICE_*` must be Stripe Price IDs that start with `price_`. Do not use numeric amounts like `9700`.

WhatsApp Cloud API variables:

```env
WHATSAPP_WEBHOOK_VERIFY_TOKEN=
WHATSAPP_GRAPH_API_VERSION=v23.0
WHATSAPP_ACCESS_TOKEN=
```

`WHATSAPP_WEBHOOK_VERIFY_TOKEN` must match the token configured in the Meta App webhook. `WHATSAPP_ACCESS_TOKEN` is an optional fallback; for multi-company use, store the access token in each WhatsApp channel and use the channel `accountId` as the WhatsApp Phone Number ID.

## Seed

`npm run db:prepare:dev` synchronizes the local schema and runs the structural seed.

`npm run db:prepare` does the same against compiled `dist` and is used by the Heroku `release` process.

## Heroku

Deploy this backend as its own Heroku app from `D:\nodeprojects\omnichat_backend`.

The required Heroku files/scripts are already present:

- `Procfile`
- `heroku-postbuild`
- `start:prod`
- `db:prepare`

The `Procfile` runs:

```Procfile
release: npm run db:prepare
web: npm run start:prod
```

Configure a Heroku Postgres add-on so Heroku provides `DATABASE_URL`. Set these config vars:

```env
JWT_SECRET=change-me-long-random-secret
FRONTEND_ORIGIN=https://your-frontend-domain.com
FRONTEND_ORIGIN_SUFFIXES=your-vercel-team.vercel.app
FRONTEND_ORIGIN_HOSTNAME_PATTERNS=omnichat-saas-*.vercel.app
APP_URL=https://your-frontend-domain.com
SESSION_COOKIE_SAME_SITE=none
SUPER_ADMIN_EMAIL=admin@cberhunt.com
SUPER_ADMIN_PASSWORD=change-this-password
```

Stripe variables are only required when checkout is active.

For Stripe checkout on Heroku:

```bash
heroku config:set STRIPE_SECRET_KEY=sk_live_... -a cberhunt-432afab3c888
heroku config:set STRIPE_WEBHOOK_SECRET=whsec_... -a cberhunt-432afab3c888
heroku config:set STRIPE_PRICE_STARTER=price_... -a cberhunt-432afab3c888
heroku config:set STRIPE_PRICE_PROFESSIONAL=price_... -a cberhunt-432afab3c888
heroku config:set STRIPE_PRICE_ENTERPRISE=price_... -a cberhunt-432afab3c888
heroku run npm run db:prepare -a cberhunt-432afab3c888
```

The expected Stripe Price amounts are:

- Starter: `unit_amount=9700` for R$ 97,00
- Professional: `unit_amount=19700` for R$ 197,00
- Enterprise: `unit_amount=100000` for R$ 1000,00

After configuring, `GET /api/plans` must show `stripePriceId` filled for all plans.

After deploy, validate:

```bash
heroku logs --tail
heroku run npm run db:prepare
curl https://your-backend-app.herokuapp.com/api/health
```

The seed creates only structural data:

- Plans
- Channel type catalog
- Super admin user

It does not create fake companies, customers, conversations, messages, testimonials, or agents.

Default super admin:

```text
admin@cberhunt.com / admin123
```

Override with `SUPER_ADMIN_EMAIL` and `SUPER_ADMIN_PASSWORD`.

## Main Routes

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `POST /api/auth/logout`
- `GET /api/plans`
- `GET /api/channel-types`
- `GET /api/public/metrics`
- `GET /api/dashboard/stats`
- `GET|POST /api/companies`
- `GET|POST /api/agents`
- `GET|POST /api/channels`
- `GET|POST /api/conversations`
- `GET|POST /api/chatbot/rules`
- `GET|POST /api/quick-replies`
- `GET|PUT /api/notification-preferences`
- `GET|POST /api/api-keys`
- `GET /api/invoices`
- `POST /api/payments/subscribe`
- `POST /api/payments/webhook`
- `GET|POST /api/whatsapp/webhook`
