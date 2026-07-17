# Postman

Importe os dois arquivos:

- `omnichat-backend.postman_collection.json`
- `omnichat-backend.postman_environment.json`

Selecione o environment `Omnichat Backend`.

## Fluxo Recomendado

1. Rode `Auth / Login Super Admin`.
2. Rode `Setup Test Workspace / Create Company`.
3. Rode `Setup Test Workspace / Activate Company For Tests`.
4. Rode `Setup Test Workspace / Create Company Admin User`.
5. Rode `Auth / Login Company Admin`.
6. Teste os folders `Channels`, `Conversations`, `Dashboard`, `Settings` e `Payments`.

O Postman guarda automaticamente o cookie `cber_session` retornado pelo login.

## URLs

O environment vem com:

```text
baseUrl=https://cberhunt-432afab3c888.herokuapp.com
localBaseUrl=http://localhost:4000
```

Para usar local, troque `baseUrl` para `http://localhost:4000`.

## Stripe

`Payments / Create Stripe Checkout Session` só funciona quando o backend tem:

```text
STRIPE_SECRET_KEY=sk_...
STRIPE_PRICE_STARTER=price_...
STRIPE_PRICE_PROFESSIONAL=price_...
STRIPE_PRICE_ENTERPRISE=price_...
```

Depois de configurar no Heroku, rode:

```bash
heroku run npm run db:prepare -a cberhunt-432afab3c888
```
