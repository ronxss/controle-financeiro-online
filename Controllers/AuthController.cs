using ControleFinanceiro.Data;
using ControleFinanceiro.Dtos;
using ControleFinanceiro.Models;
using ControleFinanceiro.Services;
using Google.Apis.Auth;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.WebUtilities;
using System.Net;
using System.Text;

namespace ControleFinanceiro.Controllers;

[ApiController, Route("api/auth")]
public class AuthController(
    UserManager<ApplicationUser> users,
    SignInManager<ApplicationUser> signIn,
    AppDbContext db,
    IConfiguration config,
    FilaEmails emails,
    IWebHostEnvironment env,
    ILogger<AuthController> logger) : ControllerBase
{
    private const string ProvedorGoogle = "Google";

    /// <summary>Configuração pública que o front-end precisa antes do login (o Client ID do Google não é segredo).</summary>
    [HttpGet("config")]
    public IActionResult Config() => Ok(new { googleClientId = config["Google:ClientId"] });

    [HttpPost("registrar"), EnableRateLimiting("auth")]
    public async Task<IActionResult> Registrar(RegistroRequest req)
    {
        var email = req.Email.Trim();
        var user = new ApplicationUser { UserName = email, Email = email, NomeCompleto = req.Nome.Trim() };

        var result = await users.CreateAsync(user, req.Senha);
        if (!result.Succeeded)
            return BadRequest(new { mensagem = string.Join(" ", result.Errors.Select(e => e.Description).Distinct()) });

        await DadosIniciais.CriarAsync(db, user.Id);
        await signIn.SignInAsync(user, isPersistent: false);
        return Ok(new UsuarioDto(user.NomeCompleto, email, TemSenha: true));
    }

    [HttpPost("entrar"), EnableRateLimiting("auth")]
    public async Task<IActionResult> Entrar(LoginRequest req)
    {
        var result = await signIn.PasswordSignInAsync(req.Email.Trim(), req.Senha, isPersistent: false, lockoutOnFailure: true);

        if (result.IsLockedOut)
            return StatusCode(StatusCodes.Status429TooManyRequests,
                new { mensagem = "Muitas tentativas incorretas. Conta bloqueada por 10 minutos." });
        if (!result.Succeeded)
            return Unauthorized(new { mensagem = "E-mail ou senha inválidos." }); // mesma mensagem para ambos os casos

        var user = await users.FindByNameAsync(req.Email.Trim());
        return Ok(new UsuarioDto(user!.NomeCompleto, user.Email!, TemSenha: true));
    }

    /// <summary>
    /// Login com Google (Google Identity Services). O navegador envia o ID token (JWT) assinado pelo Google;
    /// o servidor valida assinatura, validade e audiência (nosso Client ID) antes de criar a sessão por cookie.
    /// </summary>
    [HttpPost("google"), EnableRateLimiting("auth")]
    public async Task<IActionResult> Google(GoogleLoginRequest req)
    {
        var clientId = config["Google:ClientId"];
        if (string.IsNullOrWhiteSpace(clientId))
            return NotFound(new { mensagem = "Login com Google não está configurado." });

        GoogleJsonWebSignature.Payload payload;
        try
        {
            payload = await GoogleJsonWebSignature.ValidateAsync(req.Credential,
                new GoogleJsonWebSignature.ValidationSettings { Audience = [clientId] });
        }
        catch (InvalidJwtException ex)
        {
            logger.LogWarning("ID token do Google rejeitado: {Msg}", ex.Message);
            return Unauthorized(new { mensagem = "Não foi possível validar o login com o Google." });
        }

        // Só aceitamos e-mails que o Google garante que pertencem à pessoa.
        if (!payload.EmailVerified || string.IsNullOrWhiteSpace(payload.Email))
            return Unauthorized(new { mensagem = "O e-mail da conta Google não está verificado." });

        // 1) Já vinculado a esta conta Google (identificador estável "sub", não o e-mail).
        var user = await users.FindByLoginAsync(ProvedorGoogle, payload.Subject);

        if (user is null)
        {
            user = await users.FindByEmailAsync(payload.Email);

            if (user is null)
            {
                // 2) Primeiro acesso: cria a conta (sem senha) e os dados iniciais.
                var nome = string.IsNullOrWhiteSpace(payload.Name) ? payload.Email.Split('@')[0] : payload.Name.Trim();
                user = new ApplicationUser
                {
                    UserName = payload.Email,
                    Email = payload.Email,
                    EmailConfirmed = true,
                    NomeCompleto = nome.Length > 100 ? nome[..100] : nome,
                };
                var criado = await users.CreateAsync(user);
                if (!criado.Succeeded)
                {
                    logger.LogError("Falha ao criar usuário Google: {Erros}", string.Join("; ", criado.Errors.Select(e => e.Code)));
                    return BadRequest(new { mensagem = "Não foi possível criar a conta." });
                }
                await DadosIniciais.CriarAsync(db, user.Id);
            }
            else if (!user.EmailConfirmed)
            {
                // 3) Já existe conta criada por e-mail/senha SEM confirmação de e-mail. Alguém poderia ter se
                //    cadastrado com o e-mail da vítima ("pre-hijacking"). Como o Google prova a posse do e-mail,
                //    removemos a senha antiga, marcamos o e-mail como confirmado e derrubamos sessões existentes.
                if (await users.HasPasswordAsync(user)) await users.RemovePasswordAsync(user);
                user.EmailConfirmed = true;
                await users.UpdateAsync(user);
                await users.UpdateSecurityStampAsync(user);
            }

            var vinculo = await users.AddLoginAsync(user, new UserLoginInfo(ProvedorGoogle, payload.Subject, ProvedorGoogle));
            if (!vinculo.Succeeded)
            {
                logger.LogError("Falha ao vincular login Google: {Erros}", string.Join("; ", vinculo.Errors.Select(e => e.Code)));
                return BadRequest(new { mensagem = "Não foi possível vincular a conta Google." });
            }
        }

        if (await users.IsLockedOutAsync(user))
            return StatusCode(StatusCodes.Status429TooManyRequests, new { mensagem = "Conta temporariamente bloqueada." });

        await signIn.SignInAsync(user, isPersistent: false);
        return Ok(new UsuarioDto(user.NomeCompleto, user.Email!, await users.HasPasswordAsync(user)));
    }

    private const string MsgEsqueci =
        "Se houver uma conta com esse e-mail, enviamos um link para criar uma nova senha. Ele vale por 1 hora.";
    private const string MsgLinkInvalido = "Link inválido ou expirado. Peça um novo em “Esqueci minha senha”.";

    /// <summary>
    /// Endereço público do site, usado no link do e-mail. Em produção vem SEMPRE da configuração (App:UrlPublica):
    /// montar o link a partir do cabeçalho Host da requisição deixaria um atacante enviar à vítima um link apontando
    /// para o site dele (e roubar o token).
    /// </summary>
    private string? UrlPublica()
    {
        var url = config["App:UrlPublica"]?.TrimEnd('/');
        if (!string.IsNullOrWhiteSpace(url)) return url;
        return env.IsDevelopment() || env.IsEnvironment("Testes") ? $"{Request.Scheme}://{Request.Host}" : null;
    }

    /// <summary>
    /// "Esqueci minha senha": responde SEMPRE a mesma coisa, exista ou não a conta, e o e-mail sai em segundo plano
    /// (o tempo de resposta também não denuncia quem tem cadastro).
    /// </summary>
    [HttpPost("esqueci-senha"), EnableRateLimiting("auth")]
    public async Task<IActionResult> EsqueciSenha(EsqueciSenhaRequest req)
    {
        var resposta = Ok(new { mensagem = MsgEsqueci });
        var baseUrl = UrlPublica();
        if (baseUrl is null)
        {
            logger.LogError("App:UrlPublica não configurada: não é possível enviar o link de troca de senha.");
            return resposta;
        }

        var user = await users.FindByEmailAsync(req.Email.Trim());
        if (user is null) return resposta;

        var token = WebEncoders.Base64UrlEncode(Encoding.UTF8.GetBytes(await users.GeneratePasswordResetTokenAsync(user)));
        var link = $"{baseUrl}/redefinir-senha?email={Uri.EscapeDataString(user.Email!)}&token={token}";
        var nome = WebUtility.HtmlEncode(user.NomeCompleto);
        var temSenha = await users.HasPasswordAsync(user);
        var acao = temSenha ? "criar uma nova senha" : "criar uma senha (hoje você entra pelo Google)";
        var linkHtml = WebUtility.HtmlEncode(link);

        var html =
            $"<p>Olá, {nome}.</p>" +
            $"<p>Recebemos um pedido para {acao} na sua conta do Controle Financeiro.</p>" +
            $"<p><a href=\"{linkHtml}\">Clique aqui para continuar</a>. O link vale por 1 hora e só pode ser usado uma vez.</p>" +
            "<p>Se não foi você, ignore este e-mail: sua senha continua a mesma.</p>";
        var texto =
            $"Olá, {user.NomeCompleto}.\n\nRecebemos um pedido para {acao} na sua conta do Controle Financeiro.\n\n" +
            $"Abra este link (vale por 1 hora e só pode ser usado uma vez):\n{link}\n\n" +
            "Se não foi você, ignore este e-mail: sua senha continua a mesma.";
        emails.Enfileirar(new Email(user.Email!, "Troca de senha — Controle Financeiro", html, texto));
        return resposta;
    }

    [HttpPost("redefinir-senha"), EnableRateLimiting("auth")]
    public async Task<IActionResult> RedefinirSenha(RedefinirSenhaRequest req)
    {
        var user = await users.FindByEmailAsync(req.Email.Trim());
        if (user is null) return BadRequest(new { mensagem = MsgLinkInvalido });

        string token;
        try { token = Encoding.UTF8.GetString(WebEncoders.Base64UrlDecode(req.Token)); }
        catch (FormatException) { return BadRequest(new { mensagem = MsgLinkInvalido }); }

        var result = await users.ResetPasswordAsync(user, token, req.NovaSenha);
        if (!result.Succeeded)
        {
            if (result.Errors.Any(e => e.Code == nameof(IdentityErrorDescriber.InvalidToken)))
                return BadRequest(new { mensagem = MsgLinkInvalido });
            return BadRequest(new { mensagem = string.Join(" ", result.Errors.Select(e => e.Description).Distinct()) });
        }

        // Quem abriu o link provou que é dono do e-mail; a troca também desbloqueia a conta. O ResetPassword já troca
        // o "security stamp", o que derruba as sessões abertas com a senha antiga.
        user.EmailConfirmed = true;
        await users.UpdateAsync(user);
        await users.SetLockoutEndDateAsync(user, null);
        await users.ResetAccessFailedCountAsync(user);
        return NoContent();
    }

    [HttpPost("sair")]
    public async Task<IActionResult> Sair()
    {
        await signIn.SignOutAsync();
        return NoContent();
    }

    [Authorize, HttpGet("eu")]
    public async Task<IActionResult> Eu()
    {
        var user = await users.GetUserAsync(User);
        if (user is null) return Unauthorized();
        return Ok(new UsuarioDto(user.NomeCompleto, user.Email!, await users.HasPasswordAsync(user)));
    }

    [Authorize, HttpPost("alterar-senha"), EnableRateLimiting("auth")]
    public async Task<IActionResult> AlterarSenha(AlterarSenhaRequest req)
    {
        var user = await users.GetUserAsync(User);
        if (user is null) return Unauthorized();

        if (!await users.HasPasswordAsync(user))
            return BadRequest(new { mensagem = "Esta conta entra pelo Google e não possui senha." });

        var result = await users.ChangePasswordAsync(user, req.SenhaAtual, req.NovaSenha);
        if (!result.Succeeded)
            return BadRequest(new { mensagem = string.Join(" ", result.Errors.Select(e => e.Description).Distinct()) });

        await signIn.RefreshSignInAsync(user);
        return NoContent();
    }
}
