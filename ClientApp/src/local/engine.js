// Motor do modo local.
//
// Reproduz, dentro do aparelho, as regras que a API em C# aplica (Controllers/*.cs): mesmas rotas, mesmas
// validações, mesmas mensagens de erro e mesmo formato de resposta. Assim as telas React funcionam sem
// alteração, falando com o aparelho em vez de um servidor.
//
// Este arquivo é PURO: não acessa navegador, disco nem rede. Recebe o estado e devolve o resultado, o que
// permite testá-lo com `node --test` (veja engine.test.js). O armazenamento fica em armazenamento.js.
//
// Valores em dinheiro são guardados em CENTAVOS (inteiros) para evitar erros de ponto flutuante
// (0,1 + 0,2 != 0,3 em JavaScript) e só viram reais na resposta.

export class ErroLocal extends Error {
  constructor(mensagem, status = 400) {
    super(mensagem);
    this.name = 'ErroLocal';
    this.status = status;
  }
}

export const VERSAO_DADOS = 1;

export const CATEGORIAS_RECEITA = ['Salário', 'Freelance', 'Investimentos'];
export const CATEGORIAS_DESPESA = [
  'Moradia', 'Alimentação', 'Transporte', 'Saúde', 'Educação', 'Lazer',
  'Assinaturas', 'Compras', 'Contas e impostos', 'Viagem', 'Outros',
];
export const CONTAS_PADRAO = ['Conta corrente', 'Dinheiro', 'Cartão de crédito', 'Poupança/Investimentos', 'Outro'];

const TIPOS = ['Receita', 'Despesa'];
const STATUS = ['Pendente', 'PagoRecebido'];
const LIMITE_MAXIMO_CENTAVOS = 99_999_999_999; // 999.999.999,99 (mesmo teto da API)

// ---------- Estado ----------

export function criarEstadoInicial() {
  const estado = {
    versao: VERSAO_DADOS, seq: { categoria: 0, conta: 0, lancamento: 0, meta: 0, aporte: 0 },
    categorias: [], contas: [], lancamentos: [], metas: [],
  };
  for (const nome of CATEGORIAS_RECEITA) {
    estado.categorias.push({ id: ++estado.seq.categoria, nome, tipo: 'Receita', limiteCentavos: null });
  }
  for (const nome of CATEGORIAS_DESPESA) {
    estado.categorias.push({ id: ++estado.seq.categoria, nome, tipo: 'Despesa', limiteCentavos: 0 });
  }
  for (const nome of CONTAS_PADRAO) estado.contas.push({ id: ++estado.seq.conta, nome, cartao: null });
  estado.config = configPadrao();
  return estado;
}

// ---------- Configurações do aparelho (lembretes e backup) ----------

export const ANTECEDENCIAS = [0, 1, 2, 3, 5, 7]; // dias antes do vencimento para avisar
export const DIAS_PARA_LEMBRAR_BACKUP = 7;

// Seções do painel (tela Resumo) e os tipos de gráfico que cada uma aceita. O primeiro é o padrão.
export const SECOES_PAINEL = Object.freeze({
  indicadores: ['cartoes'],
  despesasCategoria: ['barras', 'pizza', 'rosca'],
  orcamento: ['barras'],
  fixas: ['barras', 'pizza', 'rosca'],
  fixasVariaveis: ['barras', 'pizza', 'rosca'],
  evolucao: ['barras', 'linhas'],
  ritmo: ['lista'],
  maioresDespesas: ['lista', 'barras'],
});

export function painelPadrao() {
  return Object.fromEntries(Object.entries(SECOES_PAINEL).map(([id, tipos]) => [id, { visivel: true, tipo: tipos[0] }]));
}

/** Preferências do painel lidas com tolerância: seção desconhecida é ignorada; valor errado volta ao padrão. */
function normalizarPainel(p) {
  return Object.fromEntries(Object.entries(SECOES_PAINEL).map(([id, tipos]) => {
    const s = p?.[id] ?? {};
    return [id, { visivel: typeof s.visivel === 'boolean' ? s.visivel : true, tipo: tipos.includes(s.tipo) ? s.tipo : tipos[0] }];
  }));
}

export function configPadrao() {
  return {
    lembretes: { ativo: false, diasAntes: 1, hora: 9, detalhes: true },
    backup: { automatico: false, ultimo: null, ultimoAutomatico: null },
    painel: painelPadrao(),
  };
}

const instanteValido = (v) => typeof v === 'string' && v.length <= 40 && !Number.isNaN(Date.parse(v));
const horaValida = (v) => Number.isInteger(v) && v >= 0 && v <= 23;

/** Lê a configuração gravada (ou de um backup) com tolerância: o que faltar ou estiver errado volta ao padrão. */
function normalizarConfig(c) {
  const p = configPadrao();
  const l = c?.lembretes ?? {};
  const b = c?.backup ?? {};
  return {
    lembretes: {
      ativo: typeof l.ativo === 'boolean' ? l.ativo : p.lembretes.ativo,
      diasAntes: ANTECEDENCIAS.includes(l.diasAntes) ? l.diasAntes : p.lembretes.diasAntes,
      hora: horaValida(l.hora) ? l.hora : p.lembretes.hora,
      detalhes: typeof l.detalhes === 'boolean' ? l.detalhes : p.lembretes.detalhes,
    },
    backup: {
      automatico: typeof b.automatico === 'boolean' ? b.automatico : p.backup.automatico,
      ultimo: instanteValido(b.ultimo) ? b.ultimo : null,
      ultimoAutomatico: instanteValido(b.ultimoAutomatico) ? b.ultimoAutomatico : null,
    },
    painel: normalizarPainel(c?.painel),
  };
}

// ---------- Utilidades ----------

const emCentavos = (valor) => Math.round(Number(valor) * 100);
const emReais = (centavos) => centavos / 100;
const mesmoNome = (a, b) => a.toLocaleLowerCase('pt-BR') === b.toLocaleLowerCase('pt-BR');
const porTexto = (a, b) => a.localeCompare(b, 'pt-BR');
const naoEncontrado = () => new ErroLocal('Registro não encontrado.', 404);
const conflito = (msg) => new ErroLocal(msg, 409);

const dois = (n) => String(n).padStart(2, '0');
export function hojeISO(data = new Date()) {
  return `${data.getFullYear()}-${dois(data.getMonth() + 1)}-${dois(data.getDate())}`;
}

/** Data válida no formato aaaa-mm-dd (rejeita 2026-02-31). */
function dataValida(texto) {
  if (typeof texto !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(texto)) return false;
  const [a, m, d] = texto.split('-').map(Number);
  const dt = new Date(Date.UTC(a, m - 1, d));
  return dt.getUTCFullYear() === a && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** "aaaa-mm" (ou vazio = mês atual) -> "aaaa-mm". Mesma regra de Services/Periodo.cs. */
function lerMes(mes, hoje) {
  if (mes === null || mes === undefined || String(mes).trim() === '') return hoje.slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) throw new ErroLocal('Mês inválido. Use o formato AAAA-MM.', 400);
  return mes;
}

const doMes = (estado, mes) => estado.lancamentos.filter((l) => l.data.slice(0, 7) === mes);

/** 'aaaa-mm-dd' + n dias. */
function somarDias(data, n) {
  const d = new Date(Date.UTC(Number(data.slice(0, 4)), Number(data.slice(5, 7)) - 1, Number(data.slice(8, 10)) + n));
  return `${d.getUTCFullYear()}-${dois(d.getUTCMonth() + 1)}-${dois(d.getUTCDate())}`;
}

/** Dia `dia` do mês `mes`, ou o último dia se o mês for menor (31 -> 28/fev). */
const diaDoMes = (mes, dia) => `${mes}-${dois(Math.min(dia, diasNoMes(mes)))}`;

// ---------- Cartão de crédito ----------
//
// Uma conta pode ser um cartão: { fechamento, vencimento } (dias de 1 a 31; em meses menores vale o último dia).
// Compras feitas ATÉ o dia do fechamento (inclusive) entram na fatura que fecha naquele mês; depois dele, na do
// mês seguinte. A fatura vence no dia de vencimento seguinte ao fechamento. Cada fatura é identificada pelo
// MÊS DO VENCIMENTO ('aaaa-mm'), que é o mês em que o dinheiro sai.

function datasDaFatura(cartao, mesFechamento) {
  const fechamento = diaDoMes(mesFechamento, cartao.fechamento);
  const mesVencimento = cartao.vencimento > cartao.fechamento ? mesFechamento : somarMeses(mesFechamento, 1);
  return { mes: mesVencimento, fechamento, vencimento: diaDoMes(mesVencimento, cartao.vencimento) };
}

/** Fatura em que cai uma compra feita em `data`. */
export function faturaDaCompra(cartao, data) {
  const mesCompra = data.slice(0, 7);
  const mesFechamento = data <= diaDoMes(mesCompra, cartao.fechamento) ? mesCompra : somarMeses(mesCompra, 1);
  return datasDaFatura(cartao, mesFechamento);
}

/** Fatura que vence no mês `mes`, com o período de compras que ela cobre. */
export function faturaDoMes(cartao, mes) {
  const mesFechamento = cartao.vencimento > cartao.fechamento ? mes : somarMeses(mes, -1);
  const f = datasDaFatura(cartao, mesFechamento);
  const anterior = datasDaFatura(cartao, somarMeses(mesFechamento, -1));
  return { ...f, inicio: somarDias(anterior.fechamento, 1) };
}

const diaCartaoValido = (v) => Number.isInteger(v) && v >= 1 && v <= 31;
const MSG_CARTAO = 'Informe o dia de fechamento e o de vencimento do cartão (1 a 31).';

/** Corpo da API: undefined = não mexe; null = não é cartão; objeto = valida. */
function lerCartao(valor) {
  if (valor === undefined) return undefined;
  if (valor === null) return null;
  if (typeof valor !== 'object' || !diaCartaoValido(valor.fechamento) || !diaCartaoValido(valor.vencimento)) {
    throw new ErroLocal(MSG_CARTAO, 400);
  }
  return { fechamento: valor.fechamento, vencimento: valor.vencimento };
}
const cartaoDaConta = (estado, contaId) => estado.contas.find((c) => c.id === contaId)?.cartao ?? null;

/** Soma `delta` meses a "aaaa-mm" (aceita negativos e atravessa a virada do ano). */
export function somarMeses(mes, delta) {
  const [a, m] = mes.split('-').map(Number);
  const total = a * 12 + (m - 1) + delta;
  return `${Math.floor(total / 12)}-${dois(total % 12 + 1)}`;
}

/** Quantos dias tem o mês "aaaa-mm". */
export function diasNoMes(mes) {
  const [a, m] = mes.split('-').map(Number);
  return new Date(Date.UTC(a, m, 0)).getUTCDate();
}

function lerId(texto) {
  const id = Number(texto);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function inteiroObrigatorio(valor, mensagem) {
  const n = typeof valor === 'string' && valor.trim() !== '' ? Number(valor) : valor;
  if (!Number.isInteger(n)) throw new ErroLocal(mensagem, 400);
  return n;
}

function enumObrigatorio(valor, validos, ausente, invalido) {
  if (valor === null || valor === undefined || valor === '') throw new ErroLocal(ausente, 400);
  if (!validos.includes(valor)) throw new ErroLocal(invalido, 400);
  return valor;
}

function nomeObrigatorio(corpo) {
  const nome = String(corpo?.nome ?? '').trim();
  if (!nome) throw new ErroLocal('Informe o nome.', 400);
  if (nome.length > 60) throw new ErroLocal('O nome deve ter no máximo 60 caracteres.', 400);
  return nome;
}

// ---------- Mapeamentos (formato das respostas da API) ----------

const dtoCategoria = (c) => ({
  id: c.id, nome: c.nome, tipo: c.tipo, limiteMensal: c.limiteCentavos === null ? null : emReais(c.limiteCentavos),
});

function dtoLancamento(estado, l) {
  const cat = estado.categorias.find((c) => c.id === l.categoriaId);
  const conta = estado.contas.find((c) => c.id === l.contaId);
  return {
    id: l.id, data: l.data, tipo: l.tipo, categoriaId: l.categoriaId, categoria: cat?.nome ?? '',
    descricao: l.descricao, contaId: l.contaId, conta: conta?.nome ?? '', valor: emReais(l.valorCentavos), status: l.status,
    fixa: l.fixa === true,
    parcela: l.parcela ? { ...l.parcela } : null,
    // Mês de vencimento da fatura, quando a conta é um cartão de crédito.
    fatura: conta?.cartao ? faturaDaCompra(conta.cartao, l.data).mes : null,
  };
}

// ---------- Categorias ----------

function categorias(estado, metodo, id, corpo) {
  if (metodo === 'GET' && id === null) {
    const itens = [...estado.categorias]
      .sort((a, b) => porTexto(a.tipo, b.tipo) || porTexto(a.nome, b.nome))
      .map(dtoCategoria);
    return { status: 200, corpo: itens };
  }

  if (metodo === 'POST' && id === null) {
    const nome = nomeObrigatorio(corpo);
    const tipo = enumObrigatorio(corpo?.tipo, TIPOS, 'Informe o tipo.', 'Tipo inválido.');
    if (estado.categorias.some((c) => mesmoNome(c.nome, nome))) throw conflito('Já existe uma categoria com esse nome.');

    const c = { id: ++estado.seq.categoria, nome, tipo, limiteCentavos: tipo === 'Despesa' ? 0 : null };
    estado.categorias.push(c);
    return { status: 200, corpo: dtoCategoria(c), alterou: true };
  }

  if (metodo === 'PUT' && id !== null) {
    const nome = nomeObrigatorio(corpo);
    const tipo = enumObrigatorio(corpo?.tipo, TIPOS, 'Informe o tipo.', 'Tipo inválido.');
    const c = estado.categorias.find((x) => x.id === id);
    if (!c) throw naoEncontrado();
    if (estado.categorias.some((x) => x.id !== id && mesmoNome(x.nome, nome))) throw conflito('Já existe uma categoria com esse nome.');
    if (c.tipo !== tipo && estado.lancamentos.some((l) => l.categoriaId === id)) {
      throw conflito('Não é possível mudar o tipo de uma categoria que já possui lançamentos.');
    }
    c.nome = nome;
    c.tipo = tipo;
    c.limiteCentavos = tipo === 'Despesa' ? (c.limiteCentavos ?? 0) : null;
    return { status: 204, corpo: null, alterou: true };
  }

  if (metodo === 'DELETE' && id !== null) {
    const c = estado.categorias.find((x) => x.id === id);
    if (!c) throw naoEncontrado();
    if (estado.lancamentos.some((l) => l.categoriaId === id)) throw conflito('Esta categoria possui lançamentos e não pode ser excluída.');
    estado.categorias = estado.categorias.filter((x) => x.id !== id);
    return { status: 204, corpo: null, alterou: true };
  }
  return null;
}

// ---------- Contas ----------

const dtoConta = (c) => ({ id: c.id, nome: c.nome, cartao: c.cartao ? { ...c.cartao } : null });

function contas(estado, metodo, id, corpo) {
  if (metodo === 'GET' && id === null) {
    return { status: 200, corpo: [...estado.contas].sort((a, b) => porTexto(a.nome, b.nome)).map(dtoConta) };
  }

  if (metodo === 'POST' && id === null) {
    const nome = nomeObrigatorio(corpo);
    const cartao = lerCartao(corpo?.cartao) ?? null;
    if (estado.contas.some((c) => mesmoNome(c.nome, nome))) throw conflito('Já existe uma conta com esse nome.');
    const c = { id: ++estado.seq.conta, nome, cartao };
    estado.contas.push(c);
    return { status: 200, corpo: dtoConta(c), alterou: true };
  }

  if (metodo === 'PUT' && id !== null) {
    const nome = nomeObrigatorio(corpo);
    const cartao = lerCartao(corpo?.cartao);
    const c = estado.contas.find((x) => x.id === id);
    if (!c) throw naoEncontrado();
    if (estado.contas.some((x) => x.id !== id && mesmoNome(x.nome, nome))) throw conflito('Já existe uma conta com esse nome.');
    c.nome = nome;
    if (cartao !== undefined) c.cartao = cartao; // cliente que não manda "cartao" não apaga a configuração
    return { status: 204, corpo: null, alterou: true };
  }

  if (metodo === 'DELETE' && id !== null) {
    const c = estado.contas.find((x) => x.id === id);
    if (!c) throw naoEncontrado();
    if (estado.lancamentos.some((l) => l.contaId === id)) throw conflito('Esta conta possui lançamentos e não pode ser excluída.');
    estado.contas = estado.contas.filter((x) => x.id !== id);
    return { status: 204, corpo: null, alterou: true };
  }
  return null;
}

// ---------- Lançamentos ----------

/** Valida o corpo como a API faz (DataAnnotations + ValidarAsync) e devolve os campos já normalizados. */
/** `fixa` é opcional: ausente = mantém o valor atual (`atual`) ou falso. Receitas e despesas podem ser fixas. */
function lerFixa(valor, atual) {
  if (valor === undefined || valor === null) return atual === true;
  if (typeof valor !== 'boolean') throw new ErroLocal('Valor inválido para lançamento fixo.', 400);
  return valor;
}

export const MAX_PARCELAS = 60;

/** Quantidade de parcelas: ausente = 1 (à vista). */
function lerParcelas(valor) {
  if (valor === undefined || valor === null || valor === 1) return 1;
  if (!Number.isInteger(valor) || valor < 1 || valor > MAX_PARCELAS) {
    throw new ErroLocal(`Informe de 1 a ${MAX_PARCELAS} parcelas.`, 400);
  }
  return valor;
}

function lerLancamento(estado, corpo, atual = null) {
  const c = corpo ?? {};
  if (c.data === null || c.data === undefined || c.data === '') throw new ErroLocal('Informe a data.', 400);
  if (!dataValida(c.data)) throw new ErroLocal('Data inválida.', 400);
  const tipo = enumObrigatorio(c.tipo, TIPOS, 'Informe o tipo.', 'Tipo inválido.');
  const categoriaId = inteiroObrigatorio(c.categoriaId, 'Selecione a categoria.');

  const descricao = String(c.descricao ?? '').trim();
  if (!descricao) throw new ErroLocal('Informe a descrição.', 400);
  if (descricao.length > 200) throw new ErroLocal('A descrição deve ter no máximo 200 caracteres.', 400);

  const contaId = inteiroObrigatorio(c.contaId, 'Selecione a conta.');

  const valor = Number(c.valor);
  const valorCentavos = emCentavos(valor);
  if (!Number.isFinite(valor) || valor < 0.01 || valorCentavos > LIMITE_MAXIMO_CENTAVOS || valorCentavos < 1) {
    throw new ErroLocal('O valor deve ser maior que zero.', 400);
  }
  const status = enumObrigatorio(c.status, STATUS, 'Informe o status.', 'Status inválido.');

  const cat = estado.categorias.find((x) => x.id === categoriaId);
  if (!cat) throw new ErroLocal('Categoria inválida.', 400);
  if (cat.tipo !== tipo) throw new ErroLocal('A categoria selecionada não corresponde ao tipo do lançamento.', 400);
  if (!estado.contas.some((x) => x.id === contaId)) throw new ErroLocal('Conta inválida.', 400);

  const fixa = lerFixa(c.fixa, atual?.fixa);

  return { data: c.data, tipo, categoriaId, descricao, contaId, valorCentavos, status, fixa };
}

function lancamentos(estado, metodo, id, corpo, consulta, hoje, subrota) {
  if (metodo === 'GET' && id === null) {
    const mes = lerMes(consulta.get('mes'), hoje);
    let itens = doMes(estado, mes);

    // Os filtros são validados ANTES de filtrar, para que um valor inválido sempre gere erro (mesmo sem itens).
    const tipo = consulta.get('tipo') ? enumObrigatorio(consulta.get('tipo'), TIPOS, '', 'Tipo inválido.') : null;
    const status = consulta.get('status') ? enumObrigatorio(consulta.get('status'), STATUS, '', 'Status inválido.') : null;
    const categoriaId = consulta.get('categoriaId') ? inteiroObrigatorio(consulta.get('categoriaId'), 'categoriaId inválido.') : null;
    const contaId = consulta.get('contaId') ? inteiroObrigatorio(consulta.get('contaId'), 'contaId inválido.') : null;
    const fixaTexto = consulta.get('fixa');
    if (fixaTexto && !['true', 'false'].includes(fixaTexto)) throw new ErroLocal('Valor de "fixa" inválido. Use true ou false.', 400);
    if (fixaTexto) itens = itens.filter((l) => (l.fixa === true) === (fixaTexto === 'true'));
    if (tipo) itens = itens.filter((l) => l.tipo === tipo);
    if (status) itens = itens.filter((l) => l.status === status);
    if (categoriaId !== null) itens = itens.filter((l) => l.categoriaId === categoriaId);
    if (contaId !== null) itens = itens.filter((l) => l.contaId === contaId);
    const busca = (consulta.get('busca') ?? '').trim();
    if (busca) {
      const termo = busca.toLocaleLowerCase('pt-BR');
      itens = itens.filter((l) => l.descricao.toLocaleLowerCase('pt-BR').includes(termo));
    }

    itens = [...itens].sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : b.id - a.id));
    return { status: 200, corpo: itens.map((l) => dtoLancamento(estado, l)) };
  }

  if (metodo === 'POST' && id === null) {
    const dados = lerLancamento(estado, corpo);
    const n = lerParcelas(corpo?.parcelas);
    if (n === 1) {
      const l = { id: ++estado.seq.lancamento, ...dados, parcela: null, criadoEm: new Date().toISOString() };
      estado.lancamentos.push(l);
      return { status: 200, corpo: { id: l.id }, alterou: true };
    }
    if (dados.fixa) throw new ErroLocal('Um lançamento parcelado não pode ser fixo.', 400);
    if (dados.valorCentavos < n) throw new ErroLocal('O valor total é pequeno demais para tantas parcelas.', 400);

    // O valor informado é o TOTAL. Divide em centavos; a diferença do arredondamento fica na 1ª parcela.
    const base = Math.floor(dados.valorCentavos / n);
    const resto = dados.valorCentavos - base * n;
    const dia = Number(dados.data.slice(8, 10));
    const grupo = estado.seq.lancamento + 1;
    const criadoEm = new Date().toISOString();
    const ids = [];
    for (let k = 0; k < n; k += 1) {
      const l = {
        id: ++estado.seq.lancamento, ...dados,
        data: diaDoMes(somarMeses(dados.data.slice(0, 7), k), dia),
        valorCentavos: base + (k === 0 ? resto : 0),
        status: k === 0 ? dados.status : 'Pendente',
        parcela: { grupo, numero: k + 1, total: n },
        criadoEm,
      };
      estado.lancamentos.push(l);
      ids.push(l.id);
    }
    return { status: 200, corpo: { id: ids[0], ids, parcelas: n }, alterou: true };
  }

  if (metodo === 'PUT' && id !== null && !subrota) {
    const l = estado.lancamentos.find((x) => x.id === id);
    if (!l) throw naoEncontrado();
    const dados = lerLancamento(estado, corpo, l);
    if (l.parcela && dados.fixa) throw new ErroLocal('Um lançamento parcelado não pode ser fixo.', 400);
    Object.assign(l, dados); // a parcela (1/10...) não muda ao editar: cada parcela é editada sozinha
    return { status: 204, corpo: null, alterou: true };
  }

  if (metodo === 'PATCH' && id !== null && subrota === 'status') {
    const status = enumObrigatorio(corpo?.status, STATUS, 'Informe o status.', 'Status inválido.');
    const l = estado.lancamentos.find((x) => x.id === id);
    if (!l) throw naoEncontrado();
    l.status = status;
    return { status: 204, corpo: null, alterou: true };
  }

  if (metodo === 'PATCH' && id !== null && subrota === 'fixa') {
    if (typeof corpo?.fixa !== 'boolean') throw new ErroLocal('Informe se o lançamento é fixo (true ou false).', 400);
    const l = estado.lancamentos.find((x) => x.id === id);
    if (!l) throw naoEncontrado();
    if (l.parcela && corpo.fixa) throw new ErroLocal('Um lançamento parcelado não pode ser fixo.', 400);
    l.fixa = lerFixa(corpo.fixa, l.fixa);
    return { status: 204, corpo: null, alterou: true };
  }

  if (metodo === 'DELETE' && id !== null && !subrota) {
    const l = estado.lancamentos.find((x) => x.id === id);
    if (!l) throw naoEncontrado();
    // ?parcelas=seguintes (esta e as próximas) | todas. Sem o parâmetro, só esta.
    const modo = consulta.get('parcelas');
    if (modo !== null && !['seguintes', 'todas'].includes(modo)) {
      throw new ErroLocal('Valor de "parcelas" inválido. Use seguintes ou todas.', 400);
    }
    if (modo === null) {
      estado.lancamentos = estado.lancamentos.filter((x) => x.id !== id);
      return { status: 204, corpo: null, alterou: true };
    }
    const sai = (x) => x.id === id || (l.parcela && x.parcela?.grupo === l.parcela.grupo
      && (modo === 'todas' || x.parcela.numero >= l.parcela.numero));
    const antes = estado.lancamentos.length;
    estado.lancamentos = estado.lancamentos.filter((x) => !sai(x));
    return { status: 200, corpo: { removidos: antes - estado.lancamentos.length }, alterou: true };
  }
  return null;
}

// ---------- Resumo e Orçamento ----------

/** Total pago, por categoria de despesa, no mês. Realizado = apenas "PagoRecebido". */
function gastosPorCategoria(estado, mes) {
  const gastos = new Map();
  for (const l of doMes(estado, mes)) {
    if (l.tipo === 'Despesa' && l.status === 'PagoRecebido') {
      gastos.set(l.categoriaId, (gastos.get(l.categoriaId) ?? 0) + l.valorCentavos);
    }
  }
  return gastos;
}

function resumo(estado, metodo, consulta, hoje) {
  if (metodo !== 'GET') return null;
  const mes = lerMes(consulta.get('mes'), hoje);
  const itens = doMes(estado, mes);
  const soma = (tipo, status) =>
    itens.filter((l) => l.tipo === tipo && l.status === status).reduce((s, l) => s + l.valorCentavos, 0);

  const recebidas = soma('Receita', 'PagoRecebido');
  const pagas = soma('Despesa', 'PagoRecebido');
  const recPend = soma('Receita', 'Pendente');
  const despPend = soma('Despesa', 'Pendente');

  const gastos = gastosPorCategoria(estado, mes);
  const despesasPorCategoria = estado.categorias
    .filter((c) => c.tipo === 'Despesa')
    .map((c) => ({ categoria: c.nome, realizado: gastos.get(c.id) ?? 0 }))
    .sort((a, b) => b.realizado - a.realizado || porTexto(a.categoria, b.categoria))
    .map((x) => ({ categoria: x.categoria, realizado: emReais(x.realizado) }));

  return {
    status: 200,
    corpo: {
      receitasRecebidas: emReais(recebidas),
      despesasPagas: emReais(pagas),
      saldoRealizado: emReais(recebidas - pagas),
      receitasPendentes: emReais(recPend),
      despesasPendentes: emReais(despPend),
      saldoPrevisto: emReais(recebidas - pagas + recPend - despPend),
      despesasPorCategoria,
    },
  };
}

function orcamento(estado, metodo, corpo, consulta, hoje) {
  if (metodo === 'GET') {
    const mes = lerMes(consulta.get('mes'), hoje);
    const gastos = gastosPorCategoria(estado, mes);
    const corpoResposta = estado.categorias
      .filter((c) => c.tipo === 'Despesa')
      .sort((a, b) => porTexto(a.nome, b.nome))
      .map((c) => {
        const limite = c.limiteCentavos ?? 0;
        const realizado = gastos.get(c.id) ?? 0;
        const percentual = limite === 0 ? 0 : Math.round((realizado / limite) * 1000) / 10;
        return {
          categoriaId: c.id, categoria: c.nome, limite: emReais(limite), realizado: emReais(realizado),
          disponivel: emReais(limite - realizado), percentual,
        };
      });
    return { status: 200, corpo: corpoResposta };
  }

  if (metodo === 'PUT') {
    if (!Array.isArray(corpo)) throw new ErroLocal('Requisição inválida.', 400);
    const novos = corpo.map((l) => {
      const categoriaId = inteiroObrigatorio(l?.categoriaId, 'Informe a categoria.');
      const valor = l.limite === null || l.limite === undefined ? 0 : Number(l.limite);
      const centavos = emCentavos(valor);
      if (!Number.isFinite(valor) || valor < 0 || centavos > LIMITE_MAXIMO_CENTAVOS) {
        throw new ErroLocal('O limite não pode ser negativo.', 400);
      }
      return { categoriaId, centavos };
    });
    // Mesma regra da API: só altera categorias de despesa existentes; ids desconhecidos são ignorados.
    for (const { categoriaId, centavos } of novos) {
      const c = estado.categorias.find((x) => x.id === categoriaId && x.tipo === 'Despesa');
      if (c) c.limiteCentavos = centavos;
    }
    return { status: 204, corpo: null, alterou: true };
  }
  return null;
}

// ---------- Lançamentos fixos (receitas e despesas): copiar para outro mês ----------

const chaveFixa = (l) => `${l.tipo}|${l.descricao.trim().toLocaleLowerCase('pt-BR')}|${l.categoriaId}|${l.contaId}`;

/**
 * POST /api/lancamentos-fixos/copiar  { mes, origem? }   (também atende o nome antigo /api/despesas-fixas/copiar)
 * Recria, no mês `mes`, as receitas e despesas fixas do mês `origem` (padrão: o mês anterior) como PENDENTES, no
 * mesmo dia (ou no último dia do mês, se ele for menor: 31/jan -> 28/fev). Não duplica: se o mês já tem um
 * lançamento igual (mesmo tipo, descrição, categoria e conta), ele conta como "ignorado".
 */
function copiarFixas(estado, metodo, corpo, hoje) {
  if (metodo !== 'POST') return null;
  const mes = lerMes(corpo?.mes, hoje);
  const origem = corpo?.origem ? lerMes(corpo.origem, hoje) : somarMeses(mes, -1);
  if (origem === mes) throw new ErroLocal('O mês de origem deve ser diferente do mês de destino.', 400);

  const fixas = doMes(estado, origem).filter((l) => l.fixa === true).sort((a, b) => a.id - b.id);

  // Quantos lançamentos iguais já existem no destino (conta por chave, para tratar repetidos na origem).
  const existentes = new Map();
  for (const l of doMes(estado, mes)) existentes.set(chaveFixa(l), (existentes.get(chaveFixa(l)) ?? 0) + 1);

  const ultimoDia = diasNoMes(mes);
  let criadas = 0;
  let ignoradas = 0;
  const criadasPorTipo = { Receita: 0, Despesa: 0 };
  for (const f of fixas) {
    const k = chaveFixa(f);
    if ((existentes.get(k) ?? 0) > 0) {
      existentes.set(k, existentes.get(k) - 1);
      ignoradas += 1;
      continue;
    }
    const dia = Math.min(Number(f.data.slice(8, 10)), ultimoDia);
    estado.lancamentos.push({
      id: ++estado.seq.lancamento, data: `${mes}-${dois(dia)}`, tipo: f.tipo, categoriaId: f.categoriaId,
      descricao: f.descricao, contaId: f.contaId, valorCentavos: f.valorCentavos, status: 'Pendente',
      criadoEm: new Date().toISOString(), fixa: true,
    });
    criadas += 1;
    criadasPorTipo[f.tipo] += 1;
  }
  return {
    status: 200,
    corpo: {
      mes, origem, encontradas: fixas.length, criadas, ignoradas,
      receitasCriadas: criadasPorTipo.Receita, despesasCriadas: criadasPorTipo.Despesa,
    },
    alterou: criadas > 0,
  };
}

// ---------- Painel (dashboard) ----------

const um = (n) => Math.round(n * 10) / 10; // 1 casa decimal
const SEVERIDADE = { estourado: 0, alerta: 1, ok: 2, semLimite: 3 };

function situacaoOrcamento(limite, realizado) {
  if (limite <= 0) return 'semLimite';
  const pct = (realizado / limite) * 100;
  if (pct > 100) return 'estourado';
  if (pct >= 80) return 'alerta';
  return 'ok';
}

/** GET /api/dashboard?mes=aaaa-mm — todas as métricas da tela Resumo em uma chamada. */
function painel(estado, metodo, consulta, hoje) {
  if (metodo !== 'GET') return null;
  const mes = lerMes(consulta.get('mes'), hoje);
  const itens = doMes(estado, mes);
  const total = (lista) => lista.reduce((s, l) => s + l.valorCentavos, 0);
  const pagos = (lista) => lista.filter((l) => l.status === 'PagoRecebido');
  const pendentes = (lista) => lista.filter((l) => l.status === 'Pendente');
  const nomeCat = new Map(estado.categorias.map((c) => [c.id, c.nome]));

  const receitas = itens.filter((l) => l.tipo === 'Receita');
  const despesas = itens.filter((l) => l.tipo === 'Despesa');
  const recebidas = total(pagos(receitas));
  const pagas = total(pagos(despesas));

  // Fixas x variáveis
  const bloco = (lista) => ({
    pagas: emReais(total(pagos(lista))), pendentes: emReais(total(pendentes(lista))), total: emReais(total(lista)),
    quantidade: lista.length,
  });
  const fixas = despesas.filter((l) => l.fixa === true);
  const variaveis = despesas.filter((l) => l.fixa !== true);
  const totalDespesas = total(despesas);

  // Orçamento: só despesas pagas (mesma regra da tela Orçamento)
  const gastos = gastosPorCategoria(estado, mes);
  const pendPorCat = new Map();
  for (const l of pendentes(despesas)) pendPorCat.set(l.categoriaId, (pendPorCat.get(l.categoriaId) ?? 0) + l.valorCentavos);

  const categoriasDespesa = estado.categorias.filter((c) => c.tipo === 'Despesa');
  const linhas = categoriasDespesa.map((c) => {
    const limite = c.limiteCentavos ?? 0;
    const realizado = gastos.get(c.id) ?? 0;
    return {
      categoriaId: c.id, categoria: c.nome, limite, realizado, pendente: pendPorCat.get(c.id) ?? 0,
      situacao: situacaoOrcamento(limite, realizado),
      percentual: limite > 0 ? um((realizado / limite) * 100) : 0,
    };
  });
  const comLimite = linhas.filter((x) => x.limite > 0);
  const limiteTotal = comLimite.reduce((s, x) => s + x.limite, 0);
  const realizadoComLimite = comLimite.reduce((s, x) => s + x.realizado, 0);
  const semLimiteRealizado = linhas.filter((x) => x.limite <= 0).reduce((s, x) => s + x.realizado, 0);

  const categoriasOrcamento = linhas
    .filter((x) => x.limite > 0 || x.realizado > 0 || x.pendente > 0)
    .sort((a, b) => SEVERIDADE[a.situacao] - SEVERIDADE[b.situacao] || b.percentual - a.percentual || b.realizado - a.realizado || porTexto(a.categoria, b.categoria))
    .map((x) => ({
      categoriaId: x.categoriaId, categoria: x.categoria, limite: emReais(x.limite), realizado: emReais(x.realizado),
      pendente: emReais(x.pendente), disponivel: emReais(x.limite - x.realizado), percentual: x.percentual, situacao: x.situacao,
    }));

  // Comparação com o mês anterior
  const anterior = doMes(estado, somarMeses(mes, -1));
  const pagasAnterior = total(pagos(anterior.filter((l) => l.tipo === 'Despesa')));
  const recebidasAnterior = total(pagos(anterior.filter((l) => l.tipo === 'Receita')));

  // Ritmo de gasto (só despesas já pagas). Projeção apenas para o mês em andamento.
  const mesHoje = hoje.slice(0, 7);
  const dias = diasNoMes(mes);
  const decorridos = mes === mesHoje ? Number(hoje.slice(8, 10)) : mes < mesHoje ? dias : 0;
  const mediaDiaria = decorridos > 0 ? pagas / decorridos : 0;
  const projecao = mes === mesHoje ? Math.round(mediaDiaria * dias) : null;

  // Evolução: 6 meses terminando em `mes` (valores realizados)
  const evolucao = [];
  for (let i = 5; i >= 0; i -= 1) {
    const m = somarMeses(mes, -i);
    const doM = doMes(estado, m);
    evolucao.push({
      mes: m,
      receitas: emReais(total(pagos(doM.filter((l) => l.tipo === 'Receita')))),
      despesas: emReais(total(pagos(doM.filter((l) => l.tipo === 'Despesa')))),
    });
  }

  const maiores = [...despesas]
    .sort((a, b) => b.valorCentavos - a.valorCentavos || b.id - a.id)
    .slice(0, 5)
    .map((l) => ({
      id: l.id, descricao: l.descricao, categoria: nomeCat.get(l.categoriaId) ?? '', data: l.data,
      valor: emReais(l.valorCentavos), status: l.status, fixa: l.fixa === true,
    }));

  const listaFixos = (lista) => [...lista]
    .sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : a.id - b.id))
    .map((l) => ({
      id: l.id, descricao: l.descricao, categoria: nomeCat.get(l.categoriaId) ?? '', data: l.data,
      valor: emReais(l.valorCentavos), status: l.status,
    }));
  const receitasFixas = receitas.filter((l) => l.fixa === true);
  const totalReceitasFixas = total(receitasFixas);
  const totalDespesasFixas = total(fixas);

  return {
    status: 200,
    corpo: {
      mes,
      saldoRealizado: emReais(recebidas - pagas),
      despesas: bloco(despesas),
      receitas: bloco(receitas),
      fixas: { ...bloco(fixas), itens: listaFixos(fixas) },
      receitasFixas: { ...bloco(receitasFixas), itens: listaFixos(receitasFixas) },
      // Quanto sobra das receitas fixas depois das despesas fixas, e quanto delas as despesas fixas consomem.
      saldoFixo: emReais(totalReceitasFixas - totalDespesasFixas),
      comprometimentoFixo: totalReceitasFixas > 0 ? um((totalDespesasFixas / totalReceitasFixas) * 100) : null,
      variaveis: bloco(variaveis),
      percentualFixas: totalDespesas > 0 ? um((total(fixas) / totalDespesas) * 100) : 0,
      orcamento: {
        limiteTotal: emReais(limiteTotal),
        realizado: emReais(realizadoComLimite),
        disponivel: emReais(limiteTotal - realizadoComLimite),
        percentual: limiteTotal > 0 ? um((realizadoComLimite / limiteTotal) * 100) : 0,
        semLimiteRealizado: emReais(semLimiteRealizado),
        categoriasComLimite: comLimite.length,
        emAlerta: linhas.filter((x) => x.situacao === 'alerta').length,
        estouradas: linhas.filter((x) => x.situacao === 'estourado').length,
        categorias: categoriasOrcamento,
      },
      comparativo: {
        despesasPagasMesAnterior: emReais(pagasAnterior),
        receitasRecebidasMesAnterior: emReais(recebidasAnterior),
        variacaoDespesas: pagasAnterior > 0 ? um(((pagas - pagasAnterior) / pagasAnterior) * 100) : null,
      },
      ritmo: { diasDecorridos: decorridos, diasNoMes: dias, mediaDiaria: emReais(Math.round(mediaDiaria)), projecaoDespesas: projecao === null ? null : emReais(projecao) },
      evolucao,
      maioresDespesas: maiores,
    },
  };
}

// ---------- Cartões: faturas ----------

function resumoFatura(estado, conta, mes, hoje) {
  const f = faturaDoMes(conta.cartao, mes);
  const doCartao = estado.lancamentos.filter((l) => l.contaId === conta.id && faturaDaCompra(conta.cartao, l.data).mes === mes);
  // Despesas somam; receitas no cartão (estorno, cashback) abatem.
  const sinal = (l) => (l.tipo === 'Despesa' ? l.valorCentavos : -l.valorCentavos);
  const total = doCartao.reduce((t, l) => t + sinal(l), 0);
  const pendente = doCartao.filter((l) => l.status === 'Pendente').reduce((t, l) => t + sinal(l), 0);
  let situacao;
  if (doCartao.length === 0) situacao = 'vazia';
  else if (!doCartao.some((l) => l.status === 'Pendente')) situacao = 'paga';
  else if (hoje <= f.fechamento) situacao = 'aberta';
  else if (hoje > f.vencimento) situacao = 'vencida';
  else situacao = 'fechada';
  const itens = [...doCartao]
    .sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : a.id - b.id))
    .map((l) => dtoLancamento(estado, l));
  return {
    contaId: conta.id, nome: conta.nome, fechamentoDia: conta.cartao.fechamento, vencimentoDia: conta.cartao.vencimento,
    mes, inicio: f.inicio, fechamento: f.fechamento, vencimento: f.vencimento,
    total: emReais(total), pago: emReais(total - pendente), pendente: emReais(pendente),
    quantidade: doCartao.length, situacao, itens,
  };
}

/**
 * GET  /api/cartoes?mes=aaaa-mm              faturas que VENCEM no mês, uma por cartão
 * POST /api/cartoes/{contaId}/pagar { mes }  marca como pagos todos os lançamentos pendentes da fatura
 */
function cartoes(estado, metodo, id, corpo, consulta, hoje, subrota) {
  if (metodo === 'GET' && id === null && !subrota) {
    const mes = lerMes(consulta.get('mes'), hoje);
    const lista = estado.contas.filter((c) => c.cartao).sort((a, b) => porTexto(a.nome, b.nome));
    return { status: 200, corpo: lista.map((c) => resumoFatura(estado, c, mes, hoje)) };
  }
  if (metodo === 'POST' && id !== null && subrota === 'pagar') {
    const conta = estado.contas.find((c) => c.id === id);
    if (!conta) throw naoEncontrado();
    if (!conta.cartao) throw new ErroLocal('Esta conta não é um cartão de crédito.', 400);
    const mes = lerMes(corpo?.mes, hoje);
    let pagos = 0;
    for (const l of estado.lancamentos) {
      if (l.contaId === id && l.status === 'Pendente' && faturaDaCompra(conta.cartao, l.data).mes === mes) {
        l.status = 'PagoRecebido';
        pagos += 1;
      }
    }
    return { status: 200, corpo: { pagos, fatura: resumoFatura(estado, conta, mes, hoje) }, alterou: pagos > 0 };
  }
  return null;
}

/**
 * Tudo o que está PENDENTE e tem data para vencer, numa lista só:
 * - lançamentos comuns, pela própria data;
 * - compras no cartão NÃO aparecem uma a uma: viram a FATURA, pela data de vencimento dela.
 * Usado pelos avisos do Resumo e pelas notificações. Valores em centavos.
 */
export function vencimentosPendentes(estado) {
  const nomeCat = new Map(estado.categorias.map((c) => [c.id, c.nome]));
  const contaPorId = new Map(estado.contas.map((c) => [c.id, c]));
  const itens = [];
  const faturas = new Map();
  for (const l of estado.lancamentos) {
    if (l.status !== 'Pendente') continue;
    const conta = contaPorId.get(l.contaId);
    if (conta?.cartao) {
      const f = faturaDaCompra(conta.cartao, l.data);
      const chave = `${conta.id}|${f.mes}`;
      const atual = faturas.get(chave) ?? { conta, f, centavos: 0 };
      atual.centavos += l.tipo === 'Despesa' ? l.valorCentavos : -l.valorCentavos;
      faturas.set(chave, atual);
    } else {
      itens.push({
        id: l.id, chave: `l${l.id}`, data: l.data, tipo: l.tipo, descricao: l.descricao,
        categoria: nomeCat.get(l.categoriaId) ?? '', valorCentavos: l.valorCentavos, fixa: l.fixa === true,
        contaId: l.contaId, fatura: null,
      });
    }
  }
  for (const { conta, f, centavos } of faturas.values()) {
    if (centavos <= 0) continue; // estornos maiores que as compras: nada a pagar
    itens.push({
      id: null, chave: `f${conta.id}-${f.mes}`, data: f.vencimento, tipo: 'Fatura', descricao: `Fatura ${conta.nome}`,
      categoria: 'Cartão de crédito', valorCentavos: centavos, fixa: false, contaId: conta.id, fatura: f.mes,
    });
  }
  return itens.sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : a.chave < b.chave ? -1 : 1));
}

// ---------- Metas de economia ----------
//
// Uma meta tem nome, valor-alvo e (opcional) prazo. O dinheiro guardado é registrado na própria meta como
// "aportes" (positivos) e "retiradas" (negativos). Isso NÃO cria lançamentos: a meta é um cofrinho de controle.

function lerMeta(corpo) {
  const nome = String(corpo?.nome ?? '').trim();
  if (!nome) throw new ErroLocal('Informe o nome da meta.', 400);
  if (nome.length > 60) throw new ErroLocal('O nome deve ter no máximo 60 caracteres.', 400);
  const alvo = Number(corpo?.alvo);
  const alvoCentavos = emCentavos(alvo);
  if (!Number.isFinite(alvo) || alvoCentavos < 1 || alvoCentavos > LIMITE_MAXIMO_CENTAVOS) {
    throw new ErroLocal('Informe um valor-alvo maior que zero.', 400);
  }
  const prazo = corpo?.prazo === undefined || corpo?.prazo === null || corpo?.prazo === '' ? null : corpo.prazo;
  if (prazo !== null && !dataValida(prazo)) throw new ErroLocal('Prazo inválido.', 400);
  return { nome, alvoCentavos, prazo };
}

const guardadoDa = (m) => m.aportes.reduce((t, a) => t + a.valorCentavos, 0);

function dtoMeta(m, hoje) {
  const guardado = guardadoDa(m);
  const falta = Math.max(0, m.alvoCentavos - guardado);
  const inicio = m.criadoEm ? hojeISO(new Date(m.criadoEm)) : hoje;
  let situacao;
  let mesesRestantes = null;
  let mensalSugerido = null;
  if (guardado >= m.alvoCentavos) situacao = 'concluida';
  else if (!m.prazo) situacao = 'semPrazo';
  else if (hoje > m.prazo) situacao = 'atrasada';
  else {
    // Meses que ainda dá para guardar, contando o atual (prazo em dezembro, hoje em novembro: 2 meses).
    const [ah, mh] = hoje.split('-').map(Number);
    const [ap, mp] = m.prazo.split('-').map(Number);
    mesesRestantes = (ap * 12 + mp) - (ah * 12 + mh) + 1;
    mensalSugerido = Math.ceil(falta / mesesRestantes);
    // Ritmo: quanto já deveria ter, numa linha reta da criação até o prazo.
    const total = Math.max(1, diasEntre(inicio, m.prazo));
    const passados = Math.min(total, Math.max(0, diasEntre(inicio, hoje)));
    const esperado = Math.round((m.alvoCentavos * passados) / total);
    situacao = guardado >= esperado ? 'noRitmo' : 'abaixoDoRitmo';
  }
  return {
    id: m.id, nome: m.nome, alvo: emReais(m.alvoCentavos), prazo: m.prazo,
    guardado: emReais(guardado), falta: emReais(falta),
    percentual: um(Math.min(100, (guardado / m.alvoCentavos) * 100)),
    situacao, mesesRestantes, mensalSugerido: mensalSugerido === null ? null : emReais(mensalSugerido),
    aportes: [...m.aportes]
      .sort((a, b) => (a.data < b.data ? 1 : a.data > b.data ? -1 : b.id - a.id))
      .map((a) => ({ id: a.id, data: a.data, valor: emReais(a.valorCentavos), nota: a.nota })),
  };
}

/**
 * GET    /api/metas                       lista (concluídas por último)
 * POST   /api/metas { nome, alvo, prazo? }
 * PUT    /api/metas/{id} { nome, alvo, prazo? }
 * DELETE /api/metas/{id}
 * POST   /api/metas/{id}/aportes { valor, retirada?, data?, nota? }
 * DELETE /api/aportes/{id}
 */
function metas(estado, metodo, id, corpo, hoje, subrota) {
  if (!estado.metas) estado.metas = [];
  const achar = () => {
    const m = estado.metas.find((x) => x.id === id);
    if (!m) throw naoEncontrado();
    return m;
  };
  if (metodo === 'GET' && id === null) {
    const ordem = { atrasada: 0, abaixoDoRitmo: 1, noRitmo: 2, semPrazo: 3, concluida: 4 };
    const lista = estado.metas.map((m) => dtoMeta(m, hoje))
      .sort((a, b) => ordem[a.situacao] - ordem[b.situacao] || porTexto(a.nome, b.nome));
    return { status: 200, corpo: lista };
  }
  if (metodo === 'POST' && id === null) {
    const dados = lerMeta(corpo);
    if (estado.metas.some((m) => mesmoNome(m.nome, dados.nome))) throw conflito('Já existe uma meta com esse nome.');
    estado.seq.meta = (estado.seq.meta ?? 0) + 1;
    const m = { id: estado.seq.meta, ...dados, criadoEm: new Date(`${hoje}T12:00:00`).toISOString(), aportes: [] };
    estado.metas.push(m);
    return { status: 200, corpo: dtoMeta(m, hoje), alterou: true };
  }
  if (metodo === 'PUT' && id !== null && !subrota) {
    const m = achar();
    const dados = lerMeta(corpo);
    if (estado.metas.some((x) => x.id !== id && mesmoNome(x.nome, dados.nome))) throw conflito('Já existe uma meta com esse nome.');
    Object.assign(m, dados);
    return { status: 200, corpo: dtoMeta(m, hoje), alterou: true };
  }
  if (metodo === 'DELETE' && id !== null && !subrota) {
    achar();
    estado.metas = estado.metas.filter((x) => x.id !== id);
    return { status: 204, corpo: null, alterou: true };
  }
  if (metodo === 'POST' && id !== null && subrota === 'aportes') {
    const m = achar();
    const valor = Number(corpo?.valor);
    const centavos = emCentavos(valor);
    if (!Number.isFinite(valor) || centavos < 1 || centavos > LIMITE_MAXIMO_CENTAVOS) throw new ErroLocal('O valor deve ser maior que zero.', 400);
    if (corpo?.retirada !== undefined && typeof corpo.retirada !== 'boolean') throw new ErroLocal('Valor inválido para "retirada".', 400);
    const data = corpo?.data ?? hoje;
    if (!dataValida(data)) throw new ErroLocal('Data inválida.', 400);
    const nota = String(corpo?.nota ?? '').trim();
    if (nota.length > 100) throw new ErroLocal('A observação deve ter no máximo 100 caracteres.', 400);
    if (corpo?.retirada && centavos > guardadoDa(m)) throw new ErroLocal('A retirada é maior que o valor guardado na meta.', 400);
    estado.seq.aporte = (estado.seq.aporte ?? 0) + 1;
    m.aportes.push({ id: estado.seq.aporte, data, valorCentavos: corpo?.retirada ? -centavos : centavos, nota });
    return { status: 200, corpo: dtoMeta(m, hoje), alterou: true };
  }
  return null;
}

function aportes(estado, metodo, id) {
  if (metodo !== 'DELETE' || id === null) return null;
  const m = (estado.metas ?? []).find((x) => x.aportes.some((a) => a.id === id));
  if (!m) throw naoEncontrado();
  const sem = m.aportes.filter((a) => a.id !== id);
  if (guardadoDa({ aportes: sem }) < 0) throw new ErroLocal('Excluir este depósito deixaria a meta com saldo negativo. Exclua antes a retirada.', 400);
  m.aportes = sem;
  return { status: 204, corpo: null, alterou: true };
}

// ---------- Exportar planilha (CSV) ----------

const csvTexto = (v) => {
  let t = String(v ?? '');
  // Proteção contra "injeção de fórmula": texto que começa com = + - @ vira texto puro no Excel.
  if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`;
  return /[;"\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};
const csvValor = (centavos) => (centavos / 100).toFixed(2).replace('.', ',');
const dataCsv = (iso) => iso.split('-').reverse().join('/');

/**
 * Lançamentos em CSV para Excel/Planilhas em português: separador ";", vírgula decimal, datas dd/mm/aaaa, BOM
 * (para os acentos) e quebras de linha CRLF. `de`/`ate` (aaaa-mm-dd, inclusivos) são opcionais.
 * "Valor" tem sinal: receitas positivas, despesas negativas — dá para somar a coluna direto.
 */
export function gerarCsv(estado, { de = null, ate = null } = {}) {
  const nomeCat = new Map(estado.categorias.map((c) => [c.id, c.nome]));
  const contaPorId = new Map(estado.contas.map((c) => [c.id, c]));
  const itens = estado.lancamentos
    .filter((l) => (!de || l.data >= de) && (!ate || l.data <= ate))
    .sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : a.id - b.id));
  const linhas = [['Data', 'Tipo', 'Descrição', 'Categoria', 'Conta', 'Valor', 'Status', 'Fixa', 'Parcela', 'Fatura'].join(';')];
  for (const l of itens) {
    const conta = contaPorId.get(l.contaId);
    const fatura = conta?.cartao ? faturaDaCompra(conta.cartao, l.data).mes.split('-').reverse().join('/') : '';
    linhas.push([
      dataCsv(l.data), l.tipo, csvTexto(l.descricao), csvTexto(nomeCat.get(l.categoriaId) ?? ''), csvTexto(conta?.nome ?? ''),
      csvValor(l.tipo === 'Receita' ? l.valorCentavos : -l.valorCentavos),
      l.status === 'Pendente' ? 'Pendente' : l.tipo === 'Receita' ? 'Recebido' : 'Pago',
      l.fixa ? 'Sim' : 'Não', l.parcela ? `${l.parcela.numero}/${l.parcela.total}` : '', fatura,
    ].join(';'));
  }
  return { texto: `\uFEFF${linhas.join('\r\n')}\r\n`, quantidade: itens.length };
}

// ---------- Configurações, lembretes e registro de backup ----------

/** Dias entre duas datas aaaa-mm-dd (b - a). */
export function diasEntre(a, b) {
  const utc = (d) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
  return Math.round((utc(b) - utc(a)) / 86_400_000);
}

function config(estado, metodo, corpo) {
  if (!estado.config) estado.config = configPadrao();
  if (metodo === 'GET') return { status: 200, corpo: structuredClone(estado.config) };
  if (metodo !== 'PUT') return null;

  const c = corpo ?? {};
  estado.config = { ...estado.config, painel: normalizarPainel(estado.config.painel) }; // estado de versão anterior ou incompleto
  const atual = estado.config;
  const novo = structuredClone(atual);
  const invalido = (campo) => new ErroLocal(`Valor inválido para "${campo}".`, 400);
  if (c.lembretes !== undefined) {
    const l = c.lembretes;
    if (!l || typeof l !== 'object') throw invalido('lembretes');
    if (l.ativo !== undefined) { if (typeof l.ativo !== 'boolean') throw invalido('ativo'); novo.lembretes.ativo = l.ativo; }
    if (l.diasAntes !== undefined) { if (!ANTECEDENCIAS.includes(l.diasAntes)) throw invalido('diasAntes'); novo.lembretes.diasAntes = l.diasAntes; }
    if (l.hora !== undefined) { if (!horaValida(l.hora)) throw invalido('hora'); novo.lembretes.hora = l.hora; }
    if (l.detalhes !== undefined) { if (typeof l.detalhes !== 'boolean') throw invalido('detalhes'); novo.lembretes.detalhes = l.detalhes; }
  }
  if (c.backup !== undefined) {
    const b = c.backup;
    if (!b || typeof b !== 'object') throw invalido('backup');
    // As datas do último backup não são editáveis aqui: só /api/backup/registrar as muda.
    if (b.automatico !== undefined) { if (typeof b.automatico !== 'boolean') throw invalido('automatico'); novo.backup.automatico = b.automatico; }
  }
  if (c.painel !== undefined) {
    // Alteração parcial: só as seções (e campos) enviados mudam.
    if (!c.painel || typeof c.painel !== 'object' || Array.isArray(c.painel)) throw invalido('painel');
    for (const [id, sec] of Object.entries(c.painel)) {
      const tipos = SECOES_PAINEL[id];
      if (!tipos || !sec || typeof sec !== 'object' || Array.isArray(sec)) throw invalido(`painel.${id}`);
      if (sec.visivel !== undefined && typeof sec.visivel !== 'boolean') throw invalido(`painel.${id}.visivel`);
      if (sec.tipo !== undefined && !tipos.includes(sec.tipo)) throw invalido(`painel.${id}.tipo`);
    }
    for (const [id, sec] of Object.entries(c.painel)) {
      if (sec.visivel !== undefined) novo.painel[id].visivel = sec.visivel;
      if (sec.tipo !== undefined) novo.painel[id].tipo = sec.tipo;
    }
  }
  estado.config = novo;
  return { status: 200, corpo: structuredClone(novo), alterou: JSON.stringify(novo) !== JSON.stringify(atual) };
}

/** POST /api/backup/registrar { automatico? } — anota quando foi feito o último backup. */
function registrarBackup(estado, metodo, corpo, agora) {
  if (metodo !== 'POST') return null;
  if (!estado.config) estado.config = configPadrao();
  if (corpo?.automatico !== undefined && typeof corpo.automatico !== 'boolean') throw new ErroLocal('Valor inválido para "automatico".', 400);
  estado.config.backup[corpo?.automatico ? 'ultimoAutomatico' : 'ultimo'] = agora;
  return { status: 200, corpo: structuredClone(estado.config.backup), alterou: true };
}

/**
 * GET /api/lembretes?dias=7 — lançamentos PENDENTES atrasados e os que vencem nos próximos `dias` dias (receitas e
 * despesas), e há quantos dias foi o último backup. Alimenta os avisos do Resumo.
 */
function lembretes(estado, metodo, consulta, hoje, agora) {
  if (metodo !== 'GET') return null;
  const diasTexto = consulta.get('dias');
  if (diasTexto !== null && !/^\d{1,2}$/.test(diasTexto)) throw new ErroLocal('Valor de "dias" inválido. Use de 0 a 60.', 400);
  const dias = diasTexto === null ? 7 : Number(diasTexto);
  if (dias > 60) throw new ErroLocal('Valor de "dias" inválido. Use de 0 a 60.', 400);

  const pendentes = vencimentosPendentes(estado).map((x) => ({ ...x, valor: emReais(x.valorCentavos), dias: diasEntre(hoje, x.data) }));
  const atrasados = pendentes.filter((x) => x.dias < 0);
  const proximos = pendentes.filter((x) => x.dias >= 0 && x.dias <= dias);
  // Faturas de cartão contam como despesa (é dinheiro saindo).
  const soma = (lista, tipo) => emReais(lista
    .filter((x) => (tipo === 'Despesa' ? x.tipo !== 'Receita' : x.tipo === 'Receita'))
    .reduce((t, x) => t + x.valorCentavos, 0));
  const limpar = (lista) => lista.map(({ valorCentavos, chave, ...resto }) => ({ ...resto, chave }));

  const cfg = estado.config ?? configPadrao();
  const instantes = [cfg.backup.ultimo, cfg.backup.ultimoAutomatico].filter(Boolean).sort();
  const ultimo = instantes.at(-1) ?? null;
  const diasDesde = ultimo ? Math.max(0, diasEntre(hojeISO(new Date(ultimo)), hoje)) : null;

  return {
    status: 200,
    corpo: {
      hoje, dias, atrasados: limpar(atrasados), proximos: limpar(proximos),
      totais: {
        despesasAtrasadas: soma(atrasados, 'Despesa'), receitasAtrasadas: soma(atrasados, 'Receita'),
        despesasProximas: soma(proximos, 'Despesa'), receitasProximas: soma(proximos, 'Receita'),
      },
      backup: {
        ultimo, diasDesde,
        // Só lembra de backup quando há algo a perder.
        atrasado: estado.lancamentos.length > 0 && (diasDesde === null || diasDesde >= DIAS_PARA_LEMBRAR_BACKUP),
      },
    },
  };
}

// ---------- Roteador ----------

/**
 * Atende uma "requisição da API" sobre o estado local.
 * Devolve { status, corpo, alterou } ou lança ErroLocal (com .status) quando a API devolveria erro.
 * `alterou` indica se o estado foi modificado e precisa ser salvo.
 */
export function rotear(estado, metodo, url, corpo, { agora = new Date().toISOString(), hoje = hojeISO(new Date(agora)) } = {}) {
  const u = new URL(url, 'http://local');
  const caminho = u.pathname.replace(/\/+$/, '');
  const partes = caminho.split('/').filter(Boolean); // ['api', 'lancamentos', '12', 'status']
  const m = String(metodo).toUpperCase();

  let r = null;
  if (partes[0] === 'api') {
    const recurso = partes[1];
    const idTexto = partes[2];
    const id = idTexto === undefined ? null : lerId(idTexto);
    const idInvalido = idTexto !== undefined && id === null;
    const subrota = partes[3];

    if ((recurso === 'lancamentos-fixos' || recurso === 'despesas-fixas') && partes.length === 3 && idTexto === 'copiar') {
      r = copiarFixas(estado, m, corpo, hoje);
    } else if (recurso === 'backup' && partes.length === 3 && idTexto === 'registrar') {
      r = registrarBackup(estado, m, corpo, agora);
    } else if (!idInvalido && partes.length <= 4) {
      if (recurso === 'categorias' && partes.length <= 3) r = categorias(estado, m, id, corpo);
      else if (recurso === 'contas' && partes.length <= 3) r = contas(estado, m, id, corpo);
      else if (recurso === 'lancamentos') r = lancamentos(estado, m, id, corpo, u.searchParams, hoje, subrota);
      else if (recurso === 'resumo' && partes.length === 2) r = resumo(estado, m, u.searchParams, hoje);
      else if (recurso === 'orcamento' && partes.length === 2) r = orcamento(estado, m, corpo, u.searchParams, hoje);
      else if (recurso === 'dashboard' && partes.length === 2) r = painel(estado, m, u.searchParams, hoje);
      else if (recurso === 'config' && partes.length === 2) r = config(estado, m, corpo);
      else if (recurso === 'cartoes') r = cartoes(estado, m, id, corpo, u.searchParams, hoje, subrota);
      else if (recurso === 'metas') r = metas(estado, m, id, corpo, hoje, subrota);
      else if (recurso === 'aportes' && partes.length === 3) r = aportes(estado, m, id);
      else if (recurso === 'lembretes' && partes.length === 2) r = lembretes(estado, m, u.searchParams, hoje, agora);
    }
  }

  if (!r) throw new ErroLocal('Recurso não encontrado.', 404);
  return { status: r.status, corpo: r.corpo ?? null, alterou: Boolean(r.alterou) };
}

// ---------- Backup ----------

/** Confere se um objeto é um estado íntegro (formato, tipos e referências entre as tabelas). */
// Campos novos lidos com tolerância (dados e backups antigos não os têm): inválido vira "não tem".
const normalizarCartao = (c) =>
  c && diaCartaoValido(c.fechamento) && diaCartaoValido(c.vencimento) ? { fechamento: c.fechamento, vencimento: c.vencimento } : null;
const normalizarParcela = (p) =>
  p && Number.isInteger(p.grupo) && p.grupo > 0 && Number.isInteger(p.total) && p.total >= 2 && p.total <= MAX_PARCELAS
  && Number.isInteger(p.numero) && p.numero >= 1 && p.numero <= p.total
    ? { grupo: p.grupo, numero: p.numero, total: p.total } : null;

export function validarEstado(e) {
  const falha = (msg) => { throw new ErroLocal(`Backup inválido: ${msg}`, 400); };
  if (!e || typeof e !== 'object') falha('formato desconhecido.');
  if (e.versao !== VERSAO_DADOS) falha(`versão ${e.versao} não é suportada.`);
  if (!Array.isArray(e.categorias) || !Array.isArray(e.contas) || !Array.isArray(e.lancamentos)) falha('faltam listas de dados.');
  if (!e.seq || [e.seq.categoria, e.seq.conta, e.seq.lancamento].some((n) => !Number.isInteger(n) || n < 0)) falha('contadores ausentes.');

  const ids = (lista, nome) => {
    const set = new Set();
    for (const x of lista) {
      if (!Number.isInteger(x?.id) || x.id <= 0 || set.has(x.id)) falha(`${nome} com identificador inválido ou repetido.`);
      set.add(x.id);
    }
    return set;
  };
  const metasEntrada = e.metas === undefined ? [] : e.metas; // versões anteriores não têm metas
  if (!Array.isArray(metasEntrada)) falha('lista de metas inválida.');
  ids(metasEntrada, 'metas');
  const idsAporte = new Set();
  for (const m of metasEntrada) {
    if (typeof m.nome !== 'string' || !m.nome.trim() || m.nome.length > 60) falha('nome de meta inválido.');
    if (!Number.isInteger(m.alvoCentavos) || m.alvoCentavos < 1) falha('valor-alvo de meta inválido.');
    if (m.prazo !== null && m.prazo !== undefined && !dataValida(m.prazo)) falha('prazo de meta inválido.');
    if (!Array.isArray(m.aportes)) falha('depósitos de meta inválidos.');
    for (const a of m.aportes) {
      if (!Number.isInteger(a?.id) || a.id <= 0 || idsAporte.has(a.id)) falha('depósito com identificador inválido ou repetido.');
      idsAporte.add(a.id);
      if (!dataValida(a.data) || !Number.isInteger(a.valorCentavos) || a.valorCentavos === 0) falha('depósito de meta inválido.');
    }
  }
  const idsCat = ids(e.categorias, 'categorias');
  const idsConta = ids(e.contas, 'contas');
  ids(e.lancamentos, 'lançamentos');

  for (const c of e.categorias) {
    if (typeof c.nome !== 'string' || !c.nome.trim() || c.nome.length > 60) falha('nome de categoria inválido.');
    if (!TIPOS.includes(c.tipo)) falha('tipo de categoria inválido.');
    if (c.limiteCentavos !== null && (!Number.isInteger(c.limiteCentavos) || c.limiteCentavos < 0)) falha('limite de categoria inválido.');
  }
  for (const c of e.contas) {
    if (typeof c.nome !== 'string' || !c.nome.trim() || c.nome.length > 60) falha('nome de conta inválido.');
  }
  const tipoPorCategoria = new Map(e.categorias.map((c) => [c.id, c.tipo]));
  for (const l of e.lancamentos) {
    if (!dataValida(l.data)) falha('data de lançamento inválida.');
    if (!TIPOS.includes(l.tipo) || !STATUS.includes(l.status)) falha('tipo ou status de lançamento inválido.');
    if (typeof l.descricao !== 'string' || !l.descricao.trim() || l.descricao.length > 200) falha('descrição de lançamento inválida.');
    if (!Number.isInteger(l.valorCentavos) || l.valorCentavos < 1 || l.valorCentavos > LIMITE_MAXIMO_CENTAVOS) falha('valor de lançamento inválido.');
    if (!idsCat.has(l.categoriaId) || !idsConta.has(l.contaId)) falha('lançamento aponta para categoria ou conta inexistente.');
    if (tipoPorCategoria.get(l.categoriaId) !== l.tipo) falha('categoria incompatível com o tipo do lançamento.');
  }

  // Os contadores nunca podem ficar atrás dos identificadores usados (evita reaproveitar ids).
  const maior = (lista) => lista.reduce((m, x) => Math.max(m, x.id), 0);
  return {
    versao: VERSAO_DADOS,
    seq: {
      categoria: Math.max(e.seq.categoria, maior(e.categorias)),
      conta: Math.max(e.seq.conta, maior(e.contas)),
      lancamento: Math.max(e.seq.lancamento, maior(e.lancamentos)),
      meta: Math.max(Number.isInteger(e.seq.meta) ? e.seq.meta : 0, maior(metasEntrada)),
      aporte: Math.max(Number.isInteger(e.seq.aporte) ? e.seq.aporte : 0, ...[...idsAporte], 0),
    },
    categorias: e.categorias.map((c) => ({ id: c.id, nome: c.nome.trim(), tipo: c.tipo, limiteCentavos: c.limiteCentavos })),
    contas: e.contas.map((c) => ({ id: c.id, nome: c.nome.trim(), cartao: normalizarCartao(c.cartao) })),
    lancamentos: e.lancamentos.map((l) => ({
      id: l.id, data: l.data, tipo: l.tipo, categoriaId: l.categoriaId, descricao: l.descricao.trim(),
      contaId: l.contaId, valorCentavos: l.valorCentavos, status: l.status, criadoEm: typeof l.criadoEm === 'string' ? l.criadoEm : '',
      // Backups e dados de versões anteriores não têm "fixa": contam como não fixo.
      fixa: l.fixa === true,
      parcela: normalizarParcela(l.parcela),
    })),
    metas: metasEntrada.map((m) => ({
      id: m.id, nome: m.nome.trim(), alvoCentavos: m.alvoCentavos, prazo: m.prazo ?? null,
      criadoEm: typeof m.criadoEm === 'string' ? m.criadoEm : '',
      aportes: m.aportes.map((a) => ({ id: a.id, data: a.data, valorCentavos: a.valorCentavos, nota: typeof a.nota === 'string' ? a.nota.slice(0, 100) : '' })),
    })),
    config: normalizarConfig(e.config), // versões anteriores não têm configurações
  };
}

export const NOME_APP_BACKUP = 'controle-financeiro';

/** Texto JSON do arquivo de backup. */
export function montarBackup(estado, exportadoEm = new Date().toISOString()) {
  return JSON.stringify({ app: NOME_APP_BACKUP, exportadoEm, dados: estado }, null, 2);
}

/** Lê o texto de um arquivo de backup e devolve o estado validado (ou lança ErroLocal). */
export function lerBackup(texto) {
  let objeto;
  try {
    objeto = JSON.parse(texto);
  } catch {
    throw new ErroLocal('Backup inválido: o arquivo não é um JSON válido.', 400);
  }
  if (objeto?.app !== NOME_APP_BACKUP || !objeto.dados) {
    throw new ErroLocal('Backup inválido: este arquivo não foi gerado pelo Controle Financeiro.', 400);
  }
  return validarEstado(objeto.dados);
}
