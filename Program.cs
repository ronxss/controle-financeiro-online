using System.Text.Json.Serialization;
using System.Threading.RateLimiting;
using ControleFinanceiro.Data;
using ControleFinanceiro.Models;
using ControleFinanceiro.Services;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

// Não revela o servidor e limita o tamanho das requisições (a API só recebe JSON pequeno).
builder.WebHost.ConfigureKestrel(o =>
{
    o.AddServerHeader = false;
    o.Limits.MaxRequestBodySize = 1_000_000; // ~1 MB
});

// Chaves que protegem o cookie de login. Em hospedagem com disco efêmero (containers), aponte
// DataProtection:Path para um volume persistente; sem isso, todos são deslogados a cada reinício/deploy.
var chavesPath = builder.Configuration["DataProtection:Path"];
var dataProtection = builder.Services.AddDataProtection().SetApplicationName("ControleFinanceiro");
if (!string.IsNullOrWhiteSpace(chavesPath))
    dataProtection.PersistKeysToFileSystem(new DirectoryInfo(chavesPath));

// ---------- Banco de dados (SQL Server) ----------
var connectionString = builder.Configuration.GetConnectionString("Default")
    ?? throw new InvalidOperationException("ConnectionStrings:Default não configurada.");
builder.Services.AddDbContext<AppDbContext>(o =>
    o.UseSqlServer(connectionString, sql => sql.EnableRetryOnFailure()));

// ---------- Autenticação: ASP.NET Core Identity + cookie seguro ----------
builder.Services
    .AddIdentity<ApplicationUser, IdentityRole>(o =>
    {
        o.User.RequireUniqueEmail = true;

        o.Password.RequiredLength = 8;
        o.Password.RequireDigit = true;
        o.Password.RequireLowercase = true;
        o.Password.RequireUppercase = true;
        o.Password.RequireNonAlphanumeric = false;

        // Bloqueio por tentativas inválidas (força bruta)
        o.Lockout.AllowedForNewUsers = true;
        o.Lockout.MaxFailedAccessAttempts = 5;
        o.Lockout.DefaultLockoutTimeSpan = TimeSpan.FromMinutes(10);
    })
    .AddEntityFrameworkStores<AppDbContext>()
    .AddErrorDescriber<IdentityErrorDescriberPtBr>()
    .AddDefaultTokenProviders();

// Link de troca de senha por e-mail: vale 1 hora (e deixa de valer assim que a senha muda).
builder.Services.Configure<DataProtectionTokenProviderOptions>(o => o.TokenLifespan = TimeSpan.FromHours(1));

// "Testes" = ambiente do CI (http://localhost, sem HTTPS), usado pelos testes de contrato.
var semHttps = builder.Environment.IsDevelopment() || builder.Environment.IsEnvironment("Testes");

builder.Services.ConfigureApplicationCookie(o =>
{
    o.Cookie.Name = "cf.auth";
    o.Cookie.HttpOnly = true;                              // JavaScript não lê o cookie (mitiga XSS)
    o.Cookie.SameSite = SameSiteMode.Strict;               // não é enviado em requisições de outros sites (mitiga CSRF)
    o.Cookie.SecurePolicy = semHttps
        ? CookieSecurePolicy.SameAsRequest   // permite http://localhost no desenvolvimento
        : CookieSecurePolicy.Always;         // em produção o cookie só trafega por HTTPS
    o.ExpireTimeSpan = TimeSpan.FromHours(8);
    o.SlidingExpiration = true;
    // API: devolve 401/403 em vez de redirecionar para uma página de login
    o.Events.OnRedirectToLogin = ctx => { ctx.Response.StatusCode = StatusCodes.Status401Unauthorized; return Task.CompletedTask; };
    o.Events.OnRedirectToAccessDenied = ctx => { ctx.Response.StatusCode = StatusCodes.Status403Forbidden; return Task.CompletedTask; };
});

// Revalida o usuário a cada minuto (padrão: 30 min): troca de senha / remoção de senha derruba sessões antigas rápido.
builder.Services.Configure<SecurityStampValidatorOptions>(o => o.ValidationInterval = TimeSpan.FromMinutes(1));

// ---------- Limite de requisições nos endpoints de autenticação ----------
var limiteAuth = builder.Configuration.GetValue("App:LimiteAuthPorMinuto", 10);
builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    // Um limite por IP E por endpoint: quem divide o mesmo IP (empresa, faculdade) não esgota o limite do login
    // ao criar conta, por exemplo. A chave usa o nome do endpoint resolvido pelo roteamento, e NÃO o caminho da
    // URL: o roteamento ignora maiúsculas/minúsculas e barra final, então variar a URL criaria um balde novo
    // a cada tentativa e anularia o limite.
    o.AddPolicy("auth", ctx => RateLimitPartition.GetFixedWindowLimiter(
        $"{ctx.Connection.RemoteIpAddress?.ToString() ?? "local"}|{ctx.GetEndpoint()?.DisplayName ?? "?"}",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = limiteAuth, Window = TimeSpan.FromMinutes(1), QueueLimit = 0 }));
});

// ---------- Serviços do app ----------
builder.Services.AddSingleton<Relogio>();                 // "hoje" no fuso do usuário (App:FusoHorario)
builder.Services.Configure<EmailOptions>(builder.Configuration.GetSection("Email"));
builder.Services.AddSingleton<FilaEmails>();
builder.Services.AddHostedService<EnviadorEmails>();      // envia os e-mails em segundo plano

builder.Services.AddControllers()
    .AddJsonOptions(o => o.JsonSerializerOptions.Converters.Add(new JsonStringEnumConverter()));

var app = builder.Build();

await using (var scope = app.Services.CreateAsyncScope())
{
    await DadosIniciais.InicializarBancoAsync(scope.ServiceProvider, app.Logger);
}

if (!semHttps)
{
    app.UseExceptionHandler(a => a.Run(async ctx =>
    {
        ctx.Response.StatusCode = StatusCodes.Status500InternalServerError;
        await ctx.Response.WriteAsJsonAsync(new { mensagem = "Erro interno do servidor." });
    }));
    app.UseHsts();
    app.UseHttpsRedirection();
}

// ---------- Cabeçalhos de segurança ----------
// Com o login Google ativo, liberamos somente os endereços do Google Identity Services.
var googleAtivo = !string.IsNullOrWhiteSpace(app.Configuration["Google:ClientId"]);
var csp =
    "default-src 'self'; " +
    (googleAtivo ? "script-src 'self' https://accounts.google.com/gsi/client; " : "script-src 'self'; ") +
    (googleAtivo ? "style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style; " : "style-src 'self' 'unsafe-inline'; ") +
    "img-src 'self' data:; font-src 'self' data:; " +
    (googleAtivo ? "connect-src 'self' https://accounts.google.com/gsi/; frame-src https://accounts.google.com/gsi/; "
                 : "connect-src 'self'; ") +
    "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'";

app.Use(async (ctx, next) =>
{
    var h = ctx.Response.Headers;
    h["X-Content-Type-Options"] = "nosniff";
    h["X-Frame-Options"] = "DENY";
    h["Referrer-Policy"] = "no-referrer";
    h["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()";
    h["Cross-Origin-Opener-Policy"] = "same-origin-allow-popups"; // compatível com o popup do Google
    h["Content-Security-Policy"] = csp;

    // Dados financeiros nunca devem ficar em cache do navegador/proxy.
    if (ctx.Request.Path.StartsWithSegments("/api"))
        h["Cache-Control"] = "no-store";

    await next();
});

app.UseStaticFiles();
app.UseRouting();
app.UseRateLimiter();

// ---------- Proteção CSRF adicional ----------
// Toda requisição que altera dados exige um cabeçalho customizado. Outros sites não conseguem
// enviá-lo (exigiria CORS, que não está habilitado) e o cookie já é SameSite=Strict.
app.Use(async (ctx, next) =>
{
    var m = ctx.Request.Method;
    var altera = !(HttpMethods.IsGet(m) || HttpMethods.IsHead(m) || HttpMethods.IsOptions(m));
    if (altera && ctx.Request.Path.StartsWithSegments("/api")
        && ctx.Request.Headers["X-Requested-With"] != "XMLHttpRequest")
    {
        ctx.Response.StatusCode = StatusCodes.Status400BadRequest;
        await ctx.Response.WriteAsJsonAsync(new { mensagem = "Requisição inválida." });
        return;
    }
    await next();
});

app.UseAuthentication();
app.UseAuthorization();

app.MapControllers();
app.MapFallback("/api/{**rest}", () => Results.NotFound(new { mensagem = "Recurso não encontrado." }));
app.MapFallbackToFile("index.html"); // SPA React

app.Run();
