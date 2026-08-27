# XPAY.EXPERT — Z.AI FRONTEND ROUND DEV-2 MASTER PROMPT

Atua como Lead Frontend Engineer, Product Architect e Integration Engineer do XPAY.Expert.

Evolui o frontend atual sem o reescrever. Preserva Next.js App Router, React Query, Zustand, o design system, os guards Merchant/Admin, o fluxo de autenticação e todo o trabalho já concluído no Commerce.

## Objetivo

Alinhar rapidamente o frontend com a nova evolução backend:

1. Developer Security;
2. Security Challenges por email;
3. API Keys com visualização única e rotação;
4. notificações transacionais;
5. identidade operacional Merchant/Store;
6. Idempotency-Key no S2S;
7. Banking Private Beta;
8. separação absoluta entre Commerce Wallet/Payout e Banking;
9. email verification;
10. confirmação reforçada de Payouts e operações sensíveis.

Backend:

`https://api.xpay.expert/api/v1`

## Regras absolutas

- Não utilizar mocks financeiros.
- Não inventar Stores, Merchants, Wallets, contas bancárias, IBANs, saldos, transfers ou settlements.
- Não guardar API Keys completas, códigos de seis dígitos ou Security Action Tokens.
- Não enviar API Keys completas por email.
- Não criar botão permanente para revelar uma chave existente.
- Não utilizar optimistic updates em saldos, Payouts, Settlements ou Banking.
- 401 limpa a sessão.
- 403 mantém a sessão e apresenta Access Denied.
- 409 apresenta conflito operacional/idempotência.
- 429 apresenta rate limit.
- 500/502/503 preserva a sessão e permite Retry.

## Security Challenges

Endpoints:

```http
GET  /security/purposes
POST /security/challenges/request
POST /security/challenges/verify
POST /security/email/complete
```

Solicitação:

```json
{
  "purpose": "confirm_api_key_rotation",
  "resourceType": "api_key",
  "resourceId": "uuid"
}
```

Resposta:

```json
{
  "success": true,
  "data": {
    "challengeId": "uuid",
    "expiresAt": "ISO_DATE"
  }
}
```

Verificação:

```json
{
  "challengeId": "uuid",
  "code": "123456"
}
```

Resposta:

```json
{
  "success": true,
  "data": {
    "actionToken": "short-lived-token",
    "expiresAt": "ISO_DATE"
  }
}
```

A operação sensível envia:

```http
X-Security-Action: <actionToken>
```

O token é:

- de uso único;
- ligado ao Merchant;
- ligado ao purpose;
- opcionalmente ligado ao resourceId;
- válido durante poucos minutos;
- mantido apenas em memória.

Criar um componente reutilizável:

```text
SecurityChallengeDialog
```

Fluxo:

1. solicitar código;
2. mostrar destino de email mascarado;
3. aceitar exatamente seis dígitos;
4. apresentar countdown;
5. tratar reenvio e 429;
6. verificar;
7. entregar actionToken diretamente à mutation;
8. limpar código e token depois da operação.

Purposes suportados:

```text
verify_email
confirm_live_api_key_creation
confirm_api_key_rotation
confirm_webhook_secret_rotation
confirm_new_payout_destination
confirm_payout_request
confirm_banking_transfer
confirm_profile_email_change
confirm_password_change
confirm_sensitive_settings_change
```

## Email verification

Após register/login inicial, quando o backend indicar email não verificado:

1. solicitar challenge `verify_email`;
2. verificar código;
3. chamar `POST /security/email/complete` com `X-Security-Action`;
4. atualizar `/auth/me`, capabilities e bootstrap.

Não bloquear o frontend inteiro quando o backend ainda não exigir verificação. Bloquear apenas operações live/sensíveis conforme capabilities e erros reais.

## API Keys v2

Novos endpoints canónicos:

```http
GET  /developer/api-keys
POST /developer/api-keys
POST /developer/api-keys/:id/rotate
POST /developer/api-keys/:id/revoke
```

Listagem nunca retorna a chave completa.

Campos esperados:

```text
id
storeId
storeCode
storeName
keyPrefix
keyLastFour
environment
scopes
status
lastUsedAt
expiresAt
revokedAt
createdAt
```

### Create test key

```http
POST /developer/api-keys
```

```json
{
  "storeId": "uuid",
  "name": "Integration key",
  "environment": "test",
  "scopes": [
    "payments:write",
    "checkout:write"
  ]
}
```

### Create live key

Antes de criar:

1. Security Challenge `confirm_live_api_key_creation`;
2. verificar código;
3. chamar Create com `X-Security-Action`.

### Resposta de criação/rotação

```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "fullKey": "xpay_live_...",
    "keyPrefix": "xpay_live_",
    "keyLastFour": "ABCD",
    "environment": "live",
    "scopes": [],
    "revealPolicy": "one_time_only"
  }
}
```

Mostrar `fullKey` uma única vez num dialog não reabrível.

Ações:

```text
Copy
Download as .env snippet
I have stored this key
Close permanently
```

Depois de fechar:

- remover fullKey do estado;
- invalidar listagem;
- nunca tentar recuperar;
- nunca guardar em localStorage/Zustand persist;
- nunca enviar para analytics/error tracking.

### Rotate

1. pedir challenge `confirm_api_key_rotation`;
2. resourceId = API Key antiga;
3. verificar;
4. chamar `POST /developer/api-keys/:id/rotate`;
5. mostrar nova chave uma vez;
6. atualizar estado da anterior para revoked.

### Revoke

Mostrar confirmação forte e chamar:

```http
POST /developer/api-keys/:id/revoke
```

Não exigir OTP inicialmente, salvo capabilities futuras.

Manter os endpoints antigos através de um adapter apenas enquanto necessário. Componentes novos devem usar API Keys v2.

## S2S API

Endpoint:

```http
POST /payments/charge
```

Autenticação:

```http
Authorization: Bearer xpay_live_...
```

ou `x-api-key`, conforme contrato live confirmado.

Não utilizar JWT de dashboard em chamadas S2S.

Documentar como prática obrigatória:

```http
Idempotency-Key: <merchant-generated-stable-key>
```

O backend aceita temporariamente pedidos sem header para compatibilidade, mas o Developer Portal deve ensinar e gerar exemplos sempre com Idempotency-Key.

Exemplo:

```bash
curl -X POST https://api.xpay.expert/api/v1/payments/charge \
  -H "Authorization: Bearer $XPAY_API_KEY" \
  -H "Idempotency-Key: order-123-attempt-1" \
  -H "Content-Type: application/json" \
  -d '{
    "amount": 2000,
    "currency": "EUR",
    "reference": "ORDER-123",
    "customer": {
      "email": "buyer@example.com"
    }
  }'
```

Ajustar os nomes do payload apenas ao contrato live real. Não inventar.

## Webhooks

Distinguir visualmente:

```text
Provider Webhook
Stripe/Provider → XPAY
```

e:

```text
Merchant Webhook
XPAY → sistema do Merchant
```

O Merchant nunca gere o webhook secreto interno Stripe.

Para Merchant Webhooks:

- criar/configurar;
- mostrar endpoint;
- mostrar eventos;
- mostrar status;
- mostrar delivery health quando API real existir;
- secret apenas uma vez;
- rotate secret exige `confirm_webhook_secret_rotation`;
- nunca persistir secret completo.

Email transacional pode confirmar a criação/configuração, sem incluir secret.

## Emails e notificações

O backend possui outbox e worker para:

```text
account.created
store.created
api_key.created
webhook.created
payout.*
security.code_requested
```

A interface não deve criar uma inbox fictícia. Até existir API de notificações do utilizador:

```text
No new notifications.
```

Preparar uma página de preferências, mas só ativar mutações quando os endpoints existirem.

## Merchant e Store identity

Mostrar onde disponível:

```text
merchantCode
merchantName
storeCode
storeName
```

Semântica:

```text
merchantId   UUID técnico
merchantCode identificador operacional estável
merchantName nome visual mutável
storeId      UUID técnico
storeCode    identificador operacional estável
storeName    nome visual mutável
```

Em Transactions e Wallet Movements históricos, priorizar snapshots devolvidos pelo backend.

## Commerce Settlement Wallet

Manter o nome:

```text
Commerce Settlement Wallet
```

Não é conta bancária.

Não reutilizar:

- balance;
- available;
- reserved;
- pending;
- Merchant Payout;

como dados Banking.

## Payout Security Challenge

O backend possui uma flag para exigir OTP na criação de Payout:

```text
XPAY_PAYOUT_SECURITY_CHALLENGE_REQUIRED
```

Quando o backend devolver `PAYOUT_SECURITY_CHALLENGE_REQUIRED`:

1. solicitar `confirm_payout_request`;
2. verificar código;
3. repetir a mesma criação com:
   - mesma Idempotency-Key;
   - mesmo payload;
   - `X-Security-Action`.

Nunca gerar nova Idempotency-Key durante este retry.

## Banking Private Beta

Endpoints:

```http
GET  /banking/capabilities
GET  /banking/accounts
GET  /banking/accounts/:id
GET  /banking/accounts/:id/transactions

GET  /banking/beneficiaries
POST /banking/beneficiaries

GET  /banking/transfers
POST /banking/transfers
GET  /banking/transfers/:id
POST /banking/transfers/:id/confirm
POST /banking/transfers/:id/cancel

POST /banking/fx-quotes
GET  /banking/statements
```

Rotas frontend:

```text
/banking
/banking/accounts
/banking/accounts/:id
/banking/beneficiaries
/banking/transfers
/banking/transfers/new
/banking/transfers/:id
/banking/fx
/banking/statements
```

Estado operacional atual:

```text
Private Beta
Provider Mode: Manual
Automatic External Execution: false
Cards: false
Crypto Withdrawals: false
```

Não mostrar:

- IBAN fictício;
- cartões fictícios;
- saldo fictício;
- transfer concluída fictícia;
- provider externo inexistente;
- promessa de conta bancária operacional.

### Banking Capabilities

```json
{
  "success": true,
  "data": {
    "status": "private_beta",
    "providerMode": "manual",
    "features": {
      "accounts": true,
      "balances": true,
      "beneficiaries": true,
      "transfers": true,
      "fxQuotes": true,
      "statements": true,
      "cards": false,
      "cryptoWithdrawals": false,
      "automaticExternalExecution": false
    }
  }
}
```

### Beneficiary

A interface envia apenas os campos suportados:

```json
{
  "beneficiaryType": "sepa",
  "name": "Beneficiary Name",
  "country": "PT",
  "currency": "EUR",
  "destinationMasked": {
    "iban": "PT50••••1234"
  }
}
```

Nesta versão não enviar destination completo até o backend publicar encriptação e contrato seguro de destination.

### Transfer

Criar:

```http
POST /banking/transfers
Idempotency-Key: <stable-key>
```

```json
{
  "sourceAccountId": "uuid",
  "beneficiaryId": "uuid",
  "amount": 100,
  "currency": "EUR",
  "description": "Invoice 123"
}
```

Estado inicial:

```text
pending_confirmation
```

Confirmar:

1. pedir challenge `confirm_banking_transfer`;
2. resourceId = transfer ID;
3. verificar código;
4. enviar:

```http
POST /banking/transfers/:id/confirm
X-Security-Action: <token>
```

Estado seguinte:

```text
pending_review
```

Isto não significa execução externa.

Estados:

```text
draft
pending_confirmation
pending_review
approved
submitted
processing
completed
failed
reversed
cancelled
```

Mostrar apenas ações permitidas pela API.

### Banking Account

Mostrar:

```text
accountCode
currency
accountType
status
provider
bankName
country
ibanMasked
ledgerBalance
```

Quando a lista estiver vazia:

```text
Your Banking access is being provisioned.
```

Nunca copiar o Commerce Wallet para preencher a página.

## React Query

Criar hooks:

```text
useSecurityPurposes
useRequestSecurityChallenge
useVerifySecurityChallenge
useCompleteEmailVerification

useDeveloperApiKeysV2
useCreateDeveloperApiKeyV2
useRotateDeveloperApiKeyV2
useRevokeDeveloperApiKeyV2

useBankingCapabilities
useBankingAccounts
useBankingAccount
useBankingAccountTransactions
useBankingBeneficiaries
useCreateBankingBeneficiary
useBankingTransfers
useBankingTransfer
useCreateBankingTransfer
useConfirmBankingTransfer
useCancelBankingTransfer
useCreateBankingFxQuote
useBankingStatements
```

Regras:

- actionToken não entra em query key;
- fullKey não entra em cache persistido;
- destination não entra em query key;
- invalidar API Key list após create/rotate/revoke;
- invalidar transfer list/detail após create/confirm/cancel;
- não atualizar balance otimisticamente;
- utilizar `enabled` com sessão/capabilities.

## Product capabilities

Continuar a consultar:

```http
GET /platform/capabilities
```

Banking só deve ficar navegável para utilizadores autorizados e depois de o backend ativar:

```text
capabilities.banking === true
```

Durante desenvolvimento, uma flag frontend local pode permitir revisão visual, mas não pode simular dados nem operações.

## i18n

Todos os novos textos em:

```text
EN
PT
ES
FR
```

Não traduzir nomes técnicos como:

```text
API
Webhook
SEPA
PIX
USDT
TRC20
ERC20
Idempotency-Key
```

## Correções de segurança

- Remover qualquer botão View Existing Secret.
- Remover API Keys completas de fixtures e logs.
- Remover códigos OTP de console.
- Redigir Authorization, API keys, codes e action tokens em error reporting.
- Limpar forms sensíveis depois do sucesso/cancelamento.
- `Cache-Control: no-store` nas respostas que contenham fullKey.
- Não guardar Banking destination completo nesta fase.

## Testes obrigatórios

1. request/verify Security Challenge;
2. código incorreto;
3. código expirado;
4. rate limit;
5. action token reutilizado;
6. criação test API Key;
7. criação live com OTP;
8. fullKey exibida uma vez;
9. rotate com OTP;
10. revoke;
11. S2S docs com Idempotency-Key;
12. Merchant e Store codes;
13. Banking empty state;
14. Banking account real;
15. beneficiary;
16. transfer idempotente;
17. transfer confirmada por OTP;
18. cancelamento;
19. nenhum dado Banking fictício;
20. 401/403/409/429/503;
21. desktop/mobile;
22. EN/PT/ES/FR;
23. lint;
24. build.

## Entrega final

Entregar:

- resumo executivo;
- ficheiros alterados;
- rotas;
- endpoints live e status;
- tipos;
- hooks;
- fluxo Security Challenge;
- fluxo API Key;
- fluxo S2S;
- separação Provider/Merchant Webhooks;
- fluxo Banking;
- limitações backend reais;
- screenshots;
- `npm run lint`;
- `npm run build`;
- branch;
- commit SHA;
- mensagem do commit.

Não fazer push antes de lint e build passarem.
