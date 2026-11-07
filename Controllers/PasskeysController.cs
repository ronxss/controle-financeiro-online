using System.ComponentModel.DataAnnotations;
using ControleFinanceiro.Dtos;
using ControleFinanceiro.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.AspNetCore.WebUtilities;

namespace ControleFinanceiro.Controllers;

/// <summary>
/// Entrar com o desbloqueio do aparelho (Face ID, digital, PIN): passkeys WebAuthn do ASP.NET Core Identity.
/// Fluxo: o servidor gera as opções (o desafio fica num cookie curto), o navegador chama o autenticador e devolve
/// a credencial em JSON, e o Identity confere assinatura, origem, domínio, desafio e verificação da pessoa.
/// </summary>
[ApiController]
[Route("api/auth/passkeys")]
public class PasskeysController(
    UserManager<ApplicationUser> users,
    SignInManager<ApplicationUser> signIn,
    ILogger<PasskeysController> log) : ControllerBase
{
    public const int MaxPorConta = 10;
    private const string MsgFalhaEntrar = "Não foi possível entrar com o desbloqueio do aparelho. Entre com e-mail e senha.";

    public record PasskeyDto(string Id, string Nome, DateTimeOffset CriadoEm);

    public class OpcoesCriacaoRequest
    {
        /// <summary>Senha atual (obrigatória para contas com senha): ligar o desbloqueio é uma mudança de segurança.</summary>
        public string? Senha { get; set; }
    }

    public class CredencialRequest
    {
        [Required(ErrorMessage = "Credencial ausente."), MaxLength(20000)] public string? Credencial { get; set; }
        [MaxLength(60)] public string? Nome { get; set; }
    }

    private static string IdDe(UserPasskeyInfo p) => WebEncoders.Base64UrlEncode(p.CredentialId);

    private async Task<List<PasskeyDto>> ListarAsync(ApplicationUser user) =>
        (await users.GetPasskeysAsync(user))
            .OrderBy(p => p.CreatedAt)
            .Select(p => new PasskeyDto(IdDe(p), string.IsNullOrWhiteSpace(p.Name) ? "Aparelho" : p.Name!, p.CreatedAt))
            .ToList();

    [Authorize, HttpGet]
    public async Task<IActionResult> Listar()
    {
        var user = await users.GetUserAsync(User);
        if (user is null) return Unauthorized();
        return Ok(await ListarAsync(user));
    }

    /// <summary>Passo 1 do cadastro: confere a senha e devolve as opções para navigator.credentials.create().</summary>
    [Authorize, HttpPost("opcoes-criacao"), EnableRateLimiting("auth")]
    public async Task<IActionResult> OpcoesCriacao(OpcoesCriacaoRequest req)
    {
        var user = await users.GetUserAsync(User);
        if (user is null) return Unauthorized();
        if (await users.HasPasswordAsync(user) && !await users.CheckPasswordAsync(user, req.Senha ?? ""))
            return BadRequest(new { mensagem = "A senha está incorreta." });
        if ((await users.GetPasskeysAsync(user)).Count >= MaxPorConta)
            return BadRequest(new { mensagem = $"Limite de {MaxPorConta} aparelhos atingido. Remova um para ativar outro." });

        var json = await signIn.MakePasskeyCreationOptionsAsync(new PasskeyUserEntity
        {
            Id = await users.GetUserIdAsync(user),
            Name = user.Email!,
            DisplayName = string.IsNullOrWhiteSpace(user.NomeCompleto) ? user.Email! : user.NomeCompleto,
        });
        return Content(json, "application/json");
    }

    /// <summary>Passo 2 do cadastro: confere a credencial criada pelo aparelho e guarda a passkey na conta.</summary>
    [Authorize, HttpPost, EnableRateLimiting("auth")]
    public async Task<IActionResult> Registrar(CredencialRequest req)
    {
        var user = await users.GetUserAsync(User);
        if (user is null) return Unauthorized();

        PasskeyAttestationResult resultado;
        try
        {
            resultado = await signIn.PerformPasskeyAttestationAsync(req.Credencial!);
        }
        catch (InvalidOperationException e)
        {
            log.LogInformation("Cadastro de passkey sem estado: {Motivo}", e.Message);
            return BadRequest(new { mensagem = "O pedido expirou. Tente ativar de novo." });
        }
        if (!resultado.Succeeded)
        {
            log.LogInformation("Cadastro de passkey recusado: {Motivo}", resultado.Failure?.Message);
            return BadRequest(new { mensagem = "Não foi possível ativar o desbloqueio do aparelho. Tente de novo." });
        }
        // O desafio foi gerado para este usuário; confere mesmo assim (o estado vem de um cookie do navegador).
        if (resultado.Passkey is null || resultado.UserEntity?.Id != await users.GetUserIdAsync(user))
            return BadRequest(new { mensagem = "Não foi possível ativar o desbloqueio do aparelho. Tente de novo." });

        var passkey = resultado.Passkey;
        passkey.Name = string.IsNullOrWhiteSpace(req.Nome) ? "Aparelho" : req.Nome.Trim();
        var gravou = await users.AddOrUpdatePasskeyAsync(user, passkey);
        if (!gravou.Succeeded)
            return BadRequest(new { mensagem = string.Join(" ", gravou.Errors.Select(e => e.Description).Distinct()) });

        return Ok(new { id = IdDe(passkey), passkeys = await ListarAsync(user) });
    }

    [Authorize, HttpDelete("{id}")]
    public async Task<IActionResult> Remover(string id)
    {
        var user = await users.GetUserAsync(User);
        if (user is null) return Unauthorized();
        byte[] credId;
        try { credId = WebEncoders.Base64UrlDecode(id); }
        catch (FormatException) { return NotFound(new { mensagem = "Aparelho não encontrado." }); }
        if (await users.GetPasskeyAsync(user, credId) is null) return NotFound(new { mensagem = "Aparelho não encontrado." });
        var r = await users.RemovePasskeyAsync(user, credId);
        if (!r.Succeeded) return BadRequest(new { mensagem = "Não foi possível remover o aparelho." });
        return Ok(await ListarAsync(user));
    }

    /// <summary>Entrar, passo 1: opções para navigator.credentials.get(). Sem usuário: o aparelho oferece a passkey da conta.</summary>
    [AllowAnonymous, HttpPost("opcoes-entrada"), EnableRateLimiting("auth")]
    public async Task<IActionResult> OpcoesEntrada()
    {
        var json = await signIn.MakePasskeyRequestOptionsAsync(null);
        return Content(json, "application/json");
    }

    /// <summary>Entrar, passo 2: confere a assinatura do aparelho e abre a sessão.</summary>
    [AllowAnonymous, HttpPost("entrar"), EnableRateLimiting("auth")]
    public async Task<IActionResult> Entrar(CredencialRequest req)
    {
        PasskeyAssertionResult<ApplicationUser> a;
        try
        {
            a = await signIn.PerformPasskeyAssertionAsync(req.Credencial!);
        }
        catch (InvalidOperationException e)
        {
            // Sem o cookie do passo 1 (expirou ou veio de outra aba).
            log.LogInformation("Entrada por passkey sem estado: {Motivo}", e.Message);
            return Unauthorized(new { mensagem = "O pedido expirou. Toque em “Entrar com desbloqueio do aparelho” de novo." });
        }
        if (!a.Succeeded || a.User is null || a.Passkey is null)
        {
            log.LogInformation("Entrada por passkey recusada: {Motivo}", a.Failure?.Message);
            return Unauthorized(new { mensagem = MsgFalhaEntrar });
        }
        var user = a.User;
        if (!await signIn.CanSignInAsync(user)) return Unauthorized(new { mensagem = MsgFalhaEntrar });
        if (await users.IsLockedOutAsync(user))
            return StatusCode(StatusCodes.Status429TooManyRequests,
                new { mensagem = "Muitas tentativas. A conta foi bloqueada por alguns minutos." });

        // Atualiza o contador de uso da passkey (detecta clonagem) e abre a sessão, como o login com senha.
        var atualizou = await users.AddOrUpdatePasskeyAsync(user, a.Passkey);
        if (!atualizou.Succeeded) return Unauthorized(new { mensagem = MsgFalhaEntrar });
        await users.ResetAccessFailedCountAsync(user);
        await signIn.SignInAsync(user, isPersistent: false, authenticationMethod: "passkey");
        return Ok(new UsuarioDto(user.NomeCompleto, user.Email!, await users.HasPasswordAsync(user)));
    }
}
