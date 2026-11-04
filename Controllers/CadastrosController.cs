using ControleFinanceiro.Data;
using ControleFinanceiro.Dtos;
using ControleFinanceiro.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace ControleFinanceiro.Controllers;

[Route("api/categorias")]
public class CategoriasController(AppDbContext db) : ApiBase
{
    [HttpGet]
    public async Task<IActionResult> Listar()
    {
        var userId = UserId;
        var itens = await db.Categorias.AsNoTracking()
            .Where(c => c.UserId == userId)
            .OrderBy(c => c.Tipo).ThenBy(c => c.Nome)
            .Select(c => new CategoriaDto(c.Id, c.Nome, c.Tipo, c.LimiteMensal))
            .ToListAsync();
        return Ok(itens);
    }

    [HttpPost]
    public async Task<IActionResult> Criar(CategoriaRequest req)
    {
        var userId = UserId;
        var nome = req.Nome.Trim();
        if (await db.Categorias.AnyAsync(c => c.UserId == userId && c.Nome == nome))
            return Conflito("Já existe uma categoria com esse nome.");

        var c = new Categoria
        {
            UserId = userId, Nome = nome, Tipo = req.Tipo!.Value,
            LimiteMensal = req.Tipo == TipoLancamento.Despesa ? 0 : null
        };
        db.Categorias.Add(c);
        await db.SaveChangesAsync();
        return Ok(new CategoriaDto(c.Id, c.Nome, c.Tipo, c.LimiteMensal));
    }

    [HttpPut("{id:int}")]
    public async Task<IActionResult> Atualizar(int id, CategoriaRequest req)
    {
        var userId = UserId;
        var c = await db.Categorias.FirstOrDefaultAsync(x => x.Id == id && x.UserId == userId);
        if (c is null) return NaoEncontrado();

        var nome = req.Nome.Trim();
        if (await db.Categorias.AnyAsync(x => x.UserId == userId && x.Nome == nome && x.Id != id))
            return Conflito("Já existe uma categoria com esse nome.");

        if (c.Tipo != req.Tipo && await db.Lancamentos.AnyAsync(l => l.CategoriaId == id))
            return Conflito("Não é possível mudar o tipo de uma categoria que já possui lançamentos.");

        c.Nome = nome;
        c.Tipo = req.Tipo!.Value;
        c.LimiteMensal = c.Tipo == TipoLancamento.Despesa ? (c.LimiteMensal ?? 0) : null;
        await db.SaveChangesAsync();
        return NoContent();
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Excluir(int id)
    {
        var userId = UserId;
        var c = await db.Categorias.FirstOrDefaultAsync(x => x.Id == id && x.UserId == userId);
        if (c is null) return NaoEncontrado();

        if (await db.Lancamentos.AnyAsync(l => l.CategoriaId == id))
            return Conflito("Esta categoria possui lançamentos e não pode ser excluída.");

        db.Categorias.Remove(c);
        await db.SaveChangesAsync();
        return NoContent();
    }
}

[Route("api/contas")]
public class ContasController(AppDbContext db) : ApiBase
{
    [HttpGet]
    public async Task<IActionResult> Listar()
    {
        var userId = UserId;
        var itens = await db.Contas.AsNoTracking()
            .Where(c => c.UserId == userId)
            .OrderBy(c => c.Nome)
            .Select(c => new { c.Id, c.Nome, c.CartaoFechamento, c.CartaoVencimento })
            .ToListAsync();
        return Ok(itens.Select(c => Dto(c.Id, c.Nome, c.CartaoFechamento, c.CartaoVencimento)));
    }

    private static ContaDto Dto(int id, string nome, int? fechamento, int? vencimento) =>
        new(id, nome, fechamento.HasValue && vencimento.HasValue ? new CartaoDto(fechamento.Value, vencimento.Value) : null);

    /// <summary>Valida o cartão informado. Devolve a mensagem de erro, ou null se estiver ok (ou não informado).</summary>
    private static string? ValidarCartao(ContaRequest req)
    {
        if (!req.CartaoInformado || req.Cartao is null) return null;
        return Services.Regras.DiaCartaoValido(req.Cartao.Fechamento) && Services.Regras.DiaCartaoValido(req.Cartao.Vencimento)
            ? null : Services.Regras.MsgCartao;
    }

    [HttpPost]
    public async Task<IActionResult> Criar(ContaRequest req)
    {
        var userId = UserId;
        var nome = req.Nome.Trim();
        if (string.IsNullOrEmpty(nome)) return Erro("Informe o nome.");
        if (ValidarCartao(req) is string erroCartao) return Erro(erroCartao);
        if (await db.Contas.AnyAsync(c => c.UserId == userId && c.Nome == nome))
            return Conflito("Já existe uma conta com esse nome.");

        var c = new Conta { UserId = userId, Nome = nome, CartaoFechamento = req.Cartao?.Fechamento, CartaoVencimento = req.Cartao?.Vencimento };
        db.Contas.Add(c);
        await db.SaveChangesAsync();
        return Ok(Dto(c.Id, c.Nome, c.CartaoFechamento, c.CartaoVencimento));
    }

    [HttpPut("{id:int}")]
    public async Task<IActionResult> Atualizar(int id, ContaRequest req)
    {
        var userId = UserId;
        var nome = req.Nome.Trim();
        if (string.IsNullOrEmpty(nome)) return Erro("Informe o nome.");
        if (ValidarCartao(req) is string erroCartao) return Erro(erroCartao);
        var c = await db.Contas.FirstOrDefaultAsync(x => x.Id == id && x.UserId == userId);
        if (c is null) return NaoEncontrado();

        if (await db.Contas.AnyAsync(x => x.UserId == userId && x.Nome == nome && x.Id != id))
            return Conflito("Já existe uma conta com esse nome.");

        c.Nome = nome;
        if (req.CartaoInformado) // cliente que não manda "cartao" não apaga a configuração
        {
            c.CartaoFechamento = req.Cartao?.Fechamento;
            c.CartaoVencimento = req.Cartao?.Vencimento;
        }
        await db.SaveChangesAsync();
        return NoContent();
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Excluir(int id)
    {
        var userId = UserId;
        var c = await db.Contas.FirstOrDefaultAsync(x => x.Id == id && x.UserId == userId);
        if (c is null) return NaoEncontrado();

        if (await db.Lancamentos.AnyAsync(l => l.ContaId == id))
            return Conflito("Esta conta possui lançamentos e não pode ser excluída.");

        db.Contas.Remove(c);
        await db.SaveChangesAsync();
        return NoContent();
    }
}
