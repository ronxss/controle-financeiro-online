using System.ComponentModel.DataAnnotations;
using ControleFinanceiro.Models;

namespace ControleFinanceiro.Dtos;

// ---------- Autenticação ----------
public class RegistroRequest
{
    [Required(ErrorMessage = "Informe seu nome."), StringLength(100, MinimumLength = 2, ErrorMessage = "O nome deve ter entre 2 e 100 caracteres.")]
    public string Nome { get; set; } = "";

    [Required(ErrorMessage = "Informe o e-mail."), EmailAddress(ErrorMessage = "E-mail inválido."), StringLength(256)]
    public string Email { get; set; } = "";

    [Required(ErrorMessage = "Informe a senha."), StringLength(100, ErrorMessage = "A senha deve ter no máximo 100 caracteres.")]
    public string Senha { get; set; } = "";
}

public class LoginRequest
{
    [Required(ErrorMessage = "Informe o e-mail."), StringLength(256)]
    public string Email { get; set; } = "";

    [Required(ErrorMessage = "Informe a senha."), StringLength(100)]
    public string Senha { get; set; } = "";
}

public class AlterarSenhaRequest
{
    [Required(ErrorMessage = "Informe a senha atual."), StringLength(100)]
    public string SenhaAtual { get; set; } = "";

    [Required(ErrorMessage = "Informe a nova senha."), StringLength(100)]
    public string NovaSenha { get; set; } = "";
}

public class GoogleLoginRequest
{
    [Required(ErrorMessage = "Credencial do Google ausente."), StringLength(4096)]
    public string Credential { get; set; } = "";
}

/// <summary>TemSenha = false para contas criadas apenas via Google (não há senha para alterar).</summary>
public record UsuarioDto(string Nome, string Email, bool TemSenha);

// ---------- Lançamentos ----------
public class LancamentoRequest
{
    [Required(ErrorMessage = "Informe a data.")] public DateOnly? Data { get; set; }
    [Required(ErrorMessage = "Informe o tipo.")] public TipoLancamento? Tipo { get; set; }
    [Required(ErrorMessage = "Selecione a categoria.")] public int? CategoriaId { get; set; }

    [Required(ErrorMessage = "Informe a descrição."), StringLength(200, ErrorMessage = "A descrição deve ter no máximo 200 caracteres.")]
    public string Descricao { get; set; } = "";

    [Required(ErrorMessage = "Selecione a conta.")] public int? ContaId { get; set; }

    [Range(0.01, 999999999.99, ErrorMessage = "O valor deve ser maior que zero.")]
    public decimal Valor { get; set; }

    [Required(ErrorMessage = "Informe o status.")] public StatusLancamento? Status { get; set; }

    /// <summary>Opcional: ausente mantém o valor atual (ou falso ao criar).</summary>
    public bool? Fixa { get; set; }

    /// <summary>Só ao criar: divide o VALOR TOTAL em N parcelas mensais (1 = à vista).</summary>
    public int? Parcelas { get; set; }
}

public class FixaRequest
{
    public bool? Fixa { get; set; }
}

public class StatusRequest
{
    [Required] public StatusLancamento? Status { get; set; }
}

public record ParcelaDto(int Grupo, int Numero, int Total);

/// <summary>Fatura = mês de vencimento da fatura ("aaaa-mm") quando a conta é um cartão de crédito.</summary>
public record LancamentoDto(
    int Id, DateOnly Data, TipoLancamento Tipo, int CategoriaId, string Categoria,
    string Descricao, int ContaId, string Conta, decimal Valor, StatusLancamento Status,
    bool Fixa, ParcelaDto? Parcela, string? Fatura);

public class CopiarFixasRequest
{
    public string? Mes { get; set; }
    public string? Origem { get; set; }
}

// ---------- Cadastros ----------
public class CategoriaRequest
{
    [Required(ErrorMessage = "Informe o nome."), StringLength(60, ErrorMessage = "O nome deve ter no máximo 60 caracteres.")]
    public string Nome { get; set; } = "";

    [Required(ErrorMessage = "Informe o tipo.")] public TipoLancamento? Tipo { get; set; }
}

public class ContaRequest
{
    [Required(ErrorMessage = "Informe o nome."), StringLength(60, ErrorMessage = "O nome deve ter no máximo 60 caracteres.")]
    public string Nome { get; set; } = "";

    private CartaoRequest? _cartao;
    /// <summary>Ausente = não mexe; null = deixa de ser cartão; objeto = dias de fechamento e vencimento.</summary>
    public CartaoRequest? Cartao { get => _cartao; set { _cartao = value; CartaoInformado = true; } }
    [System.Text.Json.Serialization.JsonIgnore] public bool CartaoInformado { get; private set; }
}

public class CartaoRequest
{
    public int? Fechamento { get; set; }
    public int? Vencimento { get; set; }
}

public record CategoriaDto(int Id, string Nome, TipoLancamento Tipo, decimal? LimiteMensal);
public record CartaoDto(int Fechamento, int Vencimento);
public record ContaDto(int Id, string Nome, CartaoDto? Cartao);

// ---------- Orçamento e Resumo ----------
public class LimiteRequest
{
    [Required] public int? CategoriaId { get; set; }
    [Range(0, 999999999.99, ErrorMessage = "O limite não pode ser negativo.")] public decimal? Limite { get; set; }
}

public record OrcamentoItemDto(int CategoriaId, string Categoria, decimal Limite, decimal Realizado, decimal Disponivel, decimal Percentual);
public record DespesaCategoriaDto(string Categoria, decimal Realizado);

public record ResumoDto(
    decimal ReceitasRecebidas, decimal DespesasPagas, decimal SaldoRealizado,
    decimal ReceitasPendentes, decimal DespesasPendentes, decimal SaldoPrevisto,
    List<DespesaCategoriaDto> DespesasPorCategoria);

// ---------- Painel ----------
public record BlocoDto(decimal Pagas, decimal Pendentes, decimal Total, int Quantidade);
public record ItemFixoDto(int Id, string Descricao, string Categoria, DateOnly Data, decimal Valor, StatusLancamento Status);
public record BlocoComItensDto(decimal Pagas, decimal Pendentes, decimal Total, int Quantidade, List<ItemFixoDto> Itens);

// ---------- Cartões ----------
public class PagarFaturaRequest
{
    public string? Mes { get; set; }
}

// ---------- Metas ----------
public class MetaRequest
{
    public string? Nome { get; set; }
    public decimal? Alvo { get; set; }
    public string? Prazo { get; set; }
}

public class AporteRequest
{
    public decimal? Valor { get; set; }
    public bool? Retirada { get; set; }
    public string? Data { get; set; }
    public string? Nota { get; set; }
}

public record AporteDto(int Id, DateOnly Data, decimal Valor, string Nota);
public record MetaDto(int Id, string Nome, decimal Alvo, DateOnly? Prazo, decimal Guardado, decimal Falta, double Percentual,
    string Situacao, int? MesesRestantes, decimal? MensalSugerido, List<AporteDto> Aportes);

// ---------- Configurações (lembretes e backup) ----------
public class ConfigRequest
{
    public LembretesRequest? Lembretes { get; set; }
    public BackupConfigRequest? Backup { get; set; }
    /// <summary>{ "secao": { "visivel"?: bool, "tipo"?: string } } — lido à mão para dar as mesmas mensagens do app local.</summary>
    public System.Text.Json.JsonElement Painel { get; set; } // ausente = Undefined; null explícito = Null (inválido)
}
public class LembretesRequest
{
    public bool? Ativo { get; set; }
    public int? DiasAntes { get; set; }
    public int? Hora { get; set; }
    public bool? Detalhes { get; set; }
}
public class BackupConfigRequest
{
    public bool? Automatico { get; set; }
}
public class RegistrarBackupRequest
{
    public bool? Automatico { get; set; }
}

// ---------- Troca de senha por e-mail ----------
public class EsqueciSenhaRequest
{
    [Required(ErrorMessage = "Informe o e-mail."), StringLength(256)]
    public string Email { get; set; } = "";
}

public class RedefinirSenhaRequest
{
    [Required(ErrorMessage = "Link inválido."), StringLength(256)]
    public string Email { get; set; } = "";

    [Required(ErrorMessage = "Link inválido."), StringLength(2000)]
    public string Token { get; set; } = "";

    [Required(ErrorMessage = "Informe a nova senha."), StringLength(100)]
    public string NovaSenha { get; set; } = "";
}
