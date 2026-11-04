using Microsoft.AspNetCore.Identity;

namespace ControleFinanceiro.Models;

public enum TipoLancamento { Receita = 1, Despesa = 2 }

/// <summary>"Pago/Recebido" e "Pendente" da aba Listas da planilha.</summary>
public enum StatusLancamento { Pendente = 1, PagoRecebido = 2 }

public class ApplicationUser : IdentityUser
{
    public string NomeCompleto { get; set; } = string.Empty;
}

/// <summary>Aba "Listas" (categorias) + coluna "Limite mensal" da aba "Orçamento".</summary>
public class Categoria
{
    public int Id { get; set; }
    public string UserId { get; set; } = string.Empty;
    public string Nome { get; set; } = string.Empty;
    public TipoLancamento Tipo { get; set; }
    public decimal? LimiteMensal { get; set; }
}

/// <summary>Aba "Listas" (contas). Com fechamento e vencimento preenchidos, a conta é um cartão de crédito.</summary>
public class Conta
{
    public int Id { get; set; }
    public string UserId { get; set; } = string.Empty;
    public string Nome { get; set; } = string.Empty;
    /// <summary>Dia do fechamento da fatura (1 a 31; em meses menores vale o último dia).</summary>
    public int? CartaoFechamento { get; set; }
    /// <summary>Dia do vencimento da fatura (1 a 31).</summary>
    public int? CartaoVencimento { get; set; }

    public bool EhCartao => CartaoFechamento.HasValue && CartaoVencimento.HasValue;
}

/// <summary>Aba "Lançamentos". O "Mês" da planilha é derivado de Data.</summary>
public class Lancamento
{
    public int Id { get; set; }
    public string UserId { get; set; } = string.Empty;
    public DateOnly Data { get; set; }
    public TipoLancamento Tipo { get; set; }
    public int CategoriaId { get; set; }
    public Categoria Categoria { get; set; } = null!;
    public string Descricao { get; set; } = string.Empty;
    public int ContaId { get; set; }
    public Conta Conta { get; set; } = null!;
    public decimal Valor { get; set; }
    public StatusLancamento Status { get; set; }
    public DateTime CriadoEm { get; set; } = DateTime.UtcNow;

    /// <summary>Repete todo mês (receita ou despesa fixa).</summary>
    public bool Fixa { get; set; }

    /// <summary>Compra parcelada: Id da 1ª parcela (identifica o grupo), número desta parcela e total.</summary>
    public int? ParcelaGrupo { get; set; }
    public int? ParcelaNumero { get; set; }
    public int? ParcelaTotal { get; set; }
}

/// <summary>Meta de economia ("cofrinho"): os depósitos e retiradas ficam na própria meta, sem gerar lançamentos.</summary>
public class Meta
{
    public int Id { get; set; }
    public string UserId { get; set; } = string.Empty;
    public string Nome { get; set; } = string.Empty;
    public decimal Alvo { get; set; }
    public DateOnly? Prazo { get; set; }
    public DateTime CriadoEm { get; set; } = DateTime.UtcNow;
    public List<Aporte> Aportes { get; set; } = [];
}

/// <summary>Depósito (valor positivo) ou retirada (negativo) de uma meta.</summary>
public class Aporte
{
    public int Id { get; set; }
    public int MetaId { get; set; }
    public Meta Meta { get; set; } = null!;
    public DateOnly Data { get; set; }
    public decimal Valor { get; set; }
    public string Nota { get; set; } = string.Empty;
}

/// <summary>Preferências do usuário (mesmas do app local: lembretes e registro de backup).</summary>
public class PreferenciasUsuario
{
    public string UserId { get; set; } = string.Empty;
    public bool LembretesAtivo { get; set; }
    public int LembretesDiasAntes { get; set; } = 1;
    public int LembretesHora { get; set; } = 9;
    public bool LembretesDetalhes { get; set; } = true;
    public bool BackupAutomatico { get; set; }
    public DateTime? UltimoBackup { get; set; }
    public DateTime? UltimoBackupAutomatico { get; set; }
    /// <summary>Preferências do painel (seções visíveis e tipo de gráfico), em JSON. Null = padrão.</summary>
    public string? PainelJson { get; set; }
}
