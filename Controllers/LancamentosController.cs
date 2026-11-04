using ControleFinanceiro.Data;
using ControleFinanceiro.Dtos;
using ControleFinanceiro.Models;
using ControleFinanceiro.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Microsoft.EntityFrameworkCore;
using static ControleFinanceiro.Services.Regras;

namespace ControleFinanceiro.Controllers;

[Route("api/lancamentos")]
public class LancamentosController(AppDbContext db, Relogio relogio) : ApiBase
{
    private const string MsgParcelaFixa = "Um lançamento parcelado não pode ser fixo.";

    [HttpGet]
    public async Task<IActionResult> Listar(
        [FromQuery] string? mes, [FromQuery] TipoLancamento? tipo, [FromQuery] int? categoriaId,
        [FromQuery] int? contaId, [FromQuery] StatusLancamento? status, [FromQuery] string? busca, [FromQuery] string? fixa)
    {
        if (!TentarLerMes(mes, relogio.Hoje, out var m)) return Erro(MsgMesInvalido);
        if (!string.IsNullOrEmpty(fixa) && fixa is not ("true" or "false"))
            return Erro("Valor de \"fixa\" inválido. Use true ou false.");

        var inicio = DiaDoMes(m, 1);
        var fim = inicio.AddMonths(1);
        var userId = UserId;
        var q = db.Lancamentos.AsNoTracking()
            .Where(l => l.UserId == userId && l.Data >= inicio && l.Data < fim);

        if (tipo.HasValue) q = q.Where(l => l.Tipo == tipo.Value);
        if (categoriaId.HasValue) q = q.Where(l => l.CategoriaId == categoriaId.Value);
        if (contaId.HasValue) q = q.Where(l => l.ContaId == contaId.Value);
        if (status.HasValue) q = q.Where(l => l.Status == status.Value);
        if (!string.IsNullOrEmpty(fixa)) { var f = fixa == "true"; q = q.Where(l => l.Fixa == f); }
        if (!string.IsNullOrWhiteSpace(busca))
        {
            var termo = busca.Trim();
            q = q.Where(l => l.Descricao.Contains(termo));
        }

        var itens = await q
            .OrderByDescending(l => l.Data).ThenByDescending(l => l.Id)
            .Select(l => new
            {
                l.Id, l.Data, l.Tipo, l.CategoriaId, Categoria = l.Categoria.Nome, l.Descricao, l.ContaId, Conta = l.Conta.Nome,
                l.Valor, l.Status, l.Fixa, l.ParcelaGrupo, l.ParcelaNumero, l.ParcelaTotal,
                l.Conta.CartaoFechamento, l.Conta.CartaoVencimento,
            })
            .ToListAsync();

        return Ok(itens.Select(l => new LancamentoDto(l.Id, l.Data, l.Tipo, l.CategoriaId, l.Categoria, l.Descricao, l.ContaId,
            l.Conta, l.Valor, l.Status, l.Fixa,
            l.ParcelaGrupo.HasValue ? new ParcelaDto(l.ParcelaGrupo.Value, l.ParcelaNumero!.Value, l.ParcelaTotal!.Value) : null,
            l.CartaoFechamento.HasValue && l.CartaoVencimento.HasValue
                ? FaturaDaCompra(l.CartaoFechamento.Value, l.CartaoVencimento.Value, l.Data).Mes : null)));
    }

    [HttpPost]
    public async Task<IActionResult> Criar(LancamentoRequest req)
    {
        var erro = await ValidarAsync(req);
        if (erro is not null) return Erro(erro);

        var n = req.Parcelas ?? 1;
        if (n < 1 || n > MaxParcelas) return Erro($"Informe de 1 a {MaxParcelas} parcelas.");

        if (n == 1)
        {
            var l = new Lancamento { UserId = UserId };
            Aplicar(l, req);
            l.Fixa = req.Fixa ?? false;
            db.Lancamentos.Add(l);
            await db.SaveChangesAsync();
            return Ok(new { l.Id });
        }

        if (req.Fixa == true) return Erro(MsgParcelaFixa);
        var totalCentavos = Centavos(Math.Round(req.Valor, 2));
        if (totalCentavos < n) return Erro("O valor total é pequeno demais para tantas parcelas.");

        // O valor informado é o TOTAL. Divide em centavos; a diferença do arredondamento fica na 1ª parcela.
        var baseCentavos = totalCentavos / n;
        var resto = totalCentavos - baseCentavos * n;
        var data = req.Data!.Value;
        var mesInicial = MesDe(data);
        var parcelas = new List<Lancamento>();
        var criadoEm = DateTime.UtcNow;

        // Com EnableRetryOnFailure, a transação precisa rodar dentro da estratégia de execução do EF.
        await db.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
        {
            parcelas.Clear();
            await using var tx = await db.Database.BeginTransactionAsync();
            for (var k = 0; k < n; k++)
            {
                var l = new Lancamento { UserId = UserId, CriadoEm = criadoEm };
                Aplicar(l, req);
                l.Data = DiaDoMes(SomarMeses(mesInicial, k), data.Day);
                l.Valor = Reais(baseCentavos + (k == n - 1 ? resto : 0)); // MUTAÇÃO PROPOSITAL: resto na última parcela
                l.Status = k == 0 ? req.Status!.Value : StatusLancamento.Pendente;
                l.Fixa = false;
                l.ParcelaNumero = k + 1;
                l.ParcelaTotal = n;
                l.ParcelaGrupo = 1; // provisório: o grupo é o Id da 1ª parcela, que só existe depois de gravar
                parcelas.Add(l);
            }
            db.Lancamentos.AddRange(parcelas);
            await db.SaveChangesAsync();
            var grupo = parcelas.Min(p => p.Id);
            foreach (var p in parcelas) p.ParcelaGrupo = grupo;
            await db.SaveChangesAsync();
            await tx.CommitAsync();
        });

        var ids = parcelas.OrderBy(p => p.ParcelaNumero).Select(p => p.Id).ToList();
        return Ok(new { id = ids[0], ids, parcelas = n });
    }

    [HttpPut("{id:int}")]
    public async Task<IActionResult> Atualizar(int id, LancamentoRequest req)
    {
        var userId = UserId;
        var l = await db.Lancamentos.FirstOrDefaultAsync(x => x.Id == id && x.UserId == userId);
        if (l is null) return NaoEncontrado();

        var erro = await ValidarAsync(req);
        if (erro is not null) return Erro(erro);

        var fixa = req.Fixa ?? l.Fixa; // cliente que não manda "fixa" não apaga a marcação
        if (l.ParcelaGrupo.HasValue && fixa) return Erro(MsgParcelaFixa);

        Aplicar(l, req); // a parcela (1/10...) não muda ao editar: cada parcela é editada sozinha
        l.Fixa = fixa;
        await db.SaveChangesAsync();
        return NoContent();
    }

    /// <summary>Alterna rapidamente entre Pendente e Pago/Recebido.</summary>
    [HttpPatch("{id:int}/status")]
    public async Task<IActionResult> AlterarStatus(int id, StatusRequest req)
    {
        var userId = UserId;
        var l = await db.Lancamentos.FirstOrDefaultAsync(x => x.Id == id && x.UserId == userId);
        if (l is null) return NaoEncontrado();

        l.Status = req.Status!.Value;
        await db.SaveChangesAsync();
        return NoContent();
    }

    /// <summary>Marca ou desmarca como fixo (receita ou despesa que se repete todo mês).</summary>
    [HttpPatch("{id:int}/fixa")]
    public async Task<IActionResult> AlterarFixa(int id, [FromBody(EmptyBodyBehavior = EmptyBodyBehavior.Allow)] FixaRequest? req)
    {
        if (req?.Fixa is not bool fixa) return Erro("Informe se o lançamento é fixo (true ou false).");
        var userId = UserId;
        var l = await db.Lancamentos.FirstOrDefaultAsync(x => x.Id == id && x.UserId == userId);
        if (l is null) return NaoEncontrado();
        if (l.ParcelaGrupo.HasValue && fixa) return Erro(MsgParcelaFixa);

        l.Fixa = fixa;
        await db.SaveChangesAsync();
        return NoContent();
    }

    /// <summary>?parcelas=seguintes (esta e as próximas) | todas. Sem o parâmetro, só esta.</summary>
    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Excluir(int id, [FromQuery] string? parcelas)
    {
        var userId = UserId;
        var l = await db.Lancamentos.FirstOrDefaultAsync(x => x.Id == id && x.UserId == userId);
        if (l is null) return NaoEncontrado();

        if (parcelas is not null && parcelas is not ("seguintes" or "todas"))
            return Erro("Valor de \"parcelas\" inválido. Use seguintes ou todas.");

        if (parcelas is null)
        {
            db.Lancamentos.Remove(l);
            await db.SaveChangesAsync();
            return NoContent();
        }

        var remover = new List<Lancamento> { l };
        if (l.ParcelaGrupo is int grupo)
        {
            var numero = l.ParcelaNumero!.Value;
            remover = await db.Lancamentos
                .Where(x => x.UserId == userId && (x.Id == id ||
                    (x.ParcelaGrupo == grupo && (parcelas == "todas" || x.ParcelaNumero >= numero))))
                .ToListAsync();
        }
        db.Lancamentos.RemoveRange(remover);
        await db.SaveChangesAsync();
        return Ok(new { removidos = remover.Count });
    }

    private static void Aplicar(Lancamento l, LancamentoRequest r)
    {
        l.Data = r.Data!.Value;
        l.Tipo = r.Tipo!.Value;
        l.CategoriaId = r.CategoriaId!.Value;
        l.Descricao = r.Descricao.Trim();
        l.ContaId = r.ContaId!.Value;
        l.Valor = Math.Round(r.Valor, 2);
        l.Status = r.Status!.Value;
    }

    /// <summary>Garante que categoria e conta pertencem ao usuário e que a categoria combina com o tipo.</summary>
    private async Task<string?> ValidarAsync(LancamentoRequest r)
    {
        if (string.IsNullOrWhiteSpace(r.Descricao)) return "Informe a descrição.";
        var userId = UserId;
        var categoriaId = r.CategoriaId!.Value;
        var contaId = r.ContaId!.Value;

        var cat = await db.Categorias.AsNoTracking()
            .FirstOrDefaultAsync(c => c.Id == categoriaId && c.UserId == userId);
        if (cat is null) return "Categoria inválida.";
        if (cat.Tipo != r.Tipo) return "A categoria selecionada não corresponde ao tipo do lançamento.";

        var contaOk = await db.Contas.AnyAsync(c => c.Id == contaId && c.UserId == userId);
        if (!contaOk) return "Conta inválida.";

        return null;
    }
}

/// <summary>
/// POST /api/lancamentos-fixos/copiar { mes, origem? } (também /api/despesas-fixas/copiar)
/// Recria, no mês `mes`, as receitas e despesas fixas do mês `origem` (padrão: o anterior) como PENDENTES, no mesmo dia
/// (ou no último dia do mês, se ele for menor). Não duplica o que já existe (mesmo tipo, descrição, categoria e conta).
/// </summary>
[Route("api")]
public class LancamentosFixosController(AppDbContext db, Relogio relogio) : ApiBase
{
    [HttpPost("lancamentos-fixos/copiar"), HttpPost("despesas-fixas/copiar")]
    public async Task<IActionResult> Copiar([FromBody(EmptyBodyBehavior = EmptyBodyBehavior.Allow)] CopiarFixasRequest? req)
    {
        var hoje = relogio.Hoje;
        if (!TentarLerMes(req?.Mes, hoje, out var mes)) return Erro(MsgMesInvalido);
        string origem;
        if (string.IsNullOrEmpty(req?.Origem)) origem = SomarMeses(mes, -1);
        else if (!TentarLerMes(req.Origem, hoje, out origem)) return Erro(MsgMesInvalido);
        if (origem == mes) return Erro("O mês de origem deve ser diferente do mês de destino.");

        var userId = UserId;
        var deOrigem = DiaDoMes(origem, 1);
        var deDestino = DiaDoMes(mes, 1);
        var fixas = await db.Lancamentos.AsNoTracking()
            .Where(l => l.UserId == userId && l.Fixa && l.Data >= deOrigem && l.Data < deOrigem.AddMonths(1))
            .OrderBy(l => l.Id).ToListAsync();
        var noDestino = await db.Lancamentos.AsNoTracking()
            .Where(l => l.UserId == userId && l.Data >= deDestino && l.Data < deDestino.AddMonths(1))
            .Select(l => new { l.Tipo, l.Descricao, l.CategoriaId, l.ContaId }).ToListAsync();

        var existentes = noDestino.GroupBy(l => Calculos.ChaveFixa(l.Tipo, l.Descricao, l.CategoriaId, l.ContaId))
            .ToDictionary(g => g.Key, g => g.Count());
        int criadas = 0, ignoradas = 0, receitas = 0, despesas = 0;
        foreach (var f in fixas)
        {
            var k = Calculos.ChaveFixa(f.Tipo, f.Descricao, f.CategoriaId, f.ContaId);
            if (existentes.GetValueOrDefault(k) > 0) { existentes[k]--; ignoradas++; continue; }
            db.Lancamentos.Add(new Lancamento
            {
                UserId = userId, Data = DiaDoMes(mes, f.Data.Day), Tipo = f.Tipo, CategoriaId = f.CategoriaId,
                Descricao = f.Descricao, ContaId = f.ContaId, Valor = f.Valor, Status = StatusLancamento.Pendente, Fixa = true,
            });
            criadas++;
            if (f.Tipo == TipoLancamento.Receita) receitas++; else despesas++;
        }
        if (criadas > 0) await db.SaveChangesAsync();
        return Ok(new { mes, origem, encontradas = fixas.Count, criadas, ignoradas, receitasCriadas = receitas, despesasCriadas = despesas });
    }
}
