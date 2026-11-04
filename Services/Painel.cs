using System.Text.Json;

namespace ControleFinanceiro.Services;

/// <summary>
/// Preferências do painel (tela Resumo): quais seções aparecem e com que tipo de gráfico.
/// Mesmas regras de SECOES_PAINEL / normalizarPainel / PUT /api/config do motor local (engine.js).
/// </summary>
public static partial class Regras
{
    /// <summary>Seções na ordem da tela e os tipos aceitos. O primeiro tipo é o padrão.</summary>
    public static readonly (string Id, string[] Tipos)[] SecoesPainel =
    [
        ("indicadores", ["cartoes"]),
        ("despesasCategoria", ["barras", "pizza", "rosca"]),
        ("orcamento", ["barras"]),
        ("fixas", ["barras", "pizza", "rosca"]),
        ("fixasVariaveis", ["barras", "pizza", "rosca"]),
        ("evolucao", ["barras", "linhas"]),
        ("ritmo", ["lista"]),
        ("maioresDespesas", ["lista", "barras"]),
    ];

    public record SecaoPainel(bool Visivel, string Tipo);

    private static string[]? TiposDa(string id) => SecoesPainel.FirstOrDefault(s => s.Id == id).Tipos;

    /// <summary>Leitura tolerante (dados gravados ou backup): seção desconhecida é ignorada; valor errado volta ao padrão.</summary>
    public static Dictionary<string, SecaoPainel> NormalizarPainel(JsonElement? painel)
    {
        var r = new Dictionary<string, SecaoPainel>();
        foreach (var (id, tipos) in SecoesPainel)
        {
            var visivel = true;
            var tipo = tipos[0];
            if (painel is { ValueKind: JsonValueKind.Object } p && p.TryGetProperty(id, out var s) && s.ValueKind == JsonValueKind.Object)
            {
                if (s.TryGetProperty("visivel", out var v) && v.ValueKind is JsonValueKind.True or JsonValueKind.False) visivel = v.GetBoolean();
                if (s.TryGetProperty("tipo", out var t) && t.ValueKind == JsonValueKind.String && tipos.Contains(t.GetString())) tipo = t.GetString()!;
            }
            r[id] = new SecaoPainel(visivel, tipo);
        }
        return r;
    }

    public static Dictionary<string, SecaoPainel> LerPainel(string? json)
    {
        if (string.IsNullOrEmpty(json)) return NormalizarPainel(null);
        try
        {
            using var doc = JsonDocument.Parse(json);
            return NormalizarPainel(doc.RootElement.Clone());
        }
        catch (JsonException) { return NormalizarPainel(null); }
    }

    public static string GravarPainel(Dictionary<string, SecaoPainel> painel) =>
        JsonSerializer.Serialize(painel.ToDictionary(x => x.Key, x => new { visivel = x.Value.Visivel, tipo = x.Value.Tipo }));

    public static object PainelResposta(Dictionary<string, SecaoPainel> painel) =>
        painel.ToDictionary(x => x.Key, x => (object)new { visivel = x.Value.Visivel, tipo = x.Value.Tipo });

    /// <summary>
    /// Alteração parcial vinda do PUT /api/config. Valida tudo antes de mudar; devolve a mensagem de erro
    /// (igual à do motor local) ou null.
    /// </summary>
    public static string? AplicarPainel(Dictionary<string, SecaoPainel> atual, JsonElement painel)
    {
        static string Inv(string campo) => $"Valor inválido para \"{campo}\".";
        if (painel.ValueKind != JsonValueKind.Object) return Inv("painel");
        foreach (var sec in painel.EnumerateObject())
        {
            var tipos = TiposDa(sec.Name);
            if (tipos is null || sec.Value.ValueKind != JsonValueKind.Object) return Inv($"painel.{sec.Name}");
            if (sec.Value.TryGetProperty("visivel", out var v) && v.ValueKind is not (JsonValueKind.True or JsonValueKind.False))
                return Inv($"painel.{sec.Name}.visivel");
            if (sec.Value.TryGetProperty("tipo", out var t) && !(t.ValueKind == JsonValueKind.String && tipos.Contains(t.GetString())))
                return Inv($"painel.{sec.Name}.tipo");
        }
        foreach (var sec in painel.EnumerateObject())
        {
            var s = atual[sec.Name];
            if (sec.Value.TryGetProperty("visivel", out var v)) s = s with { Visivel = v.GetBoolean() };
            if (sec.Value.TryGetProperty("tipo", out var t)) s = s with { Tipo = t.GetString()! };
            atual[sec.Name] = s;
        }
        return null;
    }
}
