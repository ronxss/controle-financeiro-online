using System.Text;
using ControleFinanceiro.Data;
using ControleFinanceiro.Dtos;
using ControleFinanceiro.Models;
using Microsoft.EntityFrameworkCore;
using static ControleFinanceiro.Services.Regras;

namespace ControleFinanceiro.Services;

// Cópia, em memória, dos dados de UM usuário (valores em centavos). As telas de resumo, cartões, metas e lembretes
// precisam cruzar vários meses e tabelas; para um controle financeiro pessoal o volume é pequeno, e calcular em
// memória deixa o código igual ao do motor local (o que os testes de contrato conferem).

public record CatS(int Id, string Nome, TipoLancamento Tipo, long? LimiteCentavos);

public record ContaS(int Id, string Nome, int? Fechamento, int? Vencimento)
{
    public bool EhCartao => Fechamento.HasValue && Vencimento.HasValue;
    public Fatura FaturaDa(DateOnly data) => FaturaDaCompra(Fechamento!.Value, Vencimento!.Value, data);
}

public record LancS(int Id, DateOnly Data, TipoLancamento Tipo, int CategoriaId, string Descricao, int ContaId,
    long ValorCentavos, StatusLancamento Status, bool Fixa, int? Grupo, int? Numero, int? Total, DateTime CriadoEm)
{
    public string Mes => MesDe(Data);
    public bool Pago => Status == StatusLancamento.PagoRecebido;
}

public record AporteS(int Id, DateOnly Data, long ValorCentavos, string Nota);
public record MetaS(int Id, string Nome, long AlvoCentavos, DateOnly? Prazo, DateTime CriadoEm, List<AporteS> Aportes);

public class Dados
{
    public List<CatS> Categorias { get; init; } = [];
    public List<ContaS> Contas { get; init; } = [];
    public List<LancS> Lancamentos { get; init; } = [];
    public List<MetaS> Metas { get; init; } = [];
    public PreferenciasUsuario Prefs { get; init; } = new();

    public static async Task<Dados> CarregarAsync(AppDbContext db, string userId, bool comMetas = false)
    {
        var cats = (await db.Categorias.AsNoTracking().Where(c => c.UserId == userId).OrderBy(c => c.Id).ToListAsync())
            .Select(c => new CatS(c.Id, c.Nome, c.Tipo, c.LimiteMensal is decimal lim ? Centavos(lim) : null))
            .ToList();
        var contas = await db.Contas.AsNoTracking().Where(c => c.UserId == userId).OrderBy(c => c.Id)
            .Select(c => new ContaS(c.Id, c.Nome, c.CartaoFechamento, c.CartaoVencimento)).ToListAsync();
        var lancs = (await db.Lancamentos.AsNoTracking().Where(l => l.UserId == userId).OrderBy(l => l.Id).ToListAsync())
            .Select(l => new LancS(l.Id, l.Data, l.Tipo, l.CategoriaId, l.Descricao, l.ContaId, Centavos(l.Valor),
                l.Status, l.Fixa, l.ParcelaGrupo, l.ParcelaNumero, l.ParcelaTotal, l.CriadoEm))
            .ToList();
        var metas = new List<MetaS>();
        if (comMetas)
        {
            var ms = await db.Metas.AsNoTracking().Include(m => m.Aportes).Where(m => m.UserId == userId).OrderBy(m => m.Id).ToListAsync();
            metas = ms.Select(m => new MetaS(m.Id, m.Nome, Centavos(m.Alvo), m.Prazo, m.CriadoEm,
                m.Aportes.OrderBy(a => a.Id).Select(a => new AporteS(a.Id, a.Data, Centavos(a.Valor), a.Nota)).ToList())).ToList();
        }
        var prefs = await db.Preferencias.AsNoTracking().FirstOrDefaultAsync(p => p.UserId == userId)
                    ?? new PreferenciasUsuario { UserId = userId };
        return new Dados { Categorias = cats, Contas = contas, Lancamentos = lancs, Metas = metas, Prefs = prefs };
    }

    public IEnumerable<LancS> DoMes(string mes) => Lancamentos.Where(l => l.Mes == mes);
    public string NomeCategoria(int id) => Categorias.FirstOrDefault(c => c.Id == id)?.Nome ?? "";
    public ContaS? Conta(int id) => Contas.FirstOrDefault(c => c.Id == id);
}

public static class Calculos
{
    private static long Total(IEnumerable<LancS> l) => l.Sum(x => x.ValorCentavos);

    public static ContaDto DtoConta(ContaS c) =>
        new(c.Id, c.Nome, c.EhCartao ? new CartaoDto(c.Fechamento!.Value, c.Vencimento!.Value) : null);

    public static LancamentoDto DtoLancamento(Dados d, LancS l)
    {
        var conta = d.Conta(l.ContaId);
        return new LancamentoDto(l.Id, l.Data, l.Tipo, l.CategoriaId, d.NomeCategoria(l.CategoriaId), l.Descricao,
            l.ContaId, conta?.Nome ?? "", Reais(l.ValorCentavos), l.Status, l.Fixa,
            l.Grupo.HasValue ? new ParcelaDto(l.Grupo.Value, l.Numero!.Value, l.Total!.Value) : null,
            conta is { EhCartao: true } ? conta.FaturaDa(l.Data).Mes : null);
    }

    // ---------------------------------------------------------------- Painel (GET /api/dashboard)

    private static readonly Dictionary<string, int> Severidade = new() { ["estourado"] = 0, ["alerta"] = 1, ["ok"] = 2, ["semLimite"] = 3 };

    private static string Situacao(long limite, long realizado)
    {
        if (limite <= 0) return "semLimite";
        var pct = (double)realizado / limite * 100;
        if (pct > 100) return "estourado";
        if (pct >= 80) return "alerta";
        return "ok";
    }

    private static Dictionary<int, long> GastosPorCategoria(Dados d, string mes) =>
        d.DoMes(mes).Where(l => l.Tipo == TipoLancamento.Despesa && l.Pago)
            .GroupBy(l => l.CategoriaId).ToDictionary(g => g.Key, g => g.Sum(x => x.ValorCentavos));

    public static object Painel(Dados d, string mes, DateOnly hoje)
    {
        var itens = d.DoMes(mes).ToList();
        var receitas = itens.Where(l => l.Tipo == TipoLancamento.Receita).ToList();
        var despesas = itens.Where(l => l.Tipo == TipoLancamento.Despesa).ToList();
        var recebidas = Total(receitas.Where(l => l.Pago));
        var pagas = Total(despesas.Where(l => l.Pago));

        BlocoDto Bloco(List<LancS> lista) => new(
            Reais(Total(lista.Where(l => l.Pago))), Reais(Total(lista.Where(l => !l.Pago))), Reais(Total(lista)), lista.Count);
        var fixas = despesas.Where(l => l.Fixa).ToList();
        var variaveis = despesas.Where(l => !l.Fixa).ToList();
        var totalDespesas = Total(despesas);

        var gastos = GastosPorCategoria(d, mes);
        var pendPorCat = despesas.Where(l => !l.Pago).GroupBy(l => l.CategoriaId).ToDictionary(g => g.Key, g => g.Sum(x => x.ValorCentavos));
        var linhas = d.Categorias.Where(c => c.Tipo == TipoLancamento.Despesa).Select(c =>
        {
            var limite = c.LimiteCentavos ?? 0;
            var realizado = gastos.GetValueOrDefault(c.Id);
            return new
            {
                c.Id, c.Nome, Limite = limite, Realizado = realizado, Pendente = pendPorCat.GetValueOrDefault(c.Id),
                Situacao = Situacao(limite, realizado),
                Percentual = limite > 0 ? Um((double)realizado / limite * 100) : 0,
            };
        }).ToList();
        var comLimite = linhas.Where(x => x.Limite > 0).ToList();
        var limiteTotal = comLimite.Sum(x => x.Limite);
        var realizadoComLimite = comLimite.Sum(x => x.Realizado);
        var semLimiteRealizado = linhas.Where(x => x.Limite <= 0).Sum(x => x.Realizado);

        var categoriasOrcamento = linhas
            .Where(x => x.Limite > 0 || x.Realizado > 0 || x.Pendente > 0)
            .OrderBy(x => Severidade[x.Situacao]).ThenByDescending(x => x.Percentual).ThenByDescending(x => x.Realizado)
            .ThenBy(x => x.Nome, PorTexto)
            .Select(x => new
            {
                categoriaId = x.Id, categoria = x.Nome, limite = Reais(x.Limite), realizado = Reais(x.Realizado),
                pendente = Reais(x.Pendente), disponivel = Reais(x.Limite - x.Realizado), percentual = x.Percentual, situacao = x.Situacao,
            }).ToList();

        var anterior = d.DoMes(SomarMeses(mes, -1)).ToList();
        var pagasAnterior = Total(anterior.Where(l => l.Tipo == TipoLancamento.Despesa && l.Pago));
        var recebidasAnterior = Total(anterior.Where(l => l.Tipo == TipoLancamento.Receita && l.Pago));

        var mesHoje = MesDe(hoje);
        var dias = DiasNoMes(mes);
        var decorridos = mes == mesHoje ? hoje.Day : string.CompareOrdinal(mes, mesHoje) < 0 ? dias : 0;
        var mediaDiaria = decorridos > 0 ? (double)pagas / decorridos : 0;
        long? projecao = mes == mesHoje ? (long)Math.Floor(mediaDiaria * dias + 0.5) : null;

        var evolucao = Enumerable.Range(0, 6).Select(i =>
        {
            var m = SomarMeses(mes, i - 5);
            var doM = d.DoMes(m).ToList();
            return new
            {
                mes = m,
                receitas = Reais(Total(doM.Where(l => l.Tipo == TipoLancamento.Receita && l.Pago))),
                despesas = Reais(Total(doM.Where(l => l.Tipo == TipoLancamento.Despesa && l.Pago))),
            };
        }).ToList();

        var maiores = despesas.OrderByDescending(l => l.ValorCentavos).ThenByDescending(l => l.Id).Take(5)
            .Select(l => new
            {
                id = l.Id, descricao = l.Descricao, categoria = d.NomeCategoria(l.CategoriaId), data = l.Data,
                valor = Reais(l.ValorCentavos), status = l.Status, fixa = l.Fixa,
            }).ToList();

        List<ItemFixoDto> ListaFixos(List<LancS> lista) => lista.OrderBy(l => l.Data).ThenBy(l => l.Id)
            .Select(l => new ItemFixoDto(l.Id, l.Descricao, d.NomeCategoria(l.CategoriaId), l.Data, Reais(l.ValorCentavos), l.Status))
            .ToList();

        var receitasFixas = receitas.Where(l => l.Fixa).ToList();
        var totalReceitasFixas = Total(receitasFixas);
        var totalDespesasFixas = Total(fixas);

        BlocoComItensDto ComItens(List<LancS> lista)
        {
            var b = Bloco(lista);
            return new BlocoComItensDto(b.Pagas, b.Pendentes, b.Total, b.Quantidade, ListaFixos(lista));
        }

        return new
        {
            mes,
            saldoRealizado = Reais(recebidas - pagas),
            despesas = Bloco(despesas),
            receitas = Bloco(receitas),
            fixas = ComItens(fixas),
            receitasFixas = ComItens(receitasFixas),
            saldoFixo = Reais(totalReceitasFixas - totalDespesasFixas),
            comprometimentoFixo = totalReceitasFixas > 0 ? Um((double)totalDespesasFixas / totalReceitasFixas * 100) : (double?)null,
            variaveis = Bloco(variaveis),
            percentualFixas = totalDespesas > 0 ? Um((double)Total(fixas) / totalDespesas * 100) : 0,
            orcamento = new
            {
                limiteTotal = Reais(limiteTotal),
                realizado = Reais(realizadoComLimite),
                disponivel = Reais(limiteTotal - realizadoComLimite),
                percentual = limiteTotal > 0 ? Um((double)realizadoComLimite / limiteTotal * 100) : 0,
                semLimiteRealizado = Reais(semLimiteRealizado),
                categoriasComLimite = comLimite.Count,
                emAlerta = linhas.Count(x => x.Situacao == "alerta"),
                estouradas = linhas.Count(x => x.Situacao == "estourado"),
                categorias = categoriasOrcamento,
            },
            comparativo = new
            {
                despesasPagasMesAnterior = Reais(pagasAnterior),
                receitasRecebidasMesAnterior = Reais(recebidasAnterior),
                variacaoDespesas = pagasAnterior > 0 ? Um((double)(pagas - pagasAnterior) / pagasAnterior * 100) : (double?)null,
            },
            ritmo = new
            {
                diasDecorridos = decorridos, diasNoMes = dias,
                mediaDiaria = Reais((long)Math.Floor(mediaDiaria + 0.5)),
                projecaoDespesas = projecao is null ? (decimal?)null : Reais(projecao.Value),
            },
            evolucao,
            maioresDespesas = maiores,
        };
    }

    // ---------------------------------------------------------------- Lançamentos fixos: copiar

    public static string ChaveFixa(TipoLancamento tipo, string descricao, int categoriaId, int contaId) =>
        $"{tipo}|{descricao.Trim().ToLower(PtBr)}|{categoriaId}|{contaId}";

    // ---------------------------------------------------------------- Cartões

    public static object ResumoFatura(Dados d, ContaS conta, string mes, DateOnly hoje)
    {
        var (f, inicio) = FaturaDoMes(conta.Fechamento!.Value, conta.Vencimento!.Value, mes);
        var doCartao = d.Lancamentos.Where(l => l.ContaId == conta.Id && conta.FaturaDa(l.Data).Mes == mes).ToList();
        long Sinal(LancS l) => l.Tipo == TipoLancamento.Despesa ? l.ValorCentavos : -l.ValorCentavos;
        var total = doCartao.Sum(Sinal);
        var pendente = doCartao.Where(l => !l.Pago).Sum(Sinal);
        string situacao;
        if (doCartao.Count == 0) situacao = "vazia";
        else if (doCartao.All(l => l.Pago)) situacao = "paga";
        else if (hoje <= f.Fechamento) situacao = "aberta";
        else if (hoje > f.Vencimento) situacao = "vencida";
        else situacao = "fechada";
        return new
        {
            contaId = conta.Id, nome = conta.Nome, fechamentoDia = conta.Fechamento, vencimentoDia = conta.Vencimento,
            mes, inicio, fechamento = f.Fechamento, vencimento = f.Vencimento,
            total = Reais(total), pago = Reais(total - pendente), pendente = Reais(pendente),
            quantidade = doCartao.Count, situacao,
            itens = doCartao.OrderBy(l => l.Data).ThenBy(l => l.Id).Select(l => DtoLancamento(d, l)).ToList(),
        };
    }

    /// <summary>Pendentes com data para vencer; compras no cartão viram a FATURA, pelo vencimento dela.</summary>
    public record Vencimento(int? Id, string Chave, DateOnly Data, string Tipo, string Descricao, string Categoria,
        long ValorCentavos, bool Fixa, int ContaId, string? Fatura);

    public static List<Vencimento> VencimentosPendentes(Dados d)
    {
        var itens = new List<Vencimento>();
        var faturas = new Dictionary<string, (ContaS Conta, Fatura F, long Centavos)>();
        var ordemFaturas = new List<string>();
        foreach (var l in d.Lancamentos)
        {
            if (l.Pago) continue;
            var conta = d.Conta(l.ContaId);
            if (conta is { EhCartao: true })
            {
                var f = conta.FaturaDa(l.Data);
                var chave = $"{conta.Id}|{f.Mes}";
                var delta = l.Tipo == TipoLancamento.Despesa ? l.ValorCentavos : -l.ValorCentavos;
                if (faturas.TryGetValue(chave, out var atual)) faturas[chave] = (atual.Conta, atual.F, atual.Centavos + delta);
                else { faturas[chave] = (conta, f, delta); ordemFaturas.Add(chave); }
            }
            else
            {
                itens.Add(new Vencimento(l.Id, $"l{l.Id}", l.Data, l.Tipo.ToString(), l.Descricao, d.NomeCategoria(l.CategoriaId),
                    l.ValorCentavos, l.Fixa, l.ContaId, null));
            }
        }
        foreach (var chave in ordemFaturas)
        {
            var (conta, f, centavos) = faturas[chave];
            if (centavos <= 0) continue;
            itens.Add(new Vencimento(null, $"f{conta.Id}-{f.Mes}", f.Vencimento, "Fatura", $"Fatura {conta.Nome}",
                "Cartão de crédito", centavos, false, conta.Id, f.Mes));
        }
        // Mesma ordem do motor: data, depois a chave em ordem de código (UTF-16).
        return itens.OrderBy(x => x.Data).ThenBy(x => x.Chave, StringComparer.Ordinal).ToList();
    }

    // ---------------------------------------------------------------- Lembretes e configurações

    public static object Config(PreferenciasUsuario p) => new
    {
        lembretes = new { ativo = p.LembretesAtivo, diasAntes = p.LembretesDiasAntes, hora = p.LembretesHora, detalhes = p.LembretesDetalhes },
        backup = new { automatico = p.BackupAutomatico, ultimo = Instante(p.UltimoBackup), ultimoAutomatico = Instante(p.UltimoBackupAutomatico) },
        painel = PainelResposta(LerPainel(p.PainelJson)),
    };

    public static string? Instante(DateTime? utc) =>
        utc is null ? null : DateTime.SpecifyKind(utc.Value, DateTimeKind.Utc).ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", Inv);

    public static object Lembretes(Dados d, int dias, DateOnly hoje, Relogio relogio)
    {
        var pendentes = VencimentosPendentes(d).Select(x => (V: x, Dias: DiasEntre(hoje, x.Data))).ToList();
        var atrasados = pendentes.Where(x => x.Dias < 0).ToList();
        var proximos = pendentes.Where(x => x.Dias >= 0 && x.Dias <= dias).ToList();
        decimal Soma(List<(Vencimento V, int Dias)> lista, bool receita) => Reais(lista
            .Where(x => receita ? x.V.Tipo == "Receita" : x.V.Tipo != "Receita").Sum(x => x.V.ValorCentavos));
        object Item(Vencimento v, int dd) => new
        {
            id = v.Id, data = v.Data, tipo = v.Tipo, descricao = v.Descricao, categoria = v.Categoria, fixa = v.Fixa,
            contaId = v.ContaId, fatura = v.Fatura, valor = Reais(v.ValorCentavos), dias = dd, chave = v.Chave,
        };

        var instantes = new[] { d.Prefs.UltimoBackup, d.Prefs.UltimoBackupAutomatico }.Where(x => x.HasValue).Select(x => x!.Value).ToList();
        DateTime? ultimo = instantes.Count == 0 ? null : instantes.Max();
        int? diasDesde = ultimo is null ? null : Math.Max(0, DiasEntre(relogio.DataLocal(ultimo.Value), hoje));

        return new
        {
            hoje, dias,
            atrasados = atrasados.Select(x => Item(x.V, x.Dias)).ToList(),
            proximos = proximos.Select(x => Item(x.V, x.Dias)).ToList(),
            totais = new
            {
                despesasAtrasadas = Soma(atrasados, false), receitasAtrasadas = Soma(atrasados, true),
                despesasProximas = Soma(proximos, false), receitasProximas = Soma(proximos, true),
            },
            backup = new
            {
                ultimo = Instante(ultimo), diasDesde,
                atrasado = d.Lancamentos.Count > 0 && (diasDesde is null || diasDesde >= DiasParaLembrarBackup),
            },
        };
    }

    // ---------------------------------------------------------------- Metas

    public static long Guardado(MetaS m) => m.Aportes.Sum(a => a.ValorCentavos);

    private static readonly Dictionary<string, int> OrdemMeta = new()
        { ["atrasada"] = 0, ["abaixoDoRitmo"] = 1, ["noRitmo"] = 2, ["semPrazo"] = 3, ["concluida"] = 4 };
    public static int OrdemDaSituacao(string s) => OrdemMeta[s];

    public static MetaDto DtoMeta(MetaS m, DateOnly hoje, Relogio relogio)
    {
        var guardado = Guardado(m);
        var falta = Math.Max(0, m.AlvoCentavos - guardado);
        var inicio = relogio.DataLocal(m.CriadoEm);
        string situacao;
        int? mesesRestantes = null;
        long? mensal = null;
        if (guardado >= m.AlvoCentavos) situacao = "concluida";
        else if (m.Prazo is null) situacao = "semPrazo";
        else if (hoje > m.Prazo) situacao = "atrasada";
        else
        {
            var p = m.Prazo.Value;
            mesesRestantes = (p.Year * 12 + p.Month) - (hoje.Year * 12 + hoje.Month) + 1;
            mensal = (long)Math.Ceiling((double)falta / mesesRestantes.Value);
            var total = Math.Max(1, DiasEntre(inicio, p));
            var passados = Math.Min(total, Math.Max(0, DiasEntre(inicio, hoje)));
            var esperado = (long)Math.Floor((double)m.AlvoCentavos * passados / total + 0.5);
            situacao = guardado >= esperado ? "noRitmo" : "abaixoDoRitmo";
        }
        return new MetaDto(m.Id, m.Nome, Reais(m.AlvoCentavos), m.Prazo, Reais(guardado), Reais(falta),
            Um(Math.Min(100, (double)guardado / m.AlvoCentavos * 100)), situacao, mesesRestantes,
            mensal is null ? null : Reais(mensal.Value),
            m.Aportes.OrderByDescending(a => a.Data).ThenByDescending(a => a.Id)
                .Select(a => new AporteDto(a.Id, a.Data, Reais(a.ValorCentavos), a.Nota)).ToList());
    }

    // ---------------------------------------------------------------- Planilha (CSV)

    private static string CsvTexto(string? v)
    {
        var t = v ?? "";
        // Proteção contra "injeção de fórmula": texto que começa com = + - @ vira texto puro no Excel.
        if (t.Length > 0 && "=+-@\t\r".Contains(t[0])) t = "'" + t;
        return t.IndexOfAny([';', '"', '\r', '\n']) >= 0 ? $"\"{t.Replace("\"", "\"\"")}\"" : t;
    }
    private static string CsvValor(long centavos) => (centavos / 100m).ToString("0.00", Inv).Replace('.', ',');
    private static string DataBr(DateOnly d) => d.ToString("dd/MM/yyyy", Inv);

    public static (string Texto, int Quantidade) GerarCsv(Dados d, DateOnly? de, DateOnly? ate)
    {
        var itens = d.Lancamentos.Where(l => (de is null || l.Data >= de) && (ate is null || l.Data <= ate))
            .OrderBy(l => l.Data).ThenBy(l => l.Id).ToList();
        var sb = new StringBuilder("﻿");
        sb.Append("Data;Tipo;Descrição;Categoria;Conta;Valor;Status;Fixa;Parcela;Fatura\r\n");
        foreach (var l in itens)
        {
            var conta = d.Conta(l.ContaId);
            var fatura = conta is { EhCartao: true } ? string.Join('/', Enumerable.Reverse(conta.FaturaDa(l.Data).Mes.Split('-'))) : "";
            sb.Append(string.Join(';',
                DataBr(l.Data), l.Tipo.ToString(), CsvTexto(l.Descricao), CsvTexto(d.NomeCategoria(l.CategoriaId)), CsvTexto(conta?.Nome),
                CsvValor(l.Tipo == TipoLancamento.Receita ? l.ValorCentavos : -l.ValorCentavos),
                l.Pago ? (l.Tipo == TipoLancamento.Receita ? "Recebido" : "Pago") : "Pendente",
                l.Fixa ? "Sim" : "Não", l.Grupo.HasValue ? $"{l.Numero}/{l.Total}" : "", fatura)).Append("\r\n");
        }
        return (sb.ToString(), itens.Count);
    }
}
