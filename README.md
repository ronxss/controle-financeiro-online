# Controle Financeiro Pessoal — versão online

Sistema web para controle de receitas e despesas, baseado na planilha `controle_financeiro_pessoal.xlsx`.
**Este repositório é a versão online:** login pela rede, dados guardados no servidor (SQL Server), troca de senha por
e-mail e infraestrutura no Azure. A versão que funciona só no aparelho (PWA/APK, sem servidor) fica no repositório
[controle-financeiro](https://github.com/ronxss/controle-financeiro).

- **Publicar no Azure (grátis):** veja [INFRA.md](INFRA.md).
- **Mesmas regras nos dois:** fixas, parcelas, cartões e faturas, metas, painel, lembretes, planilha e backup. Os
  [testes de contrato](tests/contrato/contrato.mjs) rodam no CI com um SQL Server de verdade e exigem que a API em C#
  responda exatamente como o motor do app local (`ClientApp/src/local/engine.js`).
- **Levar os dados do celular para o online:** no app local, *Exportar backup*; no site, *Importar backup*. O formato é o mesmo nos dois sentidos.

- **Back-end:** C# / ASP.NET Core (.NET 10) + Entity Framework Core + **SQL Server**
- **Front-end:** React + Material UI (Vite), servido pelo próprio ASP.NET Core (um único processo)
- **Segurança:** ASP.NET Core Identity, login com Google, cookie HttpOnly/SameSite=Strict, bloqueio por tentativas, rate limiting, CSP

## Pré-requisitos

| Item | Observação |
|---|---|
| .NET SDK 10 | `dotnet --version` (para .NET 8, veja "Usar outra versão do .NET") |
| Node.js 22+ | usado para compilar o front-end (o Node 20 saiu de suporte em abril/2026; Docker e Codespaces usam o 24) |
| SQL Server | LocalDB (Windows), SQL Server Express, ou Docker (`docker compose up -d`) |

## Como executar

```bash
dotnet run
```

Na primeira execução o projeto roda `npm install` + `npm run build` automaticamente (gera `wwwroot/`),
cria o banco `ControleFinanceiro` e abre em **https://localhost:7080** (ou http://localhost:5080).
Se o navegador reclamar do certificado: `dotnet dev-certs https --trust`.

Crie sua conta na aba **Criar conta**. Categorias e contas da planilha são criadas automaticamente.

### Login com Google (opcional)

1. No [Google Cloud Console](https://console.cloud.google.com/) → **APIs e serviços → Credenciais → Criar credenciais → ID do cliente OAuth** → tipo **Aplicativo da Web**.
2. Em **Origens JavaScript autorizadas** adicione: `http://localhost:5080`, `https://localhost:7080`, `http://localhost:5173` e, em produção, `https://seu-dominio`. (Não é preciso URI de redirecionamento.)
3. Configure o Client ID (não é segredo, mas fica fora do Git):

```bash
dotnet user-secrets set "Google:ClientId" "123456-abc.apps.googleusercontent.com"
```

Em produção use a variável de ambiente `Google__ClientId`. Sem Client ID o botão "Continuar com o Google" simplesmente não aparece.
O servidor valida o token do Google (assinatura, validade, audiência e e-mail verificado) e então cria a mesma sessão por cookie do login por senha.

### Banco de dados

A string de conexão fica em `appsettings.json` (padrão: LocalDB). Para outra instância, sem editar arquivos:

```bash
# SQL Server Express
dotnet user-secrets set "ConnectionStrings:Default" "Server=localhost\SQLEXPRESS;Database=ControleFinanceiro;Trusted_Connection=True;TrustServerCertificate=True"

# SQL Server no Docker (docker compose up -d)
dotnet user-secrets set "ConnectionStrings:Default" "Server=localhost,1433;Database=ControleFinanceiro;User Id=sa;Password=Controle@Fin2026;TrustServerCertificate=True"
```

> LocalDB só existe no Windows. No Linux/macOS use o Docker.

### Desenvolvimento do front-end (hot reload)

```bash
dotnet run                 # terminal 1 (API em http://localhost:5080)
cd ClientApp && npm run dev  # terminal 2 -> http://localhost:5173
```

Para recompilar o front-end para o `wwwroot`: `cd ClientApp && npm run build`.

## Mapeamento da planilha

| Planilha | Sistema |
|---|---|
| Aba **Lançamentos** (data, tipo, categoria, descrição, conta, valor, status; "Mês" derivado da data) | Tela **Lançamentos** + tabela `Lancamentos` |
| Aba **Listas** (categorias, contas, tipo, status) | Tela **Cadastros** + tabelas `Categorias` e `Contas` (editáveis) |
| Aba **Orçamento** (limite, realizado, disponível, % do limite) | Tela **Orçamento** (limite fica em `Categorias.LimiteMensal`) |
| Aba **Resumo** (mês de referência, indicadores, despesas por categoria) | Tela **Resumo** + seletor de mês na barra superior |

Regras preservadas: valores sempre positivos (o tipo define receita/despesa); o "realizado" considera somente
lançamentos **Pago/Recebido**; os "pendentes" somam os lançamentos com status **Pendente**.
Cada usuário tem seus próprios dados, totalmente isolados.

## Segurança implementada

- Senhas com hash PBKDF2 (ASP.NET Core Identity); política: 8+ caracteres, maiúscula, minúscula e número
- Bloqueio da conta por 10 min após 5 tentativas erradas; limite de 10 requisições/min por IP nos endpoints de login
- Mensagem única para "usuário ou senha inválidos" (não revela se o e-mail existe)
- Sessão em cookie `HttpOnly` + `SameSite=Strict` (+ `Secure` em HTTPS), expira em 8h de inatividade — sem tokens no `localStorage`
- Proteção CSRF: cabeçalho `X-Requested-With` obrigatório em POST/PUT/PATCH/DELETE
- Todas as consultas filtram pelo usuário logado; categoria/conta informadas são validadas contra o dono
- Cabeçalhos: CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, HSTS (fora de Development)
- Login com Google: ID token validado no servidor (assinatura, audiência = nosso Client ID, `email_verified`); vínculo pelo `sub` do Google, não pelo e-mail
- Proteção contra *pre-hijacking*: se existir conta por senha com e-mail **não confirmado**, o primeiro login Google remove a senha antiga e derruba as sessões
- Cookie `Secure` obrigatório fora de Development; sessões revalidadas a cada 1 min (troca/remoção de senha as invalida rápido)
- Respostas da API com `Cache-Control: no-store`; corpo de requisição limitado a ~1 MB; cabeçalho `Server` removido
- Segredos fora do Git (`.gitignore`, `.env`, user-secrets); banco do Docker local só escuta em 127.0.0.1
- Validação no servidor (DataAnnotations) e constraint `Valor > 0` no banco; EF Core parametriza todas as consultas

## Estrutura

```
Program.cs            configuração: Identity, cookie, rate limit, headers, SPA fallback
Controllers/          Auth (inclui troca de senha por e-mail), Lancamentos (fixas, parcelas), Categorias, Contas (cartões),
                      Resumo, Orcamento, Painel, Cartoes, Metas, Preferencias (lembretes, CSV), Backup
Models/ Data/ Dtos/   entidades, DbContext, contratos da API
Services/             Regras e Calculos (mesmas contas do motor local), Email (SMTP em segundo plano), dados iniciais
infra/                main.bicep: App Service F1 + Azure SQL grátis
tests/contrato/       servidor x motor local (roda no CI com SQL Server)
ClientApp/            React + MUI (src/pages, src/components, src/auth)
wwwroot/              build do React (gerado)
```

## Publicar online

Caminho recomendado e gratuito: **Azure** — veja [INFRA.md](INFRA.md). As opções abaixo (VPS com Docker) também funcionam.

Veja o guia completo em **[PUBLICAR.md](PUBLICAR.md)** (Google Cloud, Docker, VPS com HTTPS automático, Azure e checklist de segurança).

## Observações

- O esquema do banco usa migrations do EF Core (`Data/Migrations`), aplicadas ao iniciar. Para gerar uma nova sem ter o .NET
  instalado: `git push origin HEAD:gerar-migracao/NomeDaMudanca` (veja [INFRA.md](INFRA.md)).
- Para publicar em produção, sirva sempre por HTTPS e use um SQL Server com credenciais próprias.

## Usar outra versão do .NET

Para .NET 8, altere `TargetFramework` para `net8.0` e as versões dos pacotes `10.0.*` para `8.0.*` no `.csproj`.

## GitHub Codespaces

O projeto inclui `.devcontainer/` (instala .NET 10, Node 24 e Docker, e sobe o SQL Server sozinho).
Crie o codespace e, no terminal, execute: `dotnet run --urls http://localhost:5080`

## App no celular (modo local, sem servidor)

> O código do modo local continua aqui (a interface é a mesma), mas o PWA e o APK são publicados pelo repositório
> [controle-financeiro](https://github.com/ronxss/controle-financeiro). Este repositório não tem os workflows de Pages e APK.

A mesma interface roda também **só no aparelho**, sem internet e sem servidor — os dados nunca saem do celular.

| Plataforma | Como instalar |
|---|---|
| **Android (APK)** | Baixe o `controle-financeiro.apk` em **Releases** e instale (o Android pede para permitir "fontes desconhecidas"). O APK usa chave de debug: não é da Play Store. |
| **Android e iPhone (PWA)** | Abra o endereço do GitHub Pages do projeto (`https://<usuario>.github.io/controle-financeiro/`) no Chrome/Safari e escolha **Adicionar à tela inicial**. Depois da primeira visita funciona offline. |

Um app iOS nativo exigiria conta de desenvolvedor paga da Apple; no iPhone use o PWA.

### Contas e senhas

Na primeira vez, **crie uma conta** (nome de usuário + senha). Podem existir várias contas no mesmo aparelho, cada uma com seus próprios dados.

- Os dados de cada conta ficam **criptografados** (AES-256-GCM) com uma chave derivada da senha (PBKDF2-SHA256, 600 mil iterações). A senha nunca é gravada.
- **Não existe recuperação de senha**: sem ela, os dados não podem ser lidos por ninguém. Em "Esqueci minha senha" dá para apagar a conta e recomeçar importando um backup.
- Use **Exportar backup** (menu do usuário) de vez em quando. O arquivo de backup **não é criptografado**: guarde-o em lugar seguro.
  - No APK, o backup é gravado em *Documentos/Controle Financeiro* e a folha de compartilhamento do Android abre para enviar ao Drive, e-mail etc. (em Android 9 ou anterior, só o compartilhamento). No navegador do celular abre o compartilhamento; no computador, o arquivo vai para Downloads.
- Quem usava uma versão anterior sem senha não perde nada: a primeira conta criada adota esses dados.
- Limite do modelo: a criptografia protege o aparelho desligado/perdido e quem abrir o banco do navegador; não protege contra um aparelho já infectado ou contra quem observe você digitando a senha.

### Receitas e despesas fixas e painel de métricas

No app local (PWA/APK):

- **Receita ou despesa fixa**: no formulário, ative “Receita fixa” / “Despesa fixa (repete todo mês)”; em *Lançamentos* o alfinete marca/desmarca, e o filtro “Só fixas” mostra apenas elas.
- **Copiar fixas do mês anterior**: recria as receitas e despesas fixas do mês anterior no mês exibido, como *Pendente* e com o dia ajustado ao tamanho do mês (31 → 28). Não duplica o que já foi copiado.
- **Resumo**: além dos totais, mostra orçamento total e por categoria (atenção a partir de 80% do limite, estourado acima de 100%), receitas fixas × despesas fixas (quanto sobra e quanto das receitas fixas fica comprometido), despesas fixas × variáveis, evolução de 6 meses, ritmo/projeção do mês, comparação com o mês anterior e as 5 maiores despesas. Despesas pagas contam como realizado; as pendentes aparecem à parte.
- Backups antigos continuam válidos (lançamentos sem o campo valem como não fixos). Isso existe só no modo local; o servidor em C# não mudou.

### Compras parceladas e cartão de crédito

- **Parcelar**: no formulário de despesa, escolha "2x" a "48x" e diga se o valor digitado é o total ou o de cada parcela. São criados lançamentos ligados (1/10, 2/10…), um por mês, no mesmo dia (31 vira o último dia em meses menores); a soma bate com o total ao centavo. Só a 1ª segue o status escolhido; as outras ficam pendentes. Ao excluir uma parcela: só ela, ela e as seguintes, ou todas.
- **Cartão de crédito**: em *Cadastros → Contas*, marque a conta como cartão e informe os dias de fechamento e vencimento. Compras até o fechamento (inclusive) entram na fatura daquele ciclo; a fatura é identificada pelo mês em que vence.
- **Tela Cartões**: faturas que vencem no mês selecionado (total, pago, a pagar, situação: aberta, fechada, vencida, paga) e o botão **Pagar fatura**, que marca como pagos todos os pendentes dela. Estornos (receita no cartão) abatem do total.
- Nos avisos e notificações, compras no cartão não aparecem uma a uma: aparece a **fatura**, pela data de vencimento.

### Metas de economia e planilha (CSV)

- **Metas** (*Orçamento → Metas*): nome, valor-alvo e prazo opcional. Registre o que guardou ou retirou; o app mostra progresso, quanto falta, quanto guardar por mês até o prazo e se está no ritmo (comparando com uma linha reta da criação até o prazo). Os registros ficam só na meta: não criam lançamentos.
- **Exportar planilha (CSV)** (menu do usuário): mês selecionado, ano ou tudo. Formato para Excel/Planilhas em português (separador `;`, vírgula decimal, datas dd/mm/aaaa, acentos corretos). A coluna *Valor* tem sinal (despesas negativas). Descrições que começam com `=`, `+`, `-` ou `@` são gravadas como texto, para não virarem fórmula.

### Lembretes e backup

Menu do usuário → **Lembretes e backup**:

- **Lembretes de vencimento (APK)**: notificações para receitas e despesas *pendentes*, no dia e, se quiser, 1 a 7 dias antes, no horário escolhido. Dá para esconder descrição e valor da notificação. No navegador (PWA) não há notificação; os avisos aparecem no topo do *Resumo* (atrasados e próximos 7 dias, com botão "Paguei"/"Recebi").
- **Lembrete de backup**: o *Resumo* avisa quando o último backup tem 7 dias ou mais.
- **Backup automático semanal (APK, opcional)**: uma cópia por semana em *Documentos/Controle Financeiro*, mantendo as 4 mais recentes. Não é criptografado e não sai do celular: de vez em quando, envie um backup para o Drive ou e-mail.

### Assinatura do APK

O APK é assinado sempre com a mesma chave (segredos `ANDROID_KEYSTORE_BASE64` e `ANDROID_KEYSTORE_SENHA` do repositório), para cada versão nova instalar por cima da anterior sem perder dados. Sem os segredos, o workflow gera só um APK de teste e não publica Release. Guarde a chave (`.p12`) fora do GitHub: sem ela, não há como publicar atualizações compatíveis.

### Desenvolvimento

```bash
cd ClientApp
npm test                 # testes do motor local e das contas (node --test)
npm run dev:mobile       # modo local com hot reload
npm run build:mobile     # gera ClientApp/dist-local (PWA)
```

Workflows: **Publicar app (PWA)** (GitHub Pages, a cada push na `main`; ative em Settings → Pages → Source: *GitHub Actions*) e **APK Android** (Actions → Run workflow; preencha `versao`, ex. `v1.0.1`, para publicar em Releases).
