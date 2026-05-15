# Top-up QR Automation

Servico local para automatizar a geracao de QR Code PIX em uma SPA privada usando Node.js, TypeScript, Playwright e Express.

O fluxo atual esta funcional e prioriza estabilidade. Em media, a geracao pode levar cerca de 17s porque depende de navegador real, sessao autenticada, navegacao da SPA, preenchimento do formulario e carregamento do iframe ou payload do QR.

## O Que Este Projeto Faz

1. Sobe um servidor HTTP local.
2. Abre um Chrome controlado pelo Playwright com perfil persistente.
3. Verifica se a sessao ainda esta autenticada.
4. Faz login automaticamente quando necessario.
5. Acessa a tela de deposito/top-up.
6. Preenche o valor solicitado.
7. Clica no botao de gerar deposito.
8. Captura o QR Code por iframe, imagem, canvas, payload PIX ou resposta de rede.
9. Salva o resultado em disco e devolve JSON para quem chamou a API.

## Estrutura

- `src/index.ts`: inicializa o servidor, trata shutdown e opcionalmente aquece a sessao no start.
- `src/server.ts`: expoe `GET /health` e `POST /generate-topup`.
- `src/browser.ts`: cria/reutiliza um `chromium.launchPersistentContext` em `storage/browser-profile`.
- `src/auth.ts`: valida sessao, faz login e detecta redirecionamento para tela de login.
- `src/topup.ts`: abre a rota de top-up, reseta estado anterior, preenche valor, submete e captura o QR.
- `src/network.ts`: tenta extrair QR de responses JSON quando um endpoint de QR for conhecido.
- `src/qr.ts`: normaliza resultado e gera imagem quando so existe payload PIX.
- `src/storage.ts`: salva JSON e PNG do QR em `storage/qr-codes`.
- `src/config.ts`: centraliza URLs, credenciais, seletores, timeouts e pastas.
- `src/errors.ts`: define erros tipados para respostas HTTP previsiveis.

## Instalacao

```powershell
npm install
npx playwright install chromium
```

## Configuracao

A configuracao efetiva hoje fica em `src/config.ts`.

Campos principais:

- `baseUrl`: URL base do site.
- `loginUrl`: rota da tela de login.
- `topupUrl`: rota da tela de deposito/top-up.
- `port`: porta do servidor local.
- `username` e `password`: credenciais usadas no login.
- `headless`: define se o Chrome abre visivel ou em modo headless.
- `warmupOnStart`: quando `true`, prepara a sessao no start.
- `browserChannel`: canal do navegador, hoje `chrome`.
- `userDataDir`: pasta do perfil persistente do Chrome.
- `qrOutputDir`: pasta onde os QRs sao salvos.
- `timeouts`: limites de navegacao, seletores, login e resposta.
- `selectors`: seletores CSS/Playwright das telas de login e top-up.
- `qrResponseUrlPattern`: trecho opcional da URL de API que retorna QR.

Existe um `.env.example`, mas o codigo atual nao carrega variaveis de ambiente automaticamente. Para portar para producao, uma melhoria simples e trocar valores hardcoded de `src/config.ts` por `process.env`.

## Como Rodar

Desenvolvimento:

```powershell
npm run dev
```

Build:

```powershell
npm run build
```

Producao local:

```powershell
npm run start
```

Health check:

```powershell
curl http://localhost:3000/health
```

## API

Endpoint:

```text
POST /generate-topup
```

Body minimo:

```json
{
  "amount": "200"
}
```

Body com campos adicionais:

```json
{
  "amount": "200",
  "fields": {
    "input[name='cpf']": "00000000000",
    "input[name='name']": "Cliente Teste"
  }
}
```

Resposta de sucesso:

```json
{
  "success": true,
  "savedTo": "storage/qr-codes/2026-05-15T17-00-00-000Z.json",
  "qrBase64": "...",
  "qrDataUrl": "data:image/png;base64,...",
  "pixPayload": "000201...",
  "sourceUrl": "https://...",
  "expiresAt": null
}
```

Resposta de erro:

```json
{
  "success": false,
  "error": {
    "code": "LAYOUT_CHANGED",
    "message": "..."
  }
}
```

## Storage

Pastas usadas em runtime:

- `storage/browser-profile`: perfil persistente do Chrome, cookies e sessao.
- `storage/qr-codes`: JSON e PNG dos QRs gerados.
- `storage/qr-codes/latest.json`: ultimo QR gerado.
- `storage/qr-codes/latest.png`: ultima imagem de QR gerada.
- `storage/logs`: logs quando o servidor e iniciado com redirecionamento.
- `storage/diagnostics`: HTML/JSON/PNG usados para debug manual.

Nao apague `storage/browser-profile` se quiser manter a sessao logada. Apague essa pasta apenas quando precisar forcar um login limpo.

## Fluxo Interno

1. `server.ts` recebe `POST /generate-topup`.
2. `browser.ts` cria uma nova pagina dentro do contexto persistente.
3. `auth.ts` acessa `topupUrl` e verifica se a sessao e valida.
4. Se cair na tela de login, `auth.ts` preenche usuario/senha e confirma autenticacao.
5. `topup.ts` abre a rota de top-up.
6. Se encontrar iframe de pagamento antigo, tenta voltar/recarregar para limpar o estado.
7. Aguarda o input de valor.
8. Preenche o valor com simulacao humana e fallback por input nativo.
9. Clica no botao de deposito.
10. Aguarda o QR via iframe ou response de rede.
11. `qr.ts` normaliza o resultado.
12. `storage.ts` salva JSON e PNG.
13. `server.ts` retorna os dados para o cliente.

## Captura do QR

O codigo tenta capturar o QR das seguintes formas:

- parametro `qrcode` na URL do iframe;
- imagem `data:image/...` dentro do iframe;
- canvas dentro do iframe;
- input/textarea com payload PIX iniciado por `000201`;
- texto visivel com payload PIX;
- response JSON com chaves como `qrCode`, `qrcode`, `qr_code`, `base64`, `codeUrl` ou `image`.

Se em outro site o QR vier por uma API especifica, configure `qrResponseUrlPattern` em `src/config.ts`. Isso ajuda `src/network.ts` a escutar apenas o endpoint correto.

## Como Adaptar Para Outro Site

Checklist recomendado:

1. Atualize `baseUrl`, `loginUrl` e `topupUrl` em `src/config.ts`.
2. Atualize `username` e `password`.
3. Ajuste `selectors.loginUsername`, `selectors.loginPassword` e `selectors.loginSubmit`.
4. Ajuste `selectors.topupAmount` e `selectors.topupSubmit`.
5. Se houver um elemento confiavel que so aparece logado, configure `selectors.authenticatedMarker`.
6. Se houver um marcador de login bem-sucedido, configure `selectors.loginSuccess`.
7. Rode `npm run dev` com `headless: false` para observar o fluxo.
8. Chame `POST /generate-topup` com um valor baixo de teste.
9. Verifique `storage/qr-codes/latest.json` e `latest.png`.
10. Se falhar, capture HTML/prints da tela e ajuste seletores ou estrategia de QR.

## Pontos Fragos

Este tipo de automacao depende diretamente do layout e comportamento da SPA. Os pontos que mais quebram ao portar sao:

- mudanca nos seletores CSS;
- botao de deposito com texto diferente;
- input com mascara ou validacao customizada;
- Cloudflare ou desafio manual;
- iframe cross-origin sem acesso ao conteudo;
- QR retornado por endpoint diferente;
- sessao expirada ou login com MFA;
- QR com vencimento curto.

Quando o layout mudar, normalmente o primeiro arquivo a ajustar e `src/config.ts`. Se o fluxo da tela mudar, o ajuste costuma ficar em `src/topup.ts`.

## Performance

O tempo atual de aproximadamente 17s e esperado para um fluxo browser-driven estavel. Ele inclui waits defensivos e pequenas pausas humanas para reduzir risco de bloqueio ou falha da SPA.

Nao e recomendado otimizar antes de validar o fluxo em producao. As otimizacoes possiveis, com mais risco, seriam:

- manter uma pagina unica sempre aberta na tela de top-up;
- reduzir pausas de `humanPause`;
- remover resets defensivos de iframe antigo;
- capturar o QR diretamente por API;
- usar `headless: true`;
- aquecer sessao com `warmupOnStart: true`.

A solucao operacional recomendada agora e pre-gerar o QR e exibir ao cliente no momento certo, respeitando `expiresAt` quando disponivel.

## Segurança

Atencao: `src/config.ts` contem credenciais em texto puro no estado atual.

Antes de mover para outro ambiente:

- leia credenciais via variaveis de ambiente;
- proteja a rota `POST /generate-topup` com token, rede privada ou autenticao;
- nao exponha o servidor diretamente na internet sem controle de acesso;
- proteja `storage/browser-profile`, pois ele contem sessao/cookies;
- evite commitar dados reais de `storage`.

## Diagnostico

Comportamento esperado nos logs:

```text
[server] POST /generate-topup received
[browser] launching persistent context ...
[topup] ensuring authenticated session
[auth] existing session is valid
[topup] opening top-up route
[topup] waiting for amount input
[topup] filling amount ...
[topup] submitting top-up form
[topup] QR captured from ...
```

Erros comuns:

- `INVALID_AMOUNT`: body sem `amount` string.
- `SESSION_EXPIRED`: a aplicacao voltou para login.
- `LOGIN_INVALID`: login nao foi confirmado.
- `LAYOUT_CHANGED`: seletor/tela/iframe mudou.
- `QR_NOT_FOUND`: endpoint foi visto, mas nao havia QR no body.
- `RESPONSE_TIMEOUT`: nenhum QR foi capturado dentro do timeout.

## Manutencao

Antes de alterar o fluxo funcional, rode:

```powershell
npm run check
npm run build
```

Ao mudar seletores ou comportamento de top-up, teste pelo menos:

- sessao ja logada;
- sessao expirada;
- valor baixo;
- valor alto;
- geracao consecutiva de dois QRs;
- QR anterior ainda aberto na tela.

## Observacao Legal

Use este projeto apenas em sistemas onde voce tem autorizacao para automatizar login, navegacao e geracao de pagamentos. Respeite limites de uso, termos do servico e controles antifraude do provedor.
