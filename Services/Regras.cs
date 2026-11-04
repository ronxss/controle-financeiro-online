using System.Globalization;
using System.Text.RegularExpressions;

namespace ControleFinanceiro.Services;

/// <summary>
/// Regras de datas, dinheiro e cartão — as MESMAS do motor do app local (ClientApp/src/local/engine.js).
/// Os testes de contrato (tests/contrato) rodam as mesmas requisições no servidor e no motor e exigem respostas iguais.
/// Dinheiro é calculado em CENTAVOS (long) e só vira reais na resposta.
/// </summary>
public static partial class Regras
{
    public const int MaxParcelas = 60;
    public const long LimiteMaximoCentavos = 99_999_999_999; // 999.999.999,99
    public static readonly int[] Antecedencias = [0, 1, 2, 3, 5, 7];
    public const int DiasParaLembrarBackup = 7;

    public static readonly CultureInfo Inv = CultureInfo.InvariantCulture;
    public static readonly CultureInfo PtBr = CultureInfo.GetCultureInfo("pt-BR");

    // ---------- Dinheiro ----------

    /// <summary>Igual a Math.round(valor * 100) do JavaScript (metade arredonda para cima).</summary>
    public static long Centavos(decimal valor) => (long)Math.Floor(valor * 100m + 0.5m);
    public static decimal Reais(long centavos) => centavos / 100m;

    /// <summary>1 casa decimal, como Math.round(n * 10) / 10 do JavaScript.</summary>
    public static double Um(double n) => Math.Floor(n * 10 + 0.5) / 10;

    // ---------- Datas ----------

    public static string Iso(DateOnly d) => d.ToString("yyyy-MM-dd", Inv);
    public static string MesDe(DateOnly d) => d.ToString("yyyy-MM", Inv);

    [GeneratedRegex(@"^\d{4}-(0[1-9]|1[0-2])$")]
    private static partial Regex PadraoMes();

    /// <summary>"aaaa-mm" (vazio = mês de hoje). Devolve false se o formato for inválido.</summary>
    public static bool TentarLerMes(string? mes, DateOnly hoje, out string resultado)
    {
        if (string.IsNullOrWhiteSpace(mes)) { resultado = MesDe(hoje); return true; }
        resultado = mes;
        return PadraoMes().IsMatch(mes);
    }
    public const string MsgMesInvalido = "Mês inválido. Use o formato AAAA-MM.";

    public static (int Ano, int Mes) Partes(string mes) =>
        (int.Parse(mes[..4], Inv), int.Parse(mes.Substring(5, 2), Inv));

    public static string SomarMeses(string mes, int delta)
    {
        var (a, m) = Partes(mes);
        var total = a * 12 + (m - 1) + delta;
        var ano = (int)Math.Floor(total / 12.0);
        return $"{ano:D4}-{total - ano * 12 + 1:D2}";
    }

    public static int DiasNoMes(string mes)
    {
        var (a, m) = Partes(mes);
        return DateTime.DaysInMonth(a, m);
    }

    /// <summary>Dia `dia` do mês, ou o último dia se o mês for menor (31 -> 28/fev).</summary>
    public static DateOnly DiaDoMes(string mes, int dia)
    {
        var (a, m) = Partes(mes);
        return new DateOnly(a, m, Math.Min(dia, DateTime.DaysInMonth(a, m)));
    }

    public static int DiasEntre(DateOnly a, DateOnly b) => b.DayNumber - a.DayNumber;

    public static bool TentarLerData(string? texto, out DateOnly data) =>
        DateOnly.TryParseExact(texto, "yyyy-MM-dd", Inv, DateTimeStyles.None, out data);

    // ---------- Cartão de crédito ----------
    // Compras feitas ATÉ o dia do fechamento (inclusive) entram na fatura que fecha naquele mês; depois dele, na do
    // mês seguinte. A fatura vence no dia de vencimento seguinte ao fechamento e é identificada pelo MÊS DO VENCIMENTO.

    public record Fatura(string Mes, DateOnly Fechamento, DateOnly Vencimento);

    private static Fatura DatasDaFatura(int fechamento, int vencimento, string mesFechamento)
    {
        var f = DiaDoMes(mesFechamento, fechamento);
        var mesVenc = vencimento > fechamento ? mesFechamento : SomarMeses(mesFechamento, 1);
        return new Fatura(mesVenc, f, DiaDoMes(mesVenc, vencimento));
    }

    public static Fatura FaturaDaCompra(int fechamento, int vencimento, DateOnly data)
    {
        var mesCompra = MesDe(data);
        var mesFech = data <= DiaDoMes(mesCompra, fechamento) ? mesCompra : SomarMeses(mesCompra, 1);
        return DatasDaFatura(fechamento, vencimento, mesFech);
    }

    /// <summary>Fatura que vence no mês `mes` e o primeiro dia do período de compras que ela cobre.</summary>
    public static (Fatura Fatura, DateOnly Inicio) FaturaDoMes(int fechamento, int vencimento, string mes)
    {
        var mesFech = vencimento > fechamento ? mes : SomarMeses(mes, -1);
        var f = DatasDaFatura(fechamento, vencimento, mesFech);
        var anterior = DatasDaFatura(fechamento, vencimento, SomarMeses(mesFech, -1));
        return (f, anterior.Fechamento.AddDays(1));
    }

    public static bool DiaCartaoValido(int? v) => v is >= 1 and <= 31;
    public const string MsgCartao = "Informe o dia de fechamento e o de vencimento do cartão (1 a 31).";

    // ---------- Texto ----------

    /// <summary>Comparação de nomes que ignora maiúsculas/minúsculas (toLocaleLowerCase('pt-BR') no JS).</summary>
    public static bool MesmoNome(string a, string b) =>
        string.Equals(a.ToLower(PtBr), b.ToLower(PtBr), StringComparison.Ordinal);

    /// <summary>Ordenação de texto como localeCompare(…, 'pt-BR').</summary>
    public static readonly StringComparer PorTexto = StringComparer.Create(PtBr, CompareOptions.None);
}

/// <summary>Data de "hoje" no fuso do usuário (padrão: America/Sao_Paulo), não no fuso do servidor.</summary>
public class Relogio(IConfiguration config)
{
    private readonly TimeZoneInfo _fuso = ObterFuso(config["App:FusoHorario"]);

    private static TimeZoneInfo ObterFuso(string? id)
    {
        try { return TimeZoneInfo.FindSystemTimeZoneById(string.IsNullOrWhiteSpace(id) ? "America/Sao_Paulo" : id); }
        catch (TimeZoneNotFoundException) { return TimeZoneInfo.Utc; }
    }

    public DateTime AgoraUtc => DateTime.UtcNow;
    public DateOnly Hoje => DataLocal(DateTime.UtcNow);
    public DateOnly DataLocal(DateTime utc) =>
        DateOnly.FromDateTime(TimeZoneInfo.ConvertTimeFromUtc(DateTime.SpecifyKind(utc, DateTimeKind.Utc), _fuso));
}
