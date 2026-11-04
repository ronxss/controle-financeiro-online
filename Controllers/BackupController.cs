using System.Text.Json;
using System.Text.Json.Serialization;
using ControleFinanceiro.Data;
using ControleFinanceiro.Models;
using ControleFinanceiro.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using static ControleFinanceiro.Services.Regras;

namespace ControleFinanceiro.Controllers;

// Formato do arquivo de backup — o MESMO do app local (engine.js: montarBackup / lerBackup / validarEstado).
// Assim dá para levar os dados do celular para a conta online e vice-versa.

public class ArquivoBackup
{
    public string? App { get; set; }
    public string? ExportadoEm { get; set; }
    public EstadoBackup? Dados { get; set; }
}

public class EstadoBackup
{
    public int? Versao { get; set; }
    public SeqBackup? Seq { get; set; }
    public List<CategoriaBackup>? Categorias { get; set; }
    public List<ContaBackup>? Contas { get; set; }
    public List<LancamentoBackup>? Lancamentos { get; set; }
    public List<MetaBackup>? Metas { get; set; }
    public JsonElement? Config { get; set; }
}

public class SeqBackup { public int? Categoria { get; set; } public int? Conta { get; set; } public int? Lancamento { get; set; } public int? Meta { get; set; } public int? Aporte { get; set; } }
public class CategoriaBackup { public int? Id { get; set; } public string? Nome { get; set; } public string? Tipo { get; set; } public long? LimiteCentavos { get; set; } }
public class CartaoBackup { public int? Fechamento { get; set; } public int? Vencimento { get; set; } }
public class ContaBackup { public int? Id { get; set; } public string? Nome { get; set; } public CartaoBackup? Cartao { get; set; } }
public class ParcelaBackup { public int? Grupo { get; set; } public int? Numero { get; set; } public int? Total { get; set; } }
public class LancamentoBackup
{
    public int? Id { get; set; } public string? Data { get; set; } public string? Tipo { get; set; } public int? CategoriaId { get; set; }
    public string? Descricao { get; set; } public int? ContaId { get; set; } public long? ValorCentavos { get; set; } public string? Status { get; set; }
    public string? CriadoEm { get; set; } public bool? Fixa { get; set; } public ParcelaBackup? Parcela { get; set; }
}
public class AporteBackup { public int? Id { get; set; } public string? Data { get; set; } public long? ValorCentavos { get; set; } public string? Nota { get; set; } }
public class MetaBackup
{
    public int? Id { get; set; } public string? Nome { get; set; } public long? AlvoCentavos { get; set; } public string? Prazo { get; set; }
    public string? CriadoEm { get; set; } public List<AporteBackup>? Aportes { get; set; }
}

[Route("api/backup")]
public class BackupController(AppDbContext db, Relogio relogio) : ApiBase
{
    private const string NomeApp = "controle-financeiro";
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        WriteIndented = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.Never,
    };

    /// <summary>Exporta todos os dados da conta no formato do arquivo de backup.</summary>
    [HttpGet]
    public async Task<IActionResult> Exportar()
    {
        var d = await Dados.CarregarAsync(db, UserId, comMetas: true);
        var p = d.Prefs;
        var estado = new
        {
            versao = 1,
            seq = new
            {
                categoria = d.Categorias.Select(c => c.Id).DefaultIfEmpty(0).Max(),
                conta = d.Contas.Select(c => c.Id).DefaultIfEmpty(0).Max(),
                lancamento = d.Lancamentos.Select(c => c.Id).DefaultIfEmpty(0).Max(),
                meta = d.Metas.Select(c => c.Id).DefaultIfEmpty(0).Max(),
                aporte = d.Metas.SelectMany(m => m.Aportes).Select(a => a.Id).DefaultIfEmpty(0).Max(),
            },
            categorias = d.Categorias.Select(c => new { id = c.Id, nome = c.Nome, tipo = c.Tipo.ToString(), limiteCentavos = c.LimiteCentavos }),
            contas = d.Contas.Select(c => new
            {
                id = c.Id, nome = c.Nome,
                cartao = c.EhCartao ? new { fechamento = c.Fechamento!.Value, vencimento = c.Vencimento!.Value } : null,
            }),
            lancamentos = d.Lancamentos.Select(l => new
            {
                id = l.Id, data = Iso(l.Data), tipo = l.Tipo.ToString(), categoriaId = l.CategoriaId, descricao = l.Descricao,
                contaId = l.ContaId, valorCentavos = l.ValorCentavos, status = l.Status.ToString(), criadoEm = Calculos.Instante(l.CriadoEm),
                fixa = l.Fixa,
                parcela = l.Grupo.HasValue ? new { grupo = l.Grupo.Value, numero = l.Numero!.Value, total = l.Total!.Value } : null,
            }),
            metas = d.Metas.Select(m => new
            {
                id = m.Id, nome = m.Nome, alvoCentavos = m.AlvoCentavos, prazo = m.Prazo is null ? null : Iso(m.Prazo.Value),
                criadoEm = Calculos.Instante(m.CriadoEm),
                aportes = m.Aportes.Select(a => new { id = a.Id, data = Iso(a.Data), valorCentavos = a.ValorCentavos, nota = a.Nota }),
            }),
            config = Calculos.Config(p),
        };
        var texto = JsonSerializer.Serialize(new { app = NomeApp, exportadoEm = Calculos.Instante(relogio.AgoraUtc), dados = estado }, Json);
        return File(System.Text.Encoding.UTF8.GetBytes(texto), "application/json; charset=utf-8",
            $"controle-financeiro-backup-{Iso(relogio.Hoje)}.json");
    }

    /// <summary>Substitui TODOS os dados da conta pelos do arquivo (mesmas validações do app local).</summary>
    [HttpPost("importar"), RequestSizeLimit(20_000_000)]
    public async Task<IActionResult> Importar()
    {
        ArquivoBackup? arquivo;
        try
        {
            arquivo = await JsonSerializer.DeserializeAsync<ArquivoBackup>(Request.Body, Json);
        }
        catch (JsonException)
        {
            return Erro("Backup inválido: o arquivo não é um JSON válido ou tem campos com formato errado.");
        }
        if (arquivo?.App != NomeApp || arquivo.Dados is null)
            return Erro("Backup inválido: este arquivo não foi gerado pelo Controle Financeiro.");

        var e = arquivo.Dados;
        if (Validar(e) is string erro) return Erro($"Backup inválido: {erro}");

        var userId = UserId;
        var resumo = new { categorias = e.Categorias!.Count, contas = e.Contas!.Count, lancamentos = e.Lancamentos!.Count, metas = e.Metas?.Count ?? 0 };

        await db.Database.CreateExecutionStrategy().ExecuteAsync(async () =>
        {
            db.ChangeTracker.Clear();
            await using var tx = await db.Database.BeginTransactionAsync();

            await db.Aportes.Where(a => a.Meta.UserId == userId).ExecuteDeleteAsync();
            await db.Metas.Where(m => m.UserId == userId).ExecuteDeleteAsync();
            await db.Lancamentos.Where(l => l.UserId == userId).ExecuteDeleteAsync();
            await db.Categorias.Where(c => c.UserId == userId).ExecuteDeleteAsync();
            await db.Contas.Where(c => c.UserId == userId).ExecuteDeleteAsync();

            var cats = e.Categorias!.ToDictionary(c => c.Id!.Value, c => new Categoria
            {
                UserId = userId, Nome = c.Nome!.Trim(), Tipo = Enum.Parse<TipoLancamento>(c.Tipo!),
                LimiteMensal = c.LimiteCentavos is long lc ? Reais(lc) : null,
            });
            var contas = e.Contas!.ToDictionary(c => c.Id!.Value, c =>
            {
                var cartao = c.Cartao is { } k && DiaCartaoValido(k.Fechamento) && DiaCartaoValido(k.Vencimento);
                return new Conta
                {
                    UserId = userId, Nome = c.Nome!.Trim(),
                    CartaoFechamento = cartao ? c.Cartao!.Fechamento : null, CartaoVencimento = cartao ? c.Cartao!.Vencimento : null,
                };
            });
            db.Categorias.AddRange(cats.Values);
            db.Contas.AddRange(contas.Values);
            await db.SaveChangesAsync();

            var lancs = new List<(LancamentoBackup Origem, Lancamento Novo)>();
            foreach (var l in e.Lancamentos!)
            {
                var p = ParcelaValida(l.Parcela);
                var novo = new Lancamento
                {
                    UserId = userId, Data = DateOnly.ParseExact(l.Data!, "yyyy-MM-dd", Inv),
                    Tipo = Enum.Parse<TipoLancamento>(l.Tipo!), CategoriaId = cats[l.CategoriaId!.Value].Id,
                    Descricao = l.Descricao!.Trim(), ContaId = contas[l.ContaId!.Value].Id, Valor = Reais(l.ValorCentavos!.Value),
                    Status = Enum.Parse<StatusLancamento>(l.Status!), Fixa = l.Fixa == true,
                    CriadoEm = DateTime.TryParse(l.CriadoEm, Inv, System.Globalization.DateTimeStyles.AdjustToUniversal, out var ce) ? ce : DateTime.UtcNow,
                    ParcelaGrupo = p is null ? null : 1, ParcelaNumero = p?.Numero, ParcelaTotal = p?.Total,
                };
                lancs.Add((l, novo));
            }
            db.Lancamentos.AddRange(lancs.Select(x => x.Novo));
            await db.SaveChangesAsync();

            // O grupo de uma compra parcelada é o id (novo) do lançamento que era o grupo no arquivo.
            var novoId = lancs.ToDictionary(x => x.Origem.Id!.Value, x => x.Novo.Id);
            foreach (var g in lancs.Where(x => x.Novo.ParcelaNumero.HasValue).GroupBy(x => x.Origem.Parcela!.Grupo!.Value))
                foreach (var (_, novo) in g)
                    novo.ParcelaGrupo = novoId.TryGetValue(g.Key, out var id) ? id : g.Min(x => x.Novo.Id);

            foreach (var m in e.Metas ?? [])
            {
                db.Metas.Add(new Meta
                {
                    UserId = userId, Nome = m.Nome!.Trim(), Alvo = Reais(m.AlvoCentavos!.Value),
                    Prazo = string.IsNullOrEmpty(m.Prazo) ? null : DateOnly.ParseExact(m.Prazo, "yyyy-MM-dd", Inv),
                    CriadoEm = DateTime.TryParse(m.CriadoEm, Inv, System.Globalization.DateTimeStyles.AdjustToUniversal, out var mc) ? mc : DateTime.UtcNow,
                    Aportes = m.Aportes!.Select(a => new Aporte
                    {
                        Data = DateOnly.ParseExact(a.Data!, "yyyy-MM-dd", Inv), Valor = Reais(a.ValorCentavos!.Value),
                        Nota = (a.Nota ?? "").Length > 100 ? a.Nota![..100] : a.Nota ?? "",
                    }).ToList(),
                });
            }

            // Preferências de lembrete vêm do arquivo (o que estiver errado fica no padrão, como no app local).
            var prefs = await db.Preferencias.FirstOrDefaultAsync(x => x.UserId == userId);
            if (prefs is null) { prefs = new PreferenciasUsuario { UserId = userId }; db.Preferencias.Add(prefs); }
            AplicarConfig(prefs, e.Config);

            await db.SaveChangesAsync();
            await tx.CommitAsync();
        });

        return Ok(resumo);
    }

    private static ParcelaBackup? ParcelaValida(ParcelaBackup? p) =>
        p is { Grupo: > 0, Total: >= 2 and <= MaxParcelas, Numero: >= 1 } && p.Numero <= p.Total ? p : null;

    private static void AplicarConfig(PreferenciasUsuario p, JsonElement? config)
    {
        var padrao = new PreferenciasUsuario();
        p.LembretesAtivo = padrao.LembretesAtivo;
        p.LembretesDiasAntes = padrao.LembretesDiasAntes;
        p.LembretesHora = padrao.LembretesHora;
        p.LembretesDetalhes = padrao.LembretesDetalhes;
        p.BackupAutomatico = padrao.BackupAutomatico;
        p.PainelJson = null;
        if (config is not { ValueKind: JsonValueKind.Object } c) return;
        if (c.TryGetProperty("painel", out var painel)) p.PainelJson = GravarPainel(NormalizarPainel(painel));
        if (c.TryGetProperty("lembretes", out var l) && l.ValueKind == JsonValueKind.Object)
        {
            if (l.TryGetProperty("ativo", out var a) && a.ValueKind is JsonValueKind.True or JsonValueKind.False) p.LembretesAtivo = a.GetBoolean();
            if (l.TryGetProperty("diasAntes", out var d) && d.TryGetInt32(out var dd) && Antecedencias.Contains(dd)) p.LembretesDiasAntes = dd;
            if (l.TryGetProperty("hora", out var h) && h.TryGetInt32(out var hh) && hh is >= 0 and <= 23) p.LembretesHora = hh;
            if (l.TryGetProperty("detalhes", out var x) && x.ValueKind is JsonValueKind.True or JsonValueKind.False) p.LembretesDetalhes = x.GetBoolean();
        }
        if (c.TryGetProperty("backup", out var b) && b.ValueKind == JsonValueKind.Object
            && b.TryGetProperty("automatico", out var au) && au.ValueKind is JsonValueKind.True or JsonValueKind.False)
            p.BackupAutomatico = au.GetBoolean();
    }

    /// <summary>Mesmas regras de validarEstado() do motor local. Devolve a mensagem de erro ou null.</summary>
    private static string? Validar(EstadoBackup e)
    {
        if (e.Versao != 1) return $"versão {e.Versao?.ToString(Inv) ?? "undefined"} não é suportada.";
        if (e.Categorias is null || e.Contas is null || e.Lancamentos is null) return "faltam listas de dados.";
        if (e.Seq is null || new[] { e.Seq.Categoria, e.Seq.Conta, e.Seq.Lancamento }.Any(n => n is null or < 0)) return "contadores ausentes.";

        static bool IdsOk(IEnumerable<int?> ids)
        {
            var set = new HashSet<int>();
            return ids.All(id => id is > 0 && set.Add(id.Value));
        }
        var metas = e.Metas ?? [];
        if (!IdsOk(metas.Select(m => m.Id))) return "metas com identificador inválido ou repetido.";
        var idsAporte = new HashSet<int>();
        foreach (var m in metas)
        {
            if (string.IsNullOrWhiteSpace(m.Nome) || m.Nome.Length > 60) return "nome de meta inválido.";
            if (m.AlvoCentavos is null or < 1) return "valor-alvo de meta inválido.";
            if (m.Prazo is not null && !TentarLerData(m.Prazo, out _)) return "prazo de meta inválido.";
            if (m.Aportes is null) return "depósitos de meta inválidos.";
            foreach (var a in m.Aportes)
            {
                if (a?.Id is not > 0 || !idsAporte.Add(a.Id.Value)) return "depósito com identificador inválido ou repetido.";
                if (!TentarLerData(a.Data, out _) || a.ValorCentavos is null or 0) return "depósito de meta inválido.";
            }
        }
        if (!IdsOk(e.Categorias.Select(c => c?.Id))) return "categorias com identificador inválido ou repetido.";
        if (!IdsOk(e.Contas.Select(c => c?.Id))) return "contas com identificador inválido ou repetido.";
        if (!IdsOk(e.Lancamentos.Select(c => c?.Id))) return "lançamentos com identificador inválido ou repetido.";

        string[] tipos = ["Receita", "Despesa"], status = ["Pendente", "PagoRecebido"];
        foreach (var c in e.Categorias)
        {
            if (string.IsNullOrWhiteSpace(c.Nome) || c.Nome.Length > 60) return "nome de categoria inválido.";
            if (!tipos.Contains(c.Tipo)) return "tipo de categoria inválido.";
            if (c.LimiteCentavos is < 0) return "limite de categoria inválido.";
        }
        foreach (var c in e.Contas)
            if (string.IsNullOrWhiteSpace(c.Nome) || c.Nome.Length > 60) return "nome de conta inválido.";

        // O banco exige nomes únicos por usuário (sem diferenciar maiúsculas).
        bool Repetidos(IEnumerable<string?> nomes) =>
            nomes.Select(n => n!.Trim().ToLower(PtBr)).GroupBy(n => n).Any(g => g.Count() > 1);
        if (Repetidos(e.Categorias.Select(c => c.Nome))) return "categorias com nomes repetidos.";
        if (Repetidos(e.Contas.Select(c => c.Nome))) return "contas com nomes repetidos.";
        if (Repetidos(metas.Select(m => m.Nome))) return "metas com nomes repetidos.";

        var tipoPorCategoria = e.Categorias.ToDictionary(c => c.Id!.Value, c => c.Tipo);
        var idsConta = e.Contas.Select(c => c.Id!.Value).ToHashSet();
        foreach (var l in e.Lancamentos)
        {
            if (!TentarLerData(l.Data, out _)) return "data de lançamento inválida.";
            if (!tipos.Contains(l.Tipo) || !status.Contains(l.Status)) return "tipo ou status de lançamento inválido.";
            if (string.IsNullOrWhiteSpace(l.Descricao) || l.Descricao.Length > 200) return "descrição de lançamento inválida.";
            if (l.ValorCentavos is null or < 1 || l.ValorCentavos > LimiteMaximoCentavos) return "valor de lançamento inválido.";
            if (l.CategoriaId is null || !tipoPorCategoria.ContainsKey(l.CategoriaId.Value) || l.ContaId is null || !idsConta.Contains(l.ContaId.Value))
                return "lançamento aponta para categoria ou conta inexistente.";
            if (tipoPorCategoria[l.CategoriaId.Value] != l.Tipo) return "categoria incompatível com o tipo do lançamento.";
        }
        return null;
    }
}
