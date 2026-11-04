using ControleFinanceiro.Models;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;

namespace ControleFinanceiro.Data;

public class AppDbContext(DbContextOptions<AppDbContext> options) : IdentityDbContext<ApplicationUser>(options)
{
    public DbSet<Categoria> Categorias => Set<Categoria>();
    public DbSet<Conta> Contas => Set<Conta>();
    public DbSet<Lancamento> Lancamentos => Set<Lancamento>();
    public DbSet<Meta> Metas => Set<Meta>();
    public DbSet<Aporte> Aportes => Set<Aporte>();
    public DbSet<PreferenciasUsuario> Preferencias => Set<PreferenciasUsuario>();

    protected override void OnModelCreating(ModelBuilder b)
    {
        base.OnModelCreating(b);

        b.Entity<ApplicationUser>().Property(u => u.NomeCompleto).HasMaxLength(100);

        b.Entity<Categoria>(e =>
        {
            e.Property(x => x.Nome).HasMaxLength(60).IsRequired();
            e.Property(x => x.Tipo).HasConversion<string>().HasMaxLength(10);
            e.Property(x => x.LimiteMensal).HasPrecision(18, 2);
            e.HasIndex(x => new { x.UserId, x.Nome }).IsUnique();
            e.HasOne<ApplicationUser>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<Conta>(e =>
        {
            e.Property(x => x.Nome).HasMaxLength(60).IsRequired();
            e.HasIndex(x => new { x.UserId, x.Nome }).IsUnique();
            e.Ignore(x => x.EhCartao);
            e.ToTable(t =>
            {
                t.HasCheckConstraint("CK_Conta_Cartao",
                    "([CartaoFechamento] IS NULL AND [CartaoVencimento] IS NULL) OR " +
                    "([CartaoFechamento] BETWEEN 1 AND 31 AND [CartaoVencimento] BETWEEN 1 AND 31)");
            });
            e.HasOne<ApplicationUser>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<Lancamento>(e =>
        {
            e.ToTable(t =>
            {
                t.HasCheckConstraint("CK_Lancamento_Valor", "[Valor] > 0");
                t.HasCheckConstraint("CK_Lancamento_Parcela",
                    "([ParcelaGrupo] IS NULL AND [ParcelaNumero] IS NULL AND [ParcelaTotal] IS NULL) OR " +
                    "([ParcelaTotal] BETWEEN 2 AND 60 AND [ParcelaNumero] BETWEEN 1 AND [ParcelaTotal] AND [ParcelaGrupo] > 0)");
            });
            e.Property(x => x.Descricao).HasMaxLength(200).IsRequired();
            e.Property(x => x.Valor).HasPrecision(18, 2);
            e.Property(x => x.Tipo).HasConversion<string>().HasMaxLength(10);
            e.Property(x => x.Status).HasConversion<string>().HasMaxLength(20);
            e.HasIndex(x => new { x.UserId, x.Data });
            e.HasIndex(x => new { x.UserId, x.ParcelaGrupo });
            e.HasOne(x => x.Categoria).WithMany().HasForeignKey(x => x.CategoriaId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne(x => x.Conta).WithMany().HasForeignKey(x => x.ContaId).OnDelete(DeleteBehavior.Restrict);
            e.HasOne<ApplicationUser>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<Meta>(e =>
        {
            e.ToTable(t => t.HasCheckConstraint("CK_Meta_Alvo", "[Alvo] > 0"));
            e.Property(x => x.Nome).HasMaxLength(60).IsRequired();
            e.Property(x => x.Alvo).HasPrecision(18, 2);
            e.HasIndex(x => new { x.UserId, x.Nome }).IsUnique();
            e.HasMany(x => x.Aportes).WithOne(x => x.Meta).HasForeignKey(x => x.MetaId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne<ApplicationUser>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        });

        b.Entity<Aporte>(e =>
        {
            e.ToTable(t => t.HasCheckConstraint("CK_Aporte_Valor", "[Valor] <> 0"));
            e.Property(x => x.Valor).HasPrecision(18, 2);
            e.Property(x => x.Nota).HasMaxLength(100).IsRequired();
        });

        b.Entity<PreferenciasUsuario>(e =>
        {
            e.HasKey(x => x.UserId);
            e.HasOne<ApplicationUser>().WithOne().HasForeignKey<PreferenciasUsuario>(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
        });
    }
}
