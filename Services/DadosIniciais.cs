using ControleFinanceiro.Data;
using ControleFinanceiro.Models;
using Microsoft.EntityFrameworkCore;

namespace ControleFinanceiro.Services;

/// <summary>Cria o banco e popula categorias/contas padrão (aba "Listas" da planilha) para cada novo usuário.</summary>
public static class DadosIniciais
{
    private static readonly string[] CategoriasReceita = ["Salário", "Freelance", "Investimentos"];

    private static readonly string[] CategoriasDespesa =
    [
        "Moradia", "Alimentação", "Transporte", "Saúde", "Educação", "Lazer",
        "Assinaturas", "Compras", "Contas e impostos", "Viagem", "Outros"
    ];

    private static readonly string[] Contas =
        ["Conta corrente", "Dinheiro", "Cartão de crédito", "Poupança/Investimentos", "Outro"];

    public static async Task CriarAsync(AppDbContext db, string userId)
    {
        foreach (var n in CategoriasReceita)
            db.Categorias.Add(new Categoria { UserId = userId, Nome = n, Tipo = TipoLancamento.Receita });
        foreach (var n in CategoriasDespesa)
            db.Categorias.Add(new Categoria { UserId = userId, Nome = n, Tipo = TipoLancamento.Despesa, LimiteMensal = 0 });
        foreach (var n in Contas)
            db.Contas.Add(new Conta { UserId = userId, Nome = n });
        await db.SaveChangesAsync();
    }

    /// <summary>Cria o banco se não existir. Tenta por até ~2 minutos (SQL Server em Docker subindo, ou Azure SQL grátis acordando da pausa).</summary>
    public static async Task InicializarBancoAsync(IServiceProvider sp, ILogger logger)
    {
        var db = sp.GetRequiredService<AppDbContext>();
        for (var tentativa = 1; ; tentativa++)
        {
            try
            {
                // Com migrations no projeto, o esquema evolui sem perder dados; sem elas (projeto antigo), cria do zero.
                if (db.Database.GetMigrations().Any()) await db.Database.MigrateAsync();
                else await db.Database.EnsureCreatedAsync();
                return;
            }
            catch (Exception ex) when (tentativa < 40)
            {
                logger.LogWarning("Banco indisponível (tentativa {T}/40): {Msg}", tentativa, ex.Message);
                await Task.Delay(TimeSpan.FromSeconds(3));
            }
        }
    }
}
