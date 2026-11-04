// Infraestrutura do Controle Financeiro online no Azure, nos planos GRATUITOS:
//   - App Service plano F1 (Linux): 60 min de CPU por dia; o app "dorme" após ~20 min sem acesso.
//   - Azure SQL Database com a oferta gratuita: 100.000 vCore-segundos e 32 GB por mês; pausa após 15 min sem uso.
//     Ao esgotar a cota do mês ele PAUSA (AutoPause) até o mês seguinte — nunca gera cobrança.
//
// Como usar: veja INFRA.md (roda no Azure Cloud Shell, sem instalar nada).
targetScope = 'resourceGroup'

@description('Prefixo dos nomes (letras minúsculas e números). O site fica em https://<prefixo>-app.azurewebsites.net')
@minLength(3)
@maxLength(20)
param prefixo string

@description('Região do Azure. brazilsouth = São Paulo.')
param local string = resourceGroup().location

@description('Usuário administrador do SQL (não use "admin" nem "sa").')
param sqlUsuario string = 'cfadmin'

@description('Senha do administrador do SQL: 12+ caracteres com maiúscula, minúscula, número e símbolo.')
@secure()
@minLength(12)
param sqlSenha string

@description('Client ID do login com Google (opcional).')
param googleClientId string = ''

@description('Domínio próprio (opcional), ex.: financas.seudominio.com.br. Vazio = usa o endereço *.azurewebsites.net.')
param dominio string = ''

@description('Servidor SMTP para os e-mails de troca de senha (ex.: smtp-relay.brevo.com). Vazio = não envia.')
param emailHost string = ''
param emailPorta int = 587
param emailUsuario string = ''
@secure()
param emailSenha string = ''
@description('Remetente dos e-mails (precisa estar verificado no provedor de e-mail).')
param emailRemetente string = ''

@description('Pilha do App Service. Confira as disponíveis com: az webapp list-runtimes --os linux')
param runtime string = 'DOTNETCORE|10.0'

var nomeApp = '${prefixo}-app'
var nomePlano = '${prefixo}-plano'
var nomeSql = '${prefixo}-sql'
var nomeBanco = 'ControleFinanceiro'
var host = empty(dominio) ? '${nomeApp}.azurewebsites.net' : dominio

resource sql 'Microsoft.Sql/servers@2023-08-01-preview' = {
  name: nomeSql
  location: local
  properties: {
    administratorLogin: sqlUsuario
    administratorLoginPassword: sqlSenha
    minimalTlsVersion: '1.2'
    publicNetworkAccess: 'Enabled'
  }
}

// "Permitir serviços do Azure": só o tráfego vindo do próprio Azure (o App Service) passa; a internet não.
resource sqlFirewallAzure 'Microsoft.Sql/servers/firewallRules@2023-08-01-preview' = {
  parent: sql
  name: 'AllowAllWindowsAzureIps'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

resource banco 'Microsoft.Sql/servers/databases@2023-08-01-preview' = {
  parent: sql
  name: nomeBanco
  location: local
  sku: {
    name: 'GP_S_Gen5_2'
    tier: 'GeneralPurpose'
    family: 'Gen5'
    capacity: 2
  }
  properties: {
    useFreeLimit: true
    freeLimitExhaustionBehavior: 'AutoPause' // ao esgotar a cota grátis: pausa até o mês seguinte (sem cobrança)
    maxSizeBytes: 34359738368 // 32 GB
    minCapacity: json('0.5')
    zoneRedundant: false
    requestedBackupStorageRedundancy: 'Local'
  }
}

resource plano 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: nomePlano
  location: local
  kind: 'linux'
  sku: {
    name: 'F1'
    tier: 'Free'
  }
  properties: {
    reserved: true // Linux
  }
}

var conexao = 'Server=tcp:${sql.properties.fullyQualifiedDomainName},1433;Database=${nomeBanco};User ID=${sqlUsuario};Password=${sqlSenha};Encrypt=True;TrustServerCertificate=False;Connection Timeout=90;'

resource app 'Microsoft.Web/sites@2023-12-01' = {
  name: nomeApp
  location: local
  kind: 'app,linux'
  properties: {
    serverFarmId: plano.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: runtime
      alwaysOn: false // não existe no plano grátis
      ftpsState: 'Disabled'
      minTlsVersion: '1.2'
      http20Enabled: true
      healthCheckPath: '/api/auth/config'
      appSettings: [
        { name: 'ASPNETCORE_ENVIRONMENT', value: 'Production' }
        { name: 'ASPNETCORE_FORWARDEDHEADERS_ENABLED', value: 'true' }
        { name: 'AllowedHosts', value: host }
        { name: 'App__UrlPublica', value: 'https://${host}' }
        { name: 'App__FusoHorario', value: 'America/Sao_Paulo' }
        { name: 'DataProtection__Path', value: '/home/keys' } // /home persiste entre reinícios e deploys
        { name: 'Google__ClientId', value: googleClientId }
        { name: 'Email__Host', value: emailHost }
        { name: 'Email__Porta', value: string(emailPorta) }
        { name: 'Email__Usuario', value: emailUsuario }
        { name: 'Email__Senha', value: emailSenha }
        { name: 'Email__Remetente', value: emailRemetente }
      ]
      connectionStrings: [
        { name: 'Default', connectionString: conexao, type: 'SQLAzure' }
      ]
    }
  }
}

// O deploy pelo GitHub Actions usa o "perfil de publicação", que precisa deste acesso ligado.
resource publicacaoScm 'Microsoft.Web/sites/basicPublishingCredentialsPolicies@2023-12-01' = {
  parent: app
  name: 'scm'
  properties: {
    allow: true
  }
}

resource publicacaoFtp 'Microsoft.Web/sites/basicPublishingCredentialsPolicies@2023-12-01' = {
  parent: app
  name: 'ftp'
  properties: {
    allow: false
  }
}

output site string = 'https://${host}'
output nomeDoApp string = nomeApp
output servidorSql string = sql.properties.fullyQualifiedDomainName
