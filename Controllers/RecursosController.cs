using ControleFinanceiro.Data;
using ControleFinanceiro.Dtos;
using ControleFinanceiro.Models;
using ControleFinanceiro.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Microsoft.EntityFrameworkCore;
using static ControleFinanceiro.Services.Regras;

namespace ControleFinanceiro.Controllers;

/// <summary>GET /api/dashboard?mes=aaaa-mm — métricas da tela Resumo (orçamento, fixas, evolução, ritmo...).</summary>
[Route("api/dashboard")]
public class PainelController(AppDbContext db, Relogio relogio) : ApiBase
{
    [HttpGet]
    public async Task<IActionResult> Obter([FromQuery] string? mes)
    {
        var hoje = relogio.Hoje;
        if (!TentarLerMes(mes, hoje, out var m)) return Erro(MsgMesInvalido);
        return Ok(Calculos.Painel(await Dados.CarregarAsync(db, UserId), m, hoje));
    }
}

/// <summary>Faturas dos cartões de crédito.</summary>
[Route("api/cartoes")]
public class CartoesController(AppDbContext db, Relogio relogio) : ApiBase
{
    /// <summary>Faturas que VENCEM no mês, uma por cartão.</summary>
    [HttpGet]
    public async Task<IActionResult> Listar([FromQuery] string? mes)
    {
        var hoje = relogio.Hoje;
        if (!TentarLerMes(mes, hoje, out var m)) return Erro(MsgMesInvalido);
        var d = await Dados.CarregarAsync(db, UserId);
        return Ok(d.Contas.Where(c => c.EhCartao).OrderBy(c => c.Nome, PorTexto)
            .Select(c => Calculos.ResumoFatura(d, c, m, hoje)).ToList());
    }

    /// <summary>Marca como pagos todos os lançamentos pendentes da fatura.</summary>
    [HttpPost("{id:int}/pagar")]
    public async Task<IActionResult> Pagar(int id, [FromBody(EmptyBodyBehavior = EmptyBodyBehavior.Allow)] PagarFaturaRequest? req)
    {
        var userId = UserId;
        var hoje = relogio.Hoje;
        var conta = await db.Contas.AsNoTracking().FirstOrDefaultAsync(c => c.Id == id && c.UserId == userId);
        if (conta is null) return NaoEncontrado();
        if (!conta.EhCartao) return Erro("Esta conta não é um cartão de crédito.");
        if (!TentarLerMes(req?.Mes, hoje, out var mes)) return Erro(MsgMesInvalido);

        var pendentes = await db.Lancamentos.Where(l => l.UserId == userId && l.ContaId == id && l.Status == StatusLancamento.Pendente).ToListAsync();
        var pagos = 0;
        foreach (var l in pendentes)
        {
            if (FaturaDaCompra(conta.CartaoFechamento!.Value, conta.CartaoVencimento!.Value, l.Data).Mes != mes) continue;
            l.Status = StatusLancamento.PagoRecebido;
            pagos++;
        }
        if (pagos > 0) await db.SaveChangesAsync();

        var d = await Dados.CarregarAsync(db, userId);
        return Ok(new { pagos, fatura = Calculos.ResumoFatura(d, d.Conta(id)!, mes, hoje) });
    }
}

/// <summary>Metas de economia: os depósitos e retiradas ficam na meta e não criam lançamentos.</summary>
[Route("api/metas")]
public class MetasController(AppDbContext db, Relogio relogio) : ApiBase
{
    [HttpGet]
    public async Task<IActionResult> Listar()
    {
        var d = await Dados.CarregarAsync(db, UserId, comMetas: true);
        var hoje = relogio.Hoje;
        return Ok(d.Metas.Select(m => Calculos.DtoMeta(m, hoje, relogio))
            .OrderBy(m => Calculos.OrdemDaSituacao(m.Situacao)).ThenBy(m => m.Nome, PorTexto).ToList());
    }

    private static string? Ler(MetaRequest? r, out string nome, out decimal alvo, out DateOnly? prazo)
    {
        nome = (r?.Nome ?? "").Trim();
        alvo = 0;
        prazo = null;
        if (nome.Length == 0) return "Informe o nome da meta.";
        if (nome.Length > 60) return "O nome deve ter no máximo 60 caracteres.";
        var c = r?.Alvo is decimal a ? Centavos(a) : 0;
        if (c < 1 || c > LimiteMaximoCentavos) return "Informe um valor-alvo maior que zero.";
        alvo = Reais(c);
        if (!string.IsNullOrEmpty(r?.Prazo))
        {
            if (!TentarLerData(r.Prazo, out var p)) return "Prazo inválido.";
            prazo = p;
        }
        return null;
    }

    private async Task<IActionResult> Responder(int id)
    {
        var d = await Dados.CarregarAsync(db, UserId, comMetas: true);
        return Ok(Calculos.DtoMeta(d.Metas.First(m => m.Id == id), relogio.Hoje, relogio));
    }

    [HttpPost]
    public async Task<IActionResult> Criar([FromBody(EmptyBodyBehavior = EmptyBodyBehavior.Allow)] MetaRequest? req)
    {
        if (Ler(req, out var nome, out var alvo, out var prazo) is string erro) return Erro(erro);
        var userId = UserId;
        if ((await db.Metas.Where(m => m.UserId == userId).Select(m => m.Nome).ToListAsync()).Any(n => MesmoNome(n, nome)))
            return Conflito("Já existe uma meta com esse nome.");
        var m = new Meta { UserId = userId, Nome = nome, Alvo = alvo, Prazo = prazo };
        db.Metas.Add(m);
        await db.SaveChangesAsync();
        return await Responder(m.Id);
    }

    [HttpPut("{id:int}")]
    public async Task<IActionResult> Atualizar(int id, [FromBody(EmptyBodyBehavior = EmptyBodyBehavior.Allow)] MetaRequest? req)
    {
        var userId = UserId;
        var m = await db.Metas.FirstOrDefaultAsync(x => x.Id == id && x.UserId == userId);
        if (m is null) return NaoEncontrado();
        if (Ler(req, out var nome, out var alvo, out var prazo) is string erro) return Erro(erro);
        if ((await db.Metas.Where(x => x.UserId == userId && x.Id != id).Select(x => x.Nome).ToListAsync()).Any(n => MesmoNome(n, nome)))
            return Conflito("Já existe uma meta com esse nome.");
        m.Nome = nome;
        m.Alvo = alvo;
        m.Prazo = prazo;
        await db.SaveChangesAsync();
        return await Responder(id);
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Excluir(int id)
    {
        var userId = UserId;
        var m = await db.Metas.FirstOrDefaultAsync(x => x.Id == id && x.UserId == userId);
        if (m is null) return NaoEncontrado();
        db.Metas.Remove(m);
        await db.SaveChangesAsync();
        return NoContent();
    }

    [HttpPost("{id:int}/aportes")]
    public async Task<IActionResult> Aportar(int id, [FromBody(EmptyBodyBehavior = EmptyBodyBehavior.Allow)] AporteRequest? req)
    {
        var userId = UserId;
        var m = await db.Metas.Include(x => x.Aportes).FirstOrDefaultAsync(x => x.Id == id && x.UserId == userId);
        if (m is null) return NaoEncontrado();

        var centavos = req?.Valor is decimal v ? Centavos(v) : 0;
        if (centavos < 1 || centavos > LimiteMaximoCentavos) return Erro("O valor deve ser maior que zero.");
        var data = relogio.Hoje;
        if (req?.Data is not null && !TentarLerData(req.Data, out data)) return Erro("Data inválida.");
        var nota = (req?.Nota ?? "").Trim();
        if (nota.Length > 100) return Erro("A observação deve ter no máximo 100 caracteres.");
        var guardado = m.Aportes.Sum(a => Centavos(a.Valor));
        var retirada = req?.Retirada == true;
        if (retirada && centavos > guardado) return Erro("A retirada é maior que o valor guardado na meta.");

        m.Aportes.Add(new Aporte { Data = data, Valor = Reais(retirada ? -centavos : centavos), Nota = nota });
        await db.SaveChangesAsync();
        return await Responder(id);
    }
}

[Route("api/aportes")]
public class AportesController(AppDbContext db) : ApiBase
{
    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Excluir(int id)
    {
        var userId = UserId;
        var a = await db.Aportes.Include(x => x.Meta).ThenInclude(m => m.Aportes)
            .FirstOrDefaultAsync(x => x.Id == id && x.Meta.UserId == userId);
        if (a is null) return NaoEncontrado();
        var restante = a.Meta.Aportes.Where(x => x.Id != id).Sum(x => Centavos(x.Valor));
        if (restante < 0)
            return Erro("Excluir este depósito deixaria a meta com saldo negativo. Exclua antes a retirada.");
        db.Aportes.Remove(a);
        await db.SaveChangesAsync();
        return NoContent();
    }
}

/// <summary>Preferências (lembretes e backup), avisos de vencimento e registro do último backup.</summary>
[Route("api")]
public class PreferenciasController(AppDbContext db, Relogio relogio) : ApiBase
{
    private async Task<PreferenciasUsuario> PrefsAsync()
    {
        var userId = UserId;
        var p = await db.Preferencias.FirstOrDefaultAsync(x => x.UserId == userId);
        if (p is null)
        {
            p = new PreferenciasUsuario { UserId = userId };
            db.Preferencias.Add(p);
        }
        return p;
    }

    [HttpGet("config")]
    public async Task<IActionResult> Obter() => Ok(Calculos.Config(await PrefsAsync()));

    [HttpPut("config")]
    public async Task<IActionResult> Salvar([FromBody(EmptyBodyBehavior = EmptyBodyBehavior.Allow)] ConfigRequest? req)
    {
        var l = req?.Lembretes;
        if (l?.DiasAntes is int d && !Antecedencias.Contains(d)) return Erro("Valor inválido para \"diasAntes\".");
        if (l?.Hora is int h && h is < 0 or > 23) return Erro("Valor inválido para \"hora\".");

        var p = await PrefsAsync();
        if (l?.Ativo is bool a) p.LembretesAtivo = a;
        if (l?.DiasAntes is int dd) p.LembretesDiasAntes = dd;
        if (l?.Hora is int hh) p.LembretesHora = hh;
        if (l?.Detalhes is bool det) p.LembretesDetalhes = det;
        if (req?.Backup?.Automatico is bool auto) p.BackupAutomatico = auto; // as datas só mudam por /api/backup/registrar
        await db.SaveChangesAsync();
        return Ok(Calculos.Config(p));
    }

    [HttpPost("backup/registrar")]
    public async Task<IActionResult> RegistrarBackup([FromBody(EmptyBodyBehavior = EmptyBodyBehavior.Allow)] RegistrarBackupRequest? req)
    {
        var p = await PrefsAsync();
        if (req?.Automatico == true) p.UltimoBackupAutomatico = relogio.AgoraUtc;
        else p.UltimoBackup = relogio.AgoraUtc;
        await db.SaveChangesAsync();
        return Ok(new { automatico = p.BackupAutomatico, ultimo = Calculos.Instante(p.UltimoBackup), ultimoAutomatico = Calculos.Instante(p.UltimoBackupAutomatico) });
    }

    /// <summary>Pendentes atrasados e os que vencem nos próximos `dias` dias (faturas de cartão pelo vencimento).</summary>
    [HttpGet("lembretes")]
    public async Task<IActionResult> Lembretes([FromQuery] string? dias)
    {
        var n = 7;
        if (dias is not null && (!System.Text.RegularExpressions.Regex.IsMatch(dias, @"^\d{1,2}$") || (n = int.Parse(dias, Inv)) > 60))
            return Erro("Valor de \"dias\" inválido. Use de 0 a 60.");
        var d = await Dados.CarregarAsync(db, UserId);
        return Ok(Calculos.Lembretes(d, n, relogio.Hoje, relogio));
    }

    /// <summary>Planilha CSV dos lançamentos (Excel em português). `de`/`ate` em aaaa-mm-dd, opcionais.</summary>
    [HttpGet("exportar/csv")]
    public async Task<IActionResult> Csv([FromQuery] string? de, [FromQuery] string? ate)
    {
        DateOnly? inicio = null, fim = null;
        if (!string.IsNullOrEmpty(de)) { if (!TentarLerData(de, out var x)) return Erro("Data inválida."); inicio = x; }
        if (!string.IsNullOrEmpty(ate)) { if (!TentarLerData(ate, out var y)) return Erro("Data inválida."); fim = y; }
        var (texto, quantidade) = Calculos.GerarCsv(await Dados.CarregarAsync(db, UserId), inicio, fim);
        Response.Headers["X-Quantidade"] = quantidade.ToString(Inv);
        return File(System.Text.Encoding.UTF8.GetBytes(texto), "text/csv; charset=utf-8", "controle-financeiro.csv");
    }
}
