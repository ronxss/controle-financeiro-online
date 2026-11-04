// Testes de contrato: o servidor (ASP.NET + SQL Server) precisa responder EXATAMENTE como o motor do app local
// (ClientApp/src/local/engine.js), que tem a sua própria bateria de testes. Cada cenário roda nos dois "clientes"
// e as respostas são comparadas (depois de traduzir ids e trocar carimbos de data/hora por um marcador).
//
// Uso (o CI faz isso):  TZ=America/Sao_Paulo SERVIDOR=http://localhost:5080 PASTA_EMAILS=/tmp/emails node tests/contrato/contrato.mjs
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { criarEstadoInicial, rotear, ErroLocal, hojeISO, somarMeses, lerBackup, gerarCsv } from '../../ClientApp/src/local/engine.js';

const SERVIDOR = process.env.SERVIDOR ?? 'http://localhost:5080';
const PASTA_EMAILS = process.env.PASTA_EMAILS ?? '/tmp/emails';
const SENHA = 'Contrato123';
const HOJE = hojeISO();
const MES = HOJE.slice(0, 7);
const ANTERIOR = somarMeses(MES, -1);
const PROXIMO = somarMeses(MES, 1);
const dia = (mes, d) => `${mes}-${String(d).padStart(2, '0')}`;
const ultimoDia = (mes) => dia(mes, new Date(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0).getDate());

// ------------------------------------------------------------------ clientes

class ClienteServidor {
  constructor() { this.cookie = ''; }
  async pedir(metodo, url, corpo, { bruto = false } = {}) {
    const r = await fetch(SERVIDOR + url, {
      method: metodo,
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        ...(corpo === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(this.cookie ? { Cookie: this.cookie } : {}),
      },
      body: corpo === undefined ? undefined : (typeof corpo === 'string' ? corpo : JSON.stringify(corpo)),
    });
    const sc = r.headers.getSetCookie?.() ?? [];
    for (const c of sc) if (c.startsWith('cf.auth=')) this.cookie = c.split(';')[0];
    const texto = await r.text();
    if (bruto) return { status: r.status, texto, headers: r.headers };
    let json = null;
    if (texto) { try { json = JSON.parse(texto); } catch { json = texto; } }
    if (r.status >= 400) {
      const msg = json?.mensagem ?? (json?.errors ? Object.values(json.errors).flat()[0] : json?.title);
      return { status: r.status, corpo: { mensagem: msg } };
    }
    return { status: r.status, corpo: json };
  }
  async registrar() {
    this.email = `contrato-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@teste.local`;
    const r = await this.pedir('POST', '/api/auth/registrar', { nome: 'Contrato', email: this.email, senha: SENHA });
    assert.equal(r.status, 200, `registrar: ${JSON.stringify(r)}`);
  }
}

class ClienteMotor {
  constructor() { this.estado = criarEstadoInicial(); }
  async pedir(metodo, url, corpo) {
    try {
      const r = rotear(this.estado, metodo, url, corpo === undefined ? undefined : JSON.parse(JSON.stringify(corpo)));
      return { status: r.status, corpo: r.corpo === null ? null : JSON.parse(JSON.stringify(r.corpo)) };
    } catch (e) {
      if (e instanceof ErroLocal) return { status: e.status, corpo: { mensagem: e.message } };
      throw e;
    }
  }
}

// ------------------------------------------------------------------ normalização

const INSTANTES = new Set(['ultimo', 'ultimoAutomatico', 'exportadoEm', 'criadoEm']);

/** Troca ids pelo ordinal em que aparecem (por tipo), para comparar servidor e motor. */
function normalizador() {
  const mapas = {};
  const ordinal = (ns, v) => {
    if (v === null || v === undefined) return v;
    const m = (mapas[ns] ??= new Map());
    if (!m.has(v)) m.set(v, `${ns}#${m.size + 1}`);
    return m.get(v);
  };
  const nsDoRecurso = (url) => {
    if (url.includes('/categorias')) return 'cat';
    if (url.includes('/contas')) return 'conta';
    if (url.includes('/metas') || url.includes('/aportes')) return 'meta';
    return 'lanc';
  };
  const andar = (v, nsId) => {
    if (Array.isArray(v)) return v.map((x) => andar(x, nsId));
    if (!v || typeof v !== 'object') return v;
    const out = {};
    for (const [k, x] of Object.entries(v)) {
      if (INSTANTES.has(k) && typeof x === 'string') out[k] = '<instante>';
      else if (k === 'id') out[k] = ordinal(nsId, x);
      else if (k === 'categoriaId') out[k] = ordinal('cat', x);
      else if (k === 'contaId') out[k] = ordinal('conta', x);
      else if (k === 'grupo' || k === 'lancamentoId') out[k] = ordinal('lanc', x);
      else if (k === 'ids') out[k] = x.map((i) => ordinal('lanc', i));
      else if (k === 'chave' && typeof x === 'string') {
        // "l12" (lançamento 12) ou "f3-2026-11" (fatura do cartão 3 que vence em 2026-11)
        const f = x.match(/^f(\d+)-(.+)$/);
        out[k] = f ? `f:${ordinal('conta', Number(f[1]))}:${f[2]}` : `l:${ordinal('lanc', Number(x.slice(1)))}`;
      }
      else if (k === 'aportes') out[k] = andar(x, 'aporte');
      else if (k === 'itens' || k === 'maioresDespesas' || k === 'atrasados' || k === 'proximos') out[k] = andar(x, 'lanc');
      else if (k === 'categorias' && Array.isArray(x)) out[k] = andar(x, 'cat');
      else out[k] = andar(x, nsId);
    }
    return out;
  };
  return (url, resposta) => ({ status: resposta.status, corpo: andar(resposta.corpo, nsDoRecurso(url)) });
}

// ------------------------------------------------------------------ execução

/** Os passos chamam `c.pedir(...)` via `p()` e podem ler ids das respostas do próprio cliente. */
async function rodar(nome, cenario) {
  const srv = new ClienteServidor();
  await srv.registrar();
  const mot = new ClienteMotor();
  const obs = { srv: [], mot: [] };
  for (const [lado, cliente] of [['srv', srv], ['mot', mot]]) {
    const norm = normalizador();
    const p = async (metodo, url, corpo) => {
      const r = await cliente.pedir(metodo, url, corpo);
      obs[lado].push({ passo: `${metodo} ${url}`, ...norm(url, r) });
      return r;
    };
    const ids = async () => ({
      cat: Object.fromEntries((await cliente.pedir('GET', '/api/categorias')).corpo.map((c) => [c.nome, c.id])),
      conta: Object.fromEntries((await cliente.pedir('GET', '/api/contas')).corpo.map((c) => [c.nome, c.id])),
    });
    await cenario({ p, ids, cliente });
  }
  assert.equal(obs.srv.length, obs.mot.length, `[${nome}] quantidade de passos difere`);
  for (let i = 0; i < obs.mot.length; i += 1) {
    // O rótulo do passo tem o id cru da URL (diferente em cada lado); compara só status e corpo.
    const { passo, ...esperado } = obs.mot[i];
    const { passo: _p, ...obtido } = obs.srv[i];
    assert.deepEqual(obtido, esperado, `[${nome}] passo ${i + 1} (${passo}) difere do motor local`);
  }
  console.log(`ok - ${nome} (${obs.mot.length} passos)`);
}

const lanc = (id, extra) => ({
  data: dia(MES, 10), tipo: 'Despesa', categoriaId: id.cat['Alimentação'], descricao: 'Mercado',
  contaId: id.conta['Conta corrente'], valor: 100, status: 'PagoRecebido', ...extra,
});

const cenarios = {
  async 'cadastros e cartão'({ p }) {
    await p('GET', '/api/categorias');
    await p('GET', '/api/contas');
    const nova = (await p('POST', '/api/contas', { nome: 'Nubank', cartao: { fechamento: 3, vencimento: 10 } })).corpo;
    await p('PUT', `/api/contas/${nova.id}`, { nome: 'Nubank Roxo' });
    await p('GET', '/api/contas');
    await p('PUT', `/api/contas/${nova.id}`, { nome: 'Nubank Roxo', cartao: null });
    await p('GET', '/api/contas');
    await p('POST', '/api/contas', { nome: 'X1', cartao: { fechamento: 0, vencimento: 5 } });
    await p('POST', '/api/contas', { nome: 'X2', cartao: { fechamento: 5, vencimento: 32 } });
    await p('POST', '/api/contas', { nome: 'DINHEIRO' });
    await p('POST', '/api/categorias', { nome: 'Pets', tipo: 'Despesa' });
    await p('GET', '/api/categorias');
  },

  async 'lançamentos, fixas e filtros'({ p, ids }) {
    const id = await ids();
    const a = (await p('POST', '/api/lancamentos', lanc(id, { descricao: 'Aluguel', fixa: true, categoriaId: id.cat.Moradia }))).corpo.id;
    const b = (await p('POST', '/api/lancamentos', lanc(id, { descricao: 'Mercado' }))).corpo.id;
    await p('POST', '/api/lancamentos', lanc(id, { tipo: 'Receita', categoriaId: id.cat['Salário'], descricao: 'Salário', fixa: true, valor: 5000 }));
    await p('GET', `/api/lancamentos?mes=${MES}`);
    await p('GET', `/api/lancamentos?mes=${MES}&fixa=true`);
    await p('GET', `/api/lancamentos?mes=${MES}&fixa=false`);
    await p('GET', `/api/lancamentos?mes=${MES}&fixa=talvez`);
    await p('GET', `/api/lancamentos?mes=${MES}&busca=merc`);
    const semFixa = lanc(id, { descricao: 'Aluguel', valor: 77, categoriaId: id.cat.Moradia });
    await p('PUT', `/api/lancamentos/${a}`, semFixa);
    await p('PATCH', `/api/lancamentos/${b}/fixa`, { fixa: true });
    await p('PATCH', `/api/lancamentos/${b}/fixa`, {});
    await p('PATCH', `/api/lancamentos/${b}/status`, { status: 'Pendente' });
    await p('GET', `/api/lancamentos?mes=${MES}`);
    await p('POST', '/api/lancamentos', lanc(id, { categoriaId: id.cat['Salário'] }));
    await p('POST', '/api/lancamentos', lanc(id, { descricao: '' }));
    await p('DELETE', `/api/lancamentos/${b}`);
    await p('DELETE', '/api/lancamentos/999999');
    await p('GET', `/api/lancamentos?mes=${MES}`);
    await p('GET', '/api/lancamentos?mes=2026-13');
  },

  async 'parcelas'({ p, ids }) {
    const id = await ids();
    const r = (await p('POST', '/api/lancamentos', lanc(id, { descricao: 'TV', valor: 1000, parcelas: 3, data: dia(MES, 28) }))).corpo;
    // último dia do mês: nos meses seguintes vira o último dia de cada um (31 -> 30 -> 28...)
    await p('POST', '/api/lancamentos', lanc(id, { descricao: 'Sofá', valor: 400, parcelas: 4, data: ultimoDia(ANTERIOR) }));
    for (const m of [ANTERIOR, MES, PROXIMO, somarMeses(MES, 2), somarMeses(MES, 3)]) await p('GET', `/api/lancamentos?mes=${m}`);
    await p('POST', '/api/lancamentos', lanc(id, { parcelas: 61 }));
    await p('POST', '/api/lancamentos', lanc(id, { parcelas: 3, fixa: true }));
    await p('POST', '/api/lancamentos', lanc(id, { parcelas: 3, valor: 0.02 }));
    await p('PATCH', `/api/lancamentos/${r.ids[1]}/fixa`, { fixa: true });
    await p('PUT', `/api/lancamentos/${r.ids[1]}`, lanc(id, { descricao: 'TV', data: dia(PROXIMO, 28), valor: 150, status: 'Pendente', fixa: true }));
    await p('PUT', `/api/lancamentos/${r.ids[1]}`, lanc(id, { descricao: 'TV', data: dia(PROXIMO, 28), valor: 150, status: 'Pendente' }));
    await p('DELETE', `/api/lancamentos/${r.ids[0]}?parcelas=x`);
    await p('DELETE', `/api/lancamentos/${r.ids[1]}?parcelas=seguintes`);
    for (const m of [MES, PROXIMO, somarMeses(MES, 2)]) await p('GET', `/api/lancamentos?mes=${m}`);
    await p('DELETE', `/api/lancamentos/${r.ids[0]}?parcelas=todas`);
    await p('GET', `/api/lancamentos?mes=${MES}`);
  },

  async 'copiar fixas'({ p, ids }) {
    const id = await ids();
    await p('POST', '/api/lancamentos', lanc(id, { descricao: 'Aluguel', data: dia(ANTERIOR, 28), valor: 1500, fixa: true }));
    await p('POST', '/api/lancamentos', lanc(id, { descricao: 'Internet', data: dia(ANTERIOR, 20), valor: 99.9, fixa: true, status: 'Pendente' }));
    await p('POST', '/api/lancamentos', lanc(id, { tipo: 'Receita', categoriaId: id.cat['Salário'], descricao: 'Salário', data: dia(ANTERIOR, 5), fixa: true, valor: 5000 }));
    await p('POST', '/api/lancamentos', lanc(id, { descricao: 'Mercado', data: dia(ANTERIOR, 12) }));
    await p('POST', '/api/lancamentos', lanc(id, { descricao: '  aluguel ', data: dia(MES, 3), valor: 1 }));
    await p('POST', '/api/lancamentos-fixos/copiar', { mes: MES });
    await p('POST', '/api/despesas-fixas/copiar', { mes: MES });
    await p('GET', `/api/lancamentos?mes=${MES}`);
    await p('POST', '/api/lancamentos-fixos/copiar', { mes: MES, origem: MES });
    await p('POST', '/api/lancamentos-fixos/copiar', { mes: '2026-13' });
  },

  async 'resumo, orçamento e painel'({ p, ids }) {
    const id = await ids();
    await p('PUT', '/api/orcamento', [
      { categoriaId: id.cat['Alimentação'], limite: 500 }, { categoriaId: id.cat.Moradia, limite: 2000 }, { categoriaId: id.cat.Lazer, limite: 100 },
    ]);
    await p('POST', '/api/lancamentos', lanc(id, { descricao: 'Aluguel', data: dia(MES, 1), valor: 1600, categoriaId: id.cat.Moradia, fixa: true }));
    await p('POST', '/api/lancamentos', lanc(id, { descricao: 'Mercado', data: dia(MES, 1), valor: 300 }));
    await p('POST', '/api/lancamentos', lanc(id, { descricao: 'Cinema', data: dia(MES, 1), valor: 150, categoriaId: id.cat.Lazer }));
    await p('POST', '/api/lancamentos', lanc(id, { descricao: 'Internet', data: dia(MES, 25), valor: 100, categoriaId: id.cat['Contas e impostos'], fixa: true, status: 'Pendente' }));
    await p('POST', '/api/lancamentos', lanc(id, { descricao: 'Remédio', data: dia(MES, 1), valor: 50, categoriaId: id.cat['Saúde'] }));
    await p('POST', '/api/lancamentos', lanc(id, { tipo: 'Receita', descricao: 'Salário', data: dia(MES, 1), valor: 5000, categoriaId: id.cat['Salário'], fixa: true }));
    await p('POST', '/api/lancamentos', lanc(id, { tipo: 'Receita', descricao: 'Freela', data: dia(MES, 20), valor: 700, categoriaId: id.cat.Freelance, status: 'Pendente' }));
    await p('POST', '/api/lancamentos', lanc(id, { descricao: 'Aluguel', data: dia(ANTERIOR, 5), valor: 1600, categoriaId: id.cat.Moradia, fixa: true }));
    await p('POST', '/api/lancamentos', lanc(id, { descricao: 'Mercado', data: dia(ANTERIOR, 8), valor: 400 }));
    await p('POST', '/api/lancamentos', lanc(id, { tipo: 'Receita', descricao: 'Salário', data: dia(ANTERIOR, 5), valor: 4800, categoriaId: id.cat['Salário'] }));
    for (const m of [MES, ANTERIOR, PROXIMO]) {
      await p('GET', `/api/resumo?mes=${m}`);
      await p('GET', `/api/orcamento?mes=${m}`);
      await p('GET', `/api/dashboard?mes=${m}`);
    }
    await p('GET', '/api/dashboard?mes=x');
  },

  async 'cartões e faturas'({ p, ids }) {
    const id = await ids();
    const nb = (await p('POST', '/api/contas', { nome: 'Nubank', cartao: { fechamento: 5, vencimento: 12 } })).corpo.id;
    const inter = (await p('POST', '/api/contas', { nome: 'Inter', cartao: { fechamento: 25, vencimento: 5 } })).corpo.id;
    const compra = (conta, extra) => p('POST', '/api/lancamentos', lanc(id, { contaId: conta, status: 'Pendente', ...extra }));
    await compra(nb, { data: dia(ANTERIOR, 20), valor: 100, descricao: 'Mercado' });
    await compra(nb, { data: dia(MES, 5), valor: 50, descricao: 'Farmácia' });
    await compra(nb, { data: dia(MES, 3), valor: 30, descricao: 'Estorno', tipo: 'Receita', categoriaId: id.cat.Freelance });
    await compra(nb, { data: dia(MES, 6), valor: 70, descricao: 'Cinema' });
    await compra(inter, { data: dia(MES, 26), valor: 300, descricao: 'Geladeira', parcelas: 3 });
    await compra(inter, { data: dia(MES, 10), valor: 40, descricao: 'Pago', status: 'PagoRecebido' });
    for (const m of [ANTERIOR, MES, PROXIMO, somarMeses(MES, 2), somarMeses(MES, 3)]) await p('GET', `/api/cartoes?mes=${m}`);
    await p('GET', `/api/lancamentos?mes=${MES}`);
    await p('POST', `/api/cartoes/${nb}/pagar`, { mes: MES });
    await p('POST', `/api/cartoes/${nb}/pagar`, { mes: MES });
    await p('POST', `/api/cartoes/${id.conta.Dinheiro}/pagar`, { mes: MES });
    await p('POST', '/api/cartoes/999999/pagar', { mes: MES });
    await p('POST', `/api/cartoes/${nb}/pagar`, { mes: '2026-13' });
    await p('GET', `/api/cartoes?mes=${MES}`);
    await p('GET', '/api/lembretes?dias=60');
  },

  async 'metas'({ p }) {
    const v = (await p('POST', '/api/metas', { nome: ' Viagem ', alvo: 5000, prazo: dia(somarMeses(MES, 7), 28) })).corpo.id;
    const r = (await p('POST', '/api/metas', { nome: 'Reserva', alvo: 1000 })).corpo.id;
    await p('POST', '/api/metas', { nome: 'reserva', alvo: 10 });
    await p('POST', '/api/metas', { nome: '', alvo: 10 });
    await p('POST', '/api/metas', { nome: 'A', alvo: 0 });
    await p('POST', '/api/metas', { nome: 'A', alvo: 10, prazo: '31/12/2026' });
    await p('POST', `/api/metas/${r}/aportes`, { valor: 300.5, nota: 'salário' });
    await p('POST', `/api/metas/${r}/aportes`, { valor: 100.5, retirada: true, data: HOJE });
    await p('POST', `/api/metas/${r}/aportes`, { valor: 999, retirada: true });
    await p('POST', `/api/metas/${r}/aportes`, { valor: 0 });
    await p('POST', `/api/metas/${r}/aportes`, { valor: 1, data: '2026-02-30' });
    await p('POST', `/api/metas/${r}/aportes`, { valor: 1, nota: 'x'.repeat(101) });
    await p('POST', `/api/metas/${v}/aportes`, { valor: 750.5 });
    await p('PUT', `/api/metas/${v}`, { nome: 'Viagem longa', alvo: 6000, prazo: dia(somarMeses(MES, 9), 15) });
    await p('PUT', `/api/metas/${v}`, { nome: 'RESERVA', alvo: 1 });
    const lista = (await p('GET', '/api/metas')).corpo;
    const ret = lista.find((m) => m.nome === 'Reserva').aportes.find((a) => a.valor < 0).id;
    const dep = lista.find((m) => m.nome === 'Reserva').aportes.find((a) => a.valor > 0).id;
    await p('DELETE', `/api/aportes/${dep}`);
    await p('DELETE', `/api/aportes/${ret}`);
    await p('DELETE', `/api/aportes/${dep}`);
    await p('DELETE', `/api/aportes/${dep}`);
    await p('DELETE', `/api/metas/${r}`);
    await p('DELETE', `/api/metas/${r}`);
    await p('GET', '/api/metas');
  },

  async 'configurações, lembretes e registro de backup'({ p, ids }) {
    const id = await ids();
    await p('GET', '/api/config');
    await p('PUT', '/api/config', { lembretes: { ativo: true, diasAntes: 3 } });
    await p('PUT', '/api/config', { backup: { automatico: true } });
    await p('PUT', '/api/config', { lembretes: { diasAntes: 4 } });
    await p('PUT', '/api/config', { lembretes: { hora: 24 } });
    await p('GET', '/api/config');
    await p('GET', '/api/lembretes');
    await p('POST', '/api/lancamentos', lanc(id, { descricao: 'Luz', data: dia(ANTERIOR, 10), valor: 200, status: 'Pendente' }));
    await p('POST', '/api/lancamentos', lanc(id, { descricao: 'Aluguel', data: HOJE, valor: 1500, status: 'Pendente', categoriaId: id.cat.Moradia }));
    await p('POST', '/api/lancamentos', lanc(id, { descricao: 'Salário', data: HOJE, tipo: 'Receita', categoriaId: id.cat['Salário'], valor: 5000, status: 'Pendente' }));
    await p('GET', '/api/lembretes');
    await p('GET', '/api/lembretes?dias=0');
    await p('GET', '/api/lembretes?dias=61');
    await p('GET', '/api/lembretes?dias=abc');
    await p('POST', '/api/backup/registrar', {});
    await p('POST', '/api/backup/registrar', { automatico: true });
    await p('GET', '/api/lembretes');
    await p('GET', '/api/config');
  },

  async 'painel: tipos de gráfico e seções visíveis'({ p }) {
    await p('GET', '/api/config');
    await p('PUT', '/api/config', { painel: { despesasCategoria: { tipo: 'rosca' }, ritmo: { visivel: false } } });
    await p('PUT', '/api/config', { painel: { despesasCategoria: { visivel: false }, evolucao: { tipo: 'linhas' } } });
    await p('PUT', '/api/config', { painel: { fixas: { tipo: 'pizza' }, maioresDespesas: { tipo: 'barras' } }, lembretes: { hora: 7 } });
    for (const ruim of ['rosca', [], null, { graficoNovo: {} }, { evolucao: 'barras' }, { evolucao: { tipo: 'pizza' } },
      { ritmo: { tipo: 'barras' } }, { fixas: { visivel: 'nao' } }, { fixas: { tipo: 'rosca' }, orcamento: { tipo: 'x' } }]) {
      await p('PUT', '/api/config', { painel: ruim, lembretes: { hora: 5 } });
    }
    await p('PUT', '/api/config', { lembretes: { hora: 24 }, painel: { fixas: { tipo: 'x' } } });
    await p('PUT', '/api/config', { painel: {} });
    await p('GET', '/api/config');
  },
};

// ------------------------------------------------------------------ backup e CSV entre servidor e motor

async function testarBackupECsv() {
  // Monta os mesmos dados no motor e importa no servidor: depois, as listas precisam ser iguais.
  const mot = new ClienteMotor();
  const id = {
    cat: Object.fromEntries(mot.estado.categorias.map((c) => [c.nome, c.id])),
    conta: Object.fromEntries(mot.estado.contas.map((c) => [c.nome, c.id])),
  };
  await mot.pedir('PUT', `/api/contas/${id.conta['Cartão de crédito']}`, { nome: 'Cartão de crédito', cartao: { fechamento: 5, vencimento: 12 } });
  await mot.pedir('POST', '/api/lancamentos', lanc(id, { descricao: 'Geladeira', valor: 1200, parcelas: 4, contaId: id.conta['Cartão de crédito'], status: 'Pendente' }));
  await mot.pedir('POST', '/api/lancamentos', lanc(id, { descricao: '=SOMA(A1); "teste"', fixa: true }));
  await mot.pedir('POST', '/api/lancamentos', lanc(id, { tipo: 'Receita', categoriaId: id.cat['Salário'], descricao: 'Salário', valor: 5000, fixa: true }));
  await mot.pedir('PUT', '/api/config', { lembretes: { ativo: true, hora: 20 } });
  await mot.pedir('PUT', '/api/config', { painel: { fixasVariaveis: { tipo: 'rosca' }, ritmo: { visivel: false } } });
  const meta = (await mot.pedir('POST', '/api/metas', { nome: 'Casa', alvo: 1000, prazo: dia(PROXIMO, 10) })).corpo.id;
  await mot.pedir('POST', `/api/metas/${meta}/aportes`, { valor: 10, nota: 'início' });
  const backupMotor = JSON.stringify({ app: 'controle-financeiro', exportadoEm: new Date().toISOString(), dados: mot.estado }, null, 2);

  const srv = new ClienteServidor();
  await srv.registrar();
  const imp = await srv.pedir('POST', '/api/backup/importar', backupMotor);
  assert.equal(imp.status, 200, `importar: ${JSON.stringify(imp)}`);

  const comparar = async (url) => {
    const ns = normalizador();
    const nm = normalizador();
    assert.deepEqual(ns(url, await srv.pedir('GET', url)), nm(url, await mot.pedir('GET', url)), `depois de importar, ${url} difere`);
  };
  for (const url of ['/api/categorias', '/api/contas', '/api/metas', '/api/config',
    ...[MES, PROXIMO, somarMeses(MES, 2), somarMeses(MES, 3)].flatMap((m) => [`/api/lancamentos?mes=${m}`, `/api/cartoes?mes=${m}`])]) {
    await comparar(url);
  }
  console.log('ok - backup do app local importado no servidor');

  // CSV: o texto precisa ser idêntico.
  const csvSrv = await srv.pedir('GET', '/api/exportar/csv', undefined, { bruto: true });
  assert.equal(csvSrv.status, 200);
  const csvMot = gerarCsv(mot.estado).texto;
  assert.equal(csvSrv.texto.replace(/^﻿/, ''), csvMot.replace(/^﻿/, ''), 'CSV do servidor difere do motor');
  assert.equal(csvSrv.headers.get('x-quantidade'), String(gerarCsv(mot.estado).quantidade));
  console.log('ok - CSV idêntico');

  // O backup exportado pelo servidor precisa abrir no app local, com os mesmos dados.
  const exp = await srv.pedir('GET', '/api/backup', undefined, { bruto: true });
  assert.equal(exp.status, 200);
  const estadoDoServidor = lerBackup(exp.texto);
  const motVolta = new ClienteMotor();
  motVolta.estado = estadoDoServidor;
  for (const url of ['/api/categorias', '/api/contas', '/api/metas', `/api/lancamentos?mes=${PROXIMO}`, `/api/cartoes?mes=${PROXIMO}`]) {
    const a = normalizador();
    const b = normalizador();
    assert.deepEqual(a(url, await motVolta.pedir('GET', url)), b(url, await mot.pedir('GET', url)), `backup do servidor: ${url} difere`);
  }
  console.log('ok - backup do servidor abre no app local');

  // Arquivo inválido e de outro app são recusados sem apagar nada.
  assert.equal((await srv.pedir('POST', '/api/backup/importar', '{"app":"outro","dados":{}}')).status, 400);
  assert.equal((await srv.pedir('POST', '/api/backup/importar', 'não é json')).status, 400);
  const ruim = JSON.parse(backupMotor);
  ruim.dados.lancamentos[0].categoriaId = 9999;
  const r = await srv.pedir('POST', '/api/backup/importar', JSON.stringify(ruim));
  assert.equal(r.status, 400);
  assert.match(r.corpo.mensagem, /categoria ou conta inexistente/);
  assert.equal((await srv.pedir('GET', `/api/lancamentos?mes=${PROXIMO}`)).corpo.length > 0, true, 'dados continuam lá');
  console.log('ok - backup inválido recusado sem perder dados');
}

// ------------------------------------------------------------------ troca de senha por e-mail

async function ultimoEmailPara(email, depoisDe) {
  for (let i = 0; i < 40; i += 1) {
    const nomes = (await readdir(PASTA_EMAILS).catch(() => [])).sort();
    for (const n of nomes.reverse()) {
      if (n <= depoisDe) continue;
      const t = await readFile(`${PASTA_EMAILS}/${n}`, 'utf8');
      if (t.startsWith(`Para: ${email}\n`)) return { nome: n, texto: t };
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`nenhum e-mail para ${email}`);
}

async function testarTrocaDeSenha() {
  const c = new ClienteServidor();
  await c.registrar();
  await c.pedir('POST', '/api/auth/sair');
  const marca = `${new Date().toISOString().replace(/\D/g, '').slice(0, 17)}`;

  const existe = await c.pedir('POST', '/api/auth/esqueci-senha', { email: c.email });
  const naoExiste = await c.pedir('POST', '/api/auth/esqueci-senha', { email: `ninguem-${Date.now()}@teste.local` });
  assert.equal(existe.status, 200);
  assert.deepEqual(existe, naoExiste, 'a resposta não pode revelar se a conta existe');

  const { texto } = await ultimoEmailPara(c.email, marca);
  const link = texto.match(/https?:\/\/\S+\/redefinir-senha\?\S+/)?.[0];
  assert.ok(link, `link não encontrado no e-mail:\n${texto}`);
  const u = new URL(link);
  assert.equal(u.searchParams.get('email'), c.email);
  const token = u.searchParams.get('token');

  const fraca = await c.pedir('POST', '/api/auth/redefinir-senha', { email: c.email, token, novaSenha: 'fraca' });
  assert.equal(fraca.status, 400);
  const adulterado = await c.pedir('POST', '/api/auth/redefinir-senha', { email: c.email, token: `${token.slice(0, -4)}AAAA`, novaSenha: 'NovaSenha9' });
  assert.equal(adulterado.status, 400);
  assert.match(adulterado.corpo.mensagem, /Link inválido ou expirado/);
  const outroEmail = await c.pedir('POST', '/api/auth/redefinir-senha', { email: 'outro@teste.local', token, novaSenha: 'NovaSenha9' });
  assert.equal(outroEmail.status, 400);

  const ok = await c.pedir('POST', '/api/auth/redefinir-senha', { email: c.email, token, novaSenha: 'NovaSenha9' });
  assert.equal(ok.status, 204, JSON.stringify(ok));
  const deNovo = await c.pedir('POST', '/api/auth/redefinir-senha', { email: c.email, token, novaSenha: 'OutraSenha9' });
  assert.equal(deNovo.status, 400, 'o link só vale uma vez');

  assert.equal((await c.pedir('POST', '/api/auth/entrar', { email: c.email, senha: SENHA })).status, 401, 'senha antiga não entra');
  assert.equal((await c.pedir('POST', '/api/auth/entrar', { email: c.email, senha: 'NovaSenha9' })).status, 200, 'senha nova entra');
  console.log('ok - troca de senha por e-mail');
}

// ------------------------------------------------------------------ isolamento entre usuários

async function testarIsolamento() {
  const a = new ClienteServidor();
  await a.registrar();
  const b = new ClienteServidor();
  await b.registrar();
  const catA = (await a.pedir('GET', '/api/categorias')).corpo[0].id;
  const contaA = (await a.pedir('GET', '/api/contas')).corpo[0].id;
  const l = (await a.pedir('POST', '/api/lancamentos', {
    data: HOJE, tipo: 'Despesa', categoriaId: catA, descricao: 'Segredo', contaId: contaA, valor: 10, status: 'Pendente',
  })).corpo;
  const meta = (await a.pedir('POST', '/api/metas', { nome: 'Só da A', alvo: 10 })).corpo.id;
  assert.equal((await b.pedir('DELETE', `/api/lancamentos/${l.id}`)).status, 404);
  assert.equal((await b.pedir('PATCH', `/api/lancamentos/${l.id}/fixa`, { fixa: true })).status, 404);
  assert.equal((await b.pedir('DELETE', `/api/metas/${meta}`)).status, 404);
  assert.equal((await b.pedir('POST', `/api/metas/${meta}/aportes`, { valor: 1 })).status, 404);
  assert.equal((await b.pedir('POST', `/api/cartoes/${contaA}/pagar`, { mes: MES })).status, 404);
  assert.ok(!(await b.pedir('GET', `/api/lancamentos?mes=${MES}`)).corpo.some((x) => x.descricao === 'Segredo'));
  assert.ok(!(await b.pedir('GET', '/api/exportar/csv', undefined, { bruto: true })).texto.includes('Segredo'));
  const anonimo = new ClienteServidor();
  assert.equal((await anonimo.pedir('GET', '/api/dashboard')).status, 401);
  console.log('ok - um usuário não vê nem altera dados de outro');
}

let falhas = 0;
for (const [nome, cenario] of Object.entries(cenarios)) {
  try { await rodar(nome, cenario); } catch (e) { falhas += 1; console.error(`FALHOU - ${nome}\n${e.message}\n`); }
}
for (const [nome, fn] of [['backup e CSV', testarBackupECsv], ['troca de senha', testarTrocaDeSenha], ['isolamento', testarIsolamento]]) {
  try { await fn(); } catch (e) { falhas += 1; console.error(`FALHOU - ${nome}\n${e.message}\n`); }
}
console.log(falhas ? `\n${falhas} grupo(s) com falha` : '\ntodos os contratos conferem');
process.exit(falhas ? 1 : 0);
