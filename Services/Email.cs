using System.Threading.Channels;
using MailKit.Net.Smtp;
using MailKit.Security;
using Microsoft.Extensions.Options;
using MimeKit;

namespace ControleFinanceiro.Services;

/// <summary>
/// Configuração do envio de e-mail (seção "Email"). Funciona com qualquer SMTP: Brevo (smtp-relay.brevo.com:587,
/// grátis até 300 e-mails/dia), Resend, Mailjet, Gmail com senha de app...
/// Sem Host, os e-mails não saem: em Development o link aparece no log; com "Pasta" eles viram arquivos (testes).
/// </summary>
public class EmailOptions
{
    public string? Host { get; set; }
    public int Porta { get; set; } = 587;
    public string? Usuario { get; set; }
    public string? Senha { get; set; }
    public string Remetente { get; set; } = "";
    public string NomeRemetente { get; set; } = "Controle Financeiro";
    /// <summary>Só para testes/desenvolvimento: grava cada e-mail como arquivo nesta pasta em vez de enviar.</summary>
    public string? Pasta { get; set; }
}

public record Email(string Para, string Assunto, string Html, string Texto);

/// <summary>
/// Fila de e-mails. A requisição só ENFILEIRA e responde na hora; o envio acontece em segundo plano. Assim o tempo de
/// resposta de "esqueci minha senha" é o mesmo exista ou não a conta (não dá para descobrir quem tem cadastro).
/// </summary>
public class FilaEmails
{
    private readonly Channel<Email> _canal = Channel.CreateBounded<Email>(new BoundedChannelOptions(500)
    {
        FullMode = BoundedChannelFullMode.DropWrite, // sob ataque, descarta em vez de consumir memória
    });

    public bool Enfileirar(Email e) => _canal.Writer.TryWrite(e);
    public IAsyncEnumerable<Email> LerTodos(CancellationToken ct) => _canal.Reader.ReadAllAsync(ct);
}

public class EnviadorEmails(FilaEmails fila, IOptions<EmailOptions> opcoes, IHostEnvironment env, ILogger<EnviadorEmails> logger)
    : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken ct)
    {
        await foreach (var email in fila.LerTodos(ct))
        {
            try
            {
                await EnviarAsync(email, ct);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                // Nunca registra o conteúdo (ele tem o link de troca de senha).
                logger.LogError(ex, "Falha ao enviar e-mail \"{Assunto}\"", email.Assunto);
            }
        }
    }

    private async Task EnviarAsync(Email email, CancellationToken ct)
    {
        var o = opcoes.Value;
        if (!string.IsNullOrWhiteSpace(o.Pasta))
        {
            Directory.CreateDirectory(o.Pasta);
            var nome = $"{DateTime.UtcNow:yyyyMMddHHmmssfff}-{Guid.NewGuid():N}.txt";
            await File.WriteAllTextAsync(Path.Combine(o.Pasta, nome), $"Para: {email.Para}\nAssunto: {email.Assunto}\n\n{email.Texto}", ct);
            return;
        }
        if (string.IsNullOrWhiteSpace(o.Host))
        {
            if (env.IsDevelopment())
                logger.LogWarning("E-mail não configurado. Conteúdo (só em Development):\n{Texto}", email.Texto);
            else
                logger.LogWarning("E-mail não configurado (Email:Host vazio): \"{Assunto}\" não foi enviado.", email.Assunto);
            return;
        }

        var msg = new MimeMessage();
        msg.From.Add(new MailboxAddress(o.NomeRemetente, o.Remetente));
        msg.To.Add(MailboxAddress.Parse(email.Para));
        msg.Subject = email.Assunto;
        msg.Body = new BodyBuilder { HtmlBody = email.Html, TextBody = email.Texto }.ToMessageBody();

        using var smtp = new SmtpClient();
        await smtp.ConnectAsync(o.Host, o.Porta, o.Porta == 465 ? SecureSocketOptions.SslOnConnect : SecureSocketOptions.StartTls, ct);
        if (!string.IsNullOrEmpty(o.Usuario)) await smtp.AuthenticateAsync(o.Usuario, o.Senha, ct);
        await smtp.SendAsync(msg, ct);
        await smtp.DisconnectAsync(true, ct);
    }
}
