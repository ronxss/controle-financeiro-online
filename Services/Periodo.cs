using System.Globalization;

namespace ControleFinanceiro.Services;

public static class Periodo
{
    /// <summary>Converte "AAAA-MM" (ou vazio = mês atual) em [inicio, fim) — fim é exclusivo.</summary>
    public static bool TentarObter(string? mes, DateOnly hoje, out DateOnly inicio, out DateOnly fim)
    {
        fim = default;
        if (string.IsNullOrWhiteSpace(mes))
        {
            inicio = new DateOnly(hoje.Year, hoje.Month, 1);
        }
        else if (!Regras.TentarLerMes(mes, hoje, out _)
                 || !DateOnly.TryParseExact(mes + "-01", "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out inicio))
        {
            return false;
        }
        fim = inicio.AddMonths(1);
        return true;
    }
}
