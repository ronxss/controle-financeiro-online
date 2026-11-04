# Publicar no Azure (grátis)

O site roda no **Azure App Service F1** e os dados ficam no **Azure SQL Database** na oferta gratuita.
Tudo é criado por um único arquivo, `infra/main.bicep`, e o código é publicado automaticamente pelo GitHub Actions a cada push na `main`.

> Preços e limites de planos gratuitos mudam. Confira antes no portal do Azure.
> Em novembro de 2026 eram: App Service F1 com 60 min de CPU por dia, o app "dorme" após ~20 min sem acesso e não tem domínio próprio com HTTPS;
> Azure SQL grátis com 100.000 vCore-segundos e 32 GB por mês, pausa após 15 min sem uso, até 10 bancos grátis por assinatura.

## O que esperar do plano grátis

- **Primeiro acesso lento:** se ninguém usou o site por um tempo, o app e o banco "acordam". Pode levar de 30 segundos a 2 minutos. Depois fica rápido.
- **Sem cobrança surpresa:** o banco está configurado para **pausar** (e não cobrar) se a cota grátis do mês acabar. Nesse caso o site fica fora até o mês seguinte. Para uso pessoal ou familiar, a cota costuma sobrar.
- **Backup do banco:** o Azure SQL guarda backups automáticos (restauração para um ponto no tempo). Além disso, use *Exportar backup* no menu de vez em quando.

## 1. Criar a conta do Azure

1. Acesse https://azure.microsoft.com/free e crie a conta (pode pedir cartão para verificação; os recursos abaixo são gratuitos).
2. Abra o **Cloud Shell** no portal (ícone `>_` no topo) e escolha **Bash**. Ele já tem `az` e Bicep; não precisa instalar nada.

## 2. Criar os recursos (uma vez)

No Cloud Shell:

```bash
git clone https://github.com/ronxss/controle-financeiro-online.git   # pede login, pois o repositório é privado
cd controle-financeiro-online

az group create --name controle-financeiro --location brazilsouth

az deployment group create \
  --resource-group controle-financeiro \
  --template-file infra/main.bicep \
  --parameters prefixo=SEUPREFIXO \
               sqlSenha='UmaSenhaForte!2026' \
               emailHost=smtp-relay.brevo.com emailUsuario=SEU_LOGIN_BREVO \
               emailSenha='SUA_CHAVE_SMTP_BREVO' emailRemetente=voce@seudominio.com.br
```

- `prefixo`: só letras minúsculas e números, único no Azure (ex.: `cfronxss`). O site fica em `https://SEUPREFIXO-app.azurewebsites.net`.
- `sqlSenha`: 12 ou mais caracteres com maiúscula, minúscula, número e símbolo. Guarde num gerenciador de senhas.
- E-mail é opcional. Sem ele, o site funciona, mas "Esqueci minha senha" não envia nada (veja o passo 4).
- Se aparecer erro de **runtime** (`DOTNETCORE|10.0` indisponível na região), rode `az webapp list-runtimes --os linux | grep DOTNET` e repita com `--parameters runtime='DOTNETCORE|<versão listada>'`.

Se for usar login com Google, acrescente `googleClientId=SEU_CLIENT_ID` e, no Google Cloud Console, inclua `https://SEUPREFIXO-app.azurewebsites.net` nas **Origens JavaScript autorizadas**.

## 3. Ligar o deploy automático do GitHub

1. No portal do Azure, abra o App Service `SEUPREFIXO-app` → **Baixar perfil de publicação** (Download publish profile). Ele baixa um arquivo `.PublishSettings`.
2. No GitHub, em **Settings → Secrets and variables → Actions**:
   - aba **Secrets** → *New repository secret*: nome `AZURE_WEBAPP_PUBLISH_PROFILE`, valor = conteúdo inteiro do arquivo baixado;
   - aba **Variables** → *New repository variable*: nome `AZURE_WEBAPP_NAME`, valor = `SEUPREFIXO-app`.
3. Em **Actions → Publicar no Azure → Run workflow**. Os próximos pushes na `main` publicam sozinhos.

O workflow compila, roda os testes, publica e confere se o site respondeu.

## 4. E-mail de troca de senha (grátis)

Qualquer SMTP serve. O mais simples sem custo é o **Brevo** (300 e-mails por dia no plano grátis):

1. Crie a conta em https://www.brevo.com e verifique o remetente (um e-mail seu ou, melhor, um domínio próprio).
2. Em **SMTP & API → SMTP**, copie o *login* e gere uma *chave SMTP*.
3. Use `emailHost=smtp-relay.brevo.com`, `emailUsuario=<login>`, `emailSenha=<chave>` e `emailRemetente=<e-mail verificado>` no passo 2.
   Ou, sem reimplantar: App Service → **Configuração** → edite `Email__Host`, `Email__Usuario`, `Email__Senha` e `Email__Remetente`.

Como funciona: o link vale **1 hora**, só pode ser usado **uma vez** e deixa de valer se a senha mudar. A tela sempre responde a mesma coisa, exista ou não a conta, e o e-mail sai em segundo plano, para ninguém descobrir quem tem cadastro. O link usa sempre o endereço configurado (`App__UrlPublica`), nunca o que veio na requisição.

## 5. Levar os dados do app local (celular) para o online

1. No app local: menu → **Exportar backup**.
2. No site online: crie a conta e entre → menu → **Importar backup** → escolha o arquivo.

Funciona nos dois sentidos: o backup exportado do site abre no app local.

## Domínio próprio (opcional)

O plano F1 não tem HTTPS em domínio próprio. Para usar `financas.seudominio.com.br` é preciso o plano **B1** (pago). Depois de trocar, rode o deploy do Bicep com `dominio=financas.seudominio.com.br` e configure o domínio no App Service.

## Mudanças no banco (migrations)

O esquema do banco evolui por migrations do EF Core, aplicadas sozinhas quando o app inicia. Para criar uma sem ter o .NET instalado:

```bash
git push origin HEAD:gerar-migracao/NomeDaMudanca
```

O workflow **Gerar migration do banco** cria os arquivos em `Data/Migrations` e faz commit no mesmo branch. Depois é só juntar ao seu branch (`git pull origin gerar-migracao/NomeDaMudanca`).

## Checklist de segurança

- [x] Só HTTPS (`httpsOnly`, HSTS, cookie `Secure`), TLS 1.2 ou mais, FTP desligado
- [x] Banco aceita conexões só de dentro do Azure; senha do SQL fora do código (parâmetro seguro)
- [x] Segredos (perfil de publicação, senha do SMTP) nos segredos do GitHub e na configuração do App Service, nunca no Git
- [x] Limite de tentativas no login, no cadastro e na troca de senha
- [ ] Trocar o administrador do SQL por um usuário só com acesso ao banco `ControleFinanceiro` (opcional)
- [ ] Confirmação de e-mail no cadastro e 2FA (melhorias futuras)
