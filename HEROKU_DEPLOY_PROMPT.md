# Prompt de preparo do backend para Heroku

Use este prompt quando precisar revisar ou recriar a configuracao de deploy do backend NestJS no Heroku:

```text
Voce esta no backend NestJS `omnichat_backend`. Prepare o projeto para deploy no Heroku usando Node/NPM, NestJS, TypeORM e PostgreSQL.

Obrigatorio:
- O app deve ter um `Procfile` na raiz com:
  - `release: npm run db:prepare`
  - `web: npm run start:prod`
- O `package.json` deve ter:
  - `heroku-postbuild` compilando o Nest (`npm run build`)
  - `start:prod` rodando `node dist/main`
  - `db:schema:sync` rodando `node dist/database/sync-schema.js`
  - `db:seed:prod` rodando `node dist/database/seed.js`
  - `db:prepare` rodando criacao/sincronizacao das tabelas e seed estrutural
  - `db:prepare:dev` opcional para rodar o mesmo preparo local via TypeScript
- O script `src/database/sync-schema.ts` deve inicializar o TypeORM e executar `DataSource.synchronize(false)` para criar/atualizar as tabelas.
- O script `src/database/seed.ts` deve inserir apenas dados estruturais idempotentes:
  - planos
  - tipos de canais
  - super admin
- Nao inserir empresas, clientes, conversas, mensagens ou agentes fake.
- O backend deve usar `process.env.PORT` no bootstrap.
- O backend deve usar `DATABASE_URL` do Heroku Postgres.
- SSL deve funcionar no Heroku Postgres e continuar desligado no Postgres local.
- Validar com `npm run build`.

Tabelas esperadas no banco:
- Company
- User
- ChannelType
- Channel
- Conversation
- Message
- ConversationTag
- ChatbotRule
- Plan
- QuickReply
- NotificationPreference
- ApiKey
- Invoice

Variaveis de ambiente esperadas no Heroku:
- DATABASE_URL
- JWT_SECRET
- SESSION_COOKIE_SAME_SITE
- FRONTEND_ORIGIN
- FRONTEND_ORIGIN_SUFFIXES
- APP_URL
- SUPER_ADMIN_EMAIL
- SUPER_ADMIN_PASSWORD
- STRIPE_SECRET_KEY
- STRIPE_WEBHOOK_SECRET
- STRIPE_PRICE_STARTER
- STRIPE_PRICE_PROFESSIONAL
- STRIPE_PRICE_ENTERPRISE

Use `SESSION_COOKIE_SAME_SITE=none` se frontend e backend estiverem em dominios diferentes.

Depois do deploy, validar:
- `heroku logs --tail`
- `heroku run npm run db:prepare`
- `curl https://<app>.herokuapp.com/api/health`
```

## Configuracao ja aplicada

Este projeto ja contem:

- `Procfile` com processo `release` e `web`.
- `src/database/sync-schema.ts` para criacao/sincronizacao das tabelas.
- `src/database/seed.ts` idempotente para dados estruturais.
- `db:prepare` para rodar no release phase do Heroku.
- `heroku-postbuild` para compilar `dist` antes do release.
