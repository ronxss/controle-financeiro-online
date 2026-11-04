using ControleFinanceiro.Data;
using ControleFinanceiro.Dtos;
using ControleFinanceiro.Models;
using ControleFinanceiro.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace ControleFinanceiro.Controllers;

/// <summary>Aba "Resumo" da planilha. Realizado = apenas lançamentos com status Pago/Recebido.</summary>
[Route("api/resumo")]
public class ResumoController(AppDbContext db, Relogio relogio) : ApiBase
{
    [HttpGet]
    public async Task<IActionResult> Obter([FromQuery] string? mes)
    {
        if (!Periodo.TentarObter(mes, relogio.Hoje, out var inicio, out var fim))
            return Erro("Mês inválido. Use o formato AAAA-MM.");

        var userId = UserId;
        var doMes = db.Lancamentos.AsNoTracking()
            .Where(l => l.UserId == userId && l.Data >= inicio && l.Data < fim);

        var totais = await doMes
            .GroupBy(l => new { l.Tipo, l.Status })
            .Select(g => new { g.Key.Tipo, g.Key.Status, Total = g.Sum(x => x.Valor) })
            .ToListAsync();

        decimal Soma(TipoLancamento t, StatusLancamento s) =>
            totais.Where(x => x.Tipo == t && x.Status == s).Sum(x => x.Total);

        var recebidas = Soma(TipoLancamento.Receita, StatusLancamento.PagoRecebido);
        var pagas = Soma(TipoLancamento.Despesa, StatusLancamento.PagoRecebido);
        var recPend = Soma(TipoLancamento.Receita, StatusLancamento.Pendente);
        var despPend = Soma(TipoLancamento.Despesa, StatusLancamento.Pendente);

        var gastos = await doMes
            .Where(l => l.Tipo == TipoLancamento.Despesa && l.Status == StatusLancamento.PagoRecebido)
            .GroupBy(l => l.CategoriaId)
            .Select(g => new { CategoriaId = g.Key, Total = g.Sum(x => x.Valor) })
            .ToDictionaryAsync(x => x.CategoriaId, x => x.Total);

        var categorias = await db.Categorias.AsNoTracking()
            .Where(c => c.UserId == userId && c.Tipo == TipoLancamento.Despesa)
            .Select(c => new { c.Id, c.Nome })
            .ToListAsync();

        var porCategoria = categorias
            .Select(c => new DespesaCategoriaDto(c.Nome, gastos.GetValueOrDefault(c.Id)))
            .OrderByDescending(x => x.Realizado).ThenBy(x => x.Categoria)
            .ToList();

        return Ok(new ResumoDto(recebidas, pagas, recebidas - pagas, recPend, despPend,
            recebidas - pagas + recPend - despPend, porCategoria));
    }
}

/// <summary>Aba "Orçamento" da planilha: limite mensal por categoria x realizado do mês.</summary>
[Route("api/orcamento")]
public class OrcamentoController(AppDbContext db, Relogio relogio) : ApiBase
{
    [HttpGet]
    public async Task<IActionResult> Obter([FromQuery] string? mes)
    {
        if (!Periodo.TentarObter(mes, relogio.Hoje, out var inicio, out var fim))
            return Erro("Mês inválido. Use o formato AAAA-MM.");

        var userId = UserId;
        var gastos = await db.Lancamentos.AsNoTracking()
            .Where(l => l.UserId == userId && l.Tipo == TipoLancamento.Despesa
                        && l.Status == StatusLancamento.PagoRecebido && l.Data >= inicio && l.Data < fim)
            .GroupBy(l => l.CategoriaId)
            .Select(g => new { CategoriaId = g.Key, Total = g.Sum(x => x.Valor) })
            .ToDictionaryAsync(x => x.CategoriaId, x => x.Total);

        var categorias = await db.Categorias.AsNoTracking()
            .Where(c => c.UserId == userId && c.Tipo == TipoLancamento.Despesa)
            .OrderBy(c => c.Nome)
            .ToListAsync();

        var itens = categorias.Select(c =>
        {
            var limite = c.LimiteMensal ?? 0;
            var realizado = gastos.GetValueOrDefault(c.Id);
            var pct = limite == 0 ? 0 : Math.Round(realizado / limite * 100, 1);
            return new OrcamentoItemDto(c.Id, c.Nome, limite, realizado, limite - realizado, pct);
        }).ToList();

        return Ok(itens);
    }

    /// <summary>Salva os limites de várias categorias de uma vez.</summary>
    [HttpPut]
    public async Task<IActionResult> Salvar(List<LimiteRequest> limites)
    {
        var userId = UserId;
        var ids = limites.Select(l => l.CategoriaId!.Value).ToList();
        var categorias = await db.Categorias
            .Where(c => c.UserId == userId && c.Tipo == TipoLancamento.Despesa && ids.Contains(c.Id))
            .ToListAsync();

        foreach (var c in categorias)
            c.LimiteMensal = Math.Round(limites.First(l => l.CategoriaId == c.Id).Limite ?? 0, 2);

        await db.SaveChangesAsync();
        return NoContent();
    }
}
