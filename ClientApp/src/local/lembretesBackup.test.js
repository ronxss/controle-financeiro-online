import test from 'node:test';
import assert from 'node:assert/strict';
import { criarEstadoInicial, rotear, ErroLocal, montarBackup, lerBackup, validarEstado, diasEntre, configPadrao, painelPadrao, SECOES_PAINEL } from './engine.js';
import { planejarNotificacoes, reagendar, pedirPermissao } from './notificacoes.js';
import { backupAutomaticoDevido, gravarBackupAutomatico, MANTER } from './backupAutomatico.js';

const AGORA = '2026-11-15T11:00:00.000Z';
const api = (e, metodo, url, corpo, agora = AGORA) => rotear(e, metodo, url, corpo, { agora, hoje: '2026-11-15' }).corpo;
const falha = (fn, status, trecho) =>
  assert.throws(fn, (e) => e instanceof ErroLocal && e.status === status && (!trecho || e.message.includes(trecho)));

const cat = (e, nome) => e.categorias.find((c) => c.nome === nome).id;
function novo(e, extra) {
  return api(e, 'POST', '/api/lancamentos', {
    data: '2026-11-20', tipo: 'Despesa', categoriaId: cat(e, 'Moradia'), descricao: 'Aluguel',
    contaId: e.contas[0].id, valor: 1500, status: 'Pendente', ...extra,
  }).id;
}

// ---------------- Configurações ----------------

test('config: padrão, leitura e alteração parcial', () => {
  const e = criarEstadoInicial();
  assert.deepEqual(api(e, 'GET', '/api/config'), configPadrao());
  const r = rotear(e, 'PUT', '/api/config', { lembretes: { ativo: true, diasAntes: 3 } });
  assert.equal(r.alterou, true);
  assert.deepEqual(r.corpo.lembretes, { ativo: true, diasAntes: 3, hora: 9, detalhes: true });
  api(e, 'PUT', '/api/config', { backup: { automatico: true } });
  assert.equal(e.config.backup.automatico, true);
  assert.equal(e.config.lembretes.diasAntes, 3, 'alterar uma parte não apaga a outra');
  assert.equal(rotear(e, 'PUT', '/api/config', { lembretes: { diasAntes: 3 } }).alterou, false, 'sem mudança, nada a gravar');
});

test('config: rejeita valores inválidos e não deixa editar as datas de backup', () => {
  const e = criarEstadoInicial();
  falha(() => api(e, 'PUT', '/api/config', { lembretes: { diasAntes: 4 } }), 400, 'diasAntes');
  falha(() => api(e, 'PUT', '/api/config', { lembretes: { hora: 24 } }), 400, 'hora');
  falha(() => api(e, 'PUT', '/api/config', { lembretes: { hora: 8.5 } }), 400, 'hora');
  falha(() => api(e, 'PUT', '/api/config', { lembretes: { ativo: 'sim' } }), 400, 'ativo');
  falha(() => api(e, 'PUT', '/api/config', { lembretes: { detalhes: 1 } }), 400, 'detalhes');
  falha(() => api(e, 'PUT', '/api/config', { lembretes: null }), 400, 'lembretes');
  falha(() => api(e, 'PUT', '/api/config', { backup: { automatico: 'x' } }), 400, 'automatico');
  api(e, 'PUT', '/api/config', { backup: { ultimo: '2020-01-01T00:00:00Z' } });
  assert.equal(e.config.backup.ultimo, null);
  assert.deepEqual(e.config, configPadrao(), 'nada mudou depois dos erros');
});

test('config: dados e backups antigos (sem config) ganham o padrão; valores ruins viram padrão', () => {
  const antigo = criarEstadoInicial();
  delete antigo.config;
  assert.deepEqual(validarEstado(antigo).config, configPadrao());
  assert.deepEqual(api(antigo, 'GET', '/api/config'), configPadrao(), 'GET funciona mesmo sem config gravada');

  const e = criarEstadoInicial();
  e.config = { lembretes: { ativo: true, diasAntes: 99, hora: 'nove', detalhes: false }, backup: { automatico: 1, ultimo: 'ontem' } };
  assert.deepEqual(validarEstado(e).config, {
    lembretes: { ativo: true, diasAntes: 1, hora: 9, detalhes: false },
    backup: { automatico: false, ultimo: null, ultimoAutomatico: null },
    painel: painelPadrao(),
  });
  e.config = { lembretes: { ativo: 'sim' }, backup: { automatico: 'sim' } };
  assert.equal(validarEstado(e).config.lembretes.ativo, false, 'texto não liga os lembretes');
  assert.equal(validarEstado(e).config.backup.automatico, false);
});

// ---------------- Painel (tipos de gráfico e seções visíveis) ----------------

test('painel: padrão é tudo visível com o primeiro tipo de cada seção', () => {
  const p = api(criarEstadoInicial(), 'GET', '/api/config').painel;
  assert.deepEqual(Object.keys(p), Object.keys(SECOES_PAINEL));
  for (const [id, tipos] of Object.entries(SECOES_PAINEL)) assert.deepEqual(p[id], { visivel: true, tipo: tipos[0] }, id);
  assert.equal(p.despesasCategoria.tipo, 'barras');
});

test('painel: alteração parcial muda só o que foi enviado', () => {
  const e = criarEstadoInicial();
  const r = api(e, 'PUT', '/api/config', { painel: { despesasCategoria: { tipo: 'rosca' }, ritmo: { visivel: false } } });
  assert.deepEqual(r.painel.despesasCategoria, { visivel: true, tipo: 'rosca' });
  assert.deepEqual(r.painel.ritmo, { visivel: false, tipo: 'lista' });
  assert.deepEqual(r.painel.evolucao, { visivel: true, tipo: 'barras' }, 'outras seções intactas');
  api(e, 'PUT', '/api/config', { painel: { despesasCategoria: { visivel: false } } });
  assert.deepEqual(api(e, 'GET', '/api/config').painel.despesasCategoria, { visivel: false, tipo: 'rosca' }, 'tipo mantido ao ocultar');
  api(e, 'PUT', '/api/config', { lembretes: { hora: 7 } });
  assert.equal(api(e, 'GET', '/api/config').painel.ritmo.visivel, false, 'salvar lembretes não mexe no painel');
});

test('painel: valores inválidos dão 400 e nada muda', () => {
  const e = criarEstadoInicial();
  const antes = structuredClone(e.config);
  const put = (painel) => () => rotear(e, 'PUT', '/api/config', { painel, lembretes: { hora: 5 } }, { agora: AGORA });
  falha(put('rosca'), 400, '"painel"');
  falha(put([]), 400, '"painel"');
  falha(put(null), 400, '"painel"');
  falha(put({ graficoNovo: { tipo: 'barras' } }), 400, '"painel.graficoNovo"');
  falha(put({ evolucao: 'barras' }), 400, '"painel.evolucao"');
  falha(put({ evolucao: { tipo: 'pizza' } }), 400, '"painel.evolucao.tipo"');
  falha(put({ ritmo: { tipo: 'barras' } }), 400, '"painel.ritmo.tipo"');
  falha(put({ fixas: { visivel: 'nao' } }), 400, '"painel.fixas.visivel"');
  falha(put({ fixas: { tipo: 'pizza' }, ritmo: { tipo: 'x' } }), 400, '"painel.ritmo.tipo"');
  assert.deepEqual(e.config, antes, 'nem a parte válida nem os lembretes foram gravados');
});

test('painel: estado antigo e valores ruins viram padrão; viaja no backup', () => {
  const e = criarEstadoInicial();
  e.config = { ...e.config, painel: { fixas: { visivel: false, tipo: 'pizza' }, evolucao: { visivel: 'x', tipo: 'pizza' }, lixo: { tipo: 'a' } } };
  const p = validarEstado(e).config.painel;
  assert.deepEqual(p.fixas, { visivel: false, tipo: 'pizza' });
  assert.deepEqual(p.evolucao, { visivel: true, tipo: 'barras' });
  assert.equal(p.lixo, undefined);

  const velho = criarEstadoInicial();
  delete velho.config.painel;
  assert.equal(api(velho, 'PUT', '/api/config', { painel: { fixas: { tipo: 'pizza' } } }).painel.fixas.tipo, 'pizza');

  api(e, 'PUT', '/api/config', { painel: { maioresDespesas: { tipo: 'barras' } } });
  assert.equal(lerBackup(montarBackup(validarEstado(e))).config.painel.maioresDespesas.tipo, 'barras');
});

test('config viaja no backup', () => {
  const e = criarEstadoInicial();
  api(e, 'PUT', '/api/config', { lembretes: { ativo: true, hora: 20 } });
  assert.equal(lerBackup(montarBackup(e)).config.lembretes.hora, 20);
});

// ---------------- Registro de backup ----------------

test('registrar backup: manual e automático guardam instantes separados', () => {
  const e = criarEstadoInicial();
  const r = rotear(e, 'POST', '/api/backup/registrar', {}, { agora: AGORA });
  assert.equal(r.alterou, true);
  assert.equal(e.config.backup.ultimo, AGORA);
  assert.equal(e.config.backup.ultimoAutomatico, null);
  api(e, 'POST', '/api/backup/registrar', { automatico: true }, '2026-11-16T10:00:00.000Z');
  assert.equal(e.config.backup.ultimoAutomatico, '2026-11-16T10:00:00.000Z');
  assert.equal(e.config.backup.ultimo, AGORA);
  falha(() => api(e, 'POST', '/api/backup/registrar', { automatico: 'sim' }), 400);
  falha(() => api(e, 'GET', '/api/backup/registrar'), 404);
  falha(() => api(e, 'POST', '/api/backup/outra'), 404);
});

// ---------------- Lembretes (avisos do Resumo) ----------------

test('lembretes: atrasados, próximos dias e o que fica de fora', () => {
  const e = criarEstadoInicial();
  novo(e, { descricao: 'Luz', data: '2026-11-10', valor: 200 });                        // atrasada (5 dias)
  novo(e, { descricao: 'Aluguel', data: '2026-11-15' });                                // hoje
  novo(e, { descricao: 'Internet', data: '2026-11-22', valor: 100, fixa: true });       // daqui 7 dias
  novo(e, { descricao: 'Seguro', data: '2026-11-23', valor: 90 });                      // 8 dias: fora
  novo(e, { descricao: 'Mercado', data: '2026-11-16', status: 'PagoRecebido' });        // paga: fora
  novo(e, { descricao: 'Salário', data: '2026-11-18', tipo: 'Receita', categoriaId: cat(e, 'Salário'), valor: 5000 });

  const r = api(e, 'GET', '/api/lembretes');
  assert.equal(r.dias, 7);
  assert.deepEqual(r.atrasados.map((x) => [x.descricao, x.dias]), [['Luz', -5]]);
  assert.deepEqual(r.proximos.map((x) => [x.descricao, x.dias, x.tipo]), [
    ['Aluguel', 0, 'Despesa'], ['Salário', 3, 'Receita'], ['Internet', 7, 'Despesa'],
  ]);
  assert.equal(r.proximos[2].fixa, true);
  assert.equal(r.proximos[0].categoria, 'Moradia');
  assert.deepEqual(r.totais, { despesasAtrasadas: 200, receitasAtrasadas: 0, despesasProximas: 1600, receitasProximas: 5000 });
  assert.ok(!('valorCentavos' in r.proximos[0]), 'não vaza campo interno');

  assert.deepEqual(api(e, 'GET', '/api/lembretes?dias=0').proximos.map((x) => x.descricao), ['Aluguel']);
  assert.equal(api(e, 'GET', '/api/lembretes?dias=8').proximos.length, 4);
  for (const ruim of ['-1', '61', 'abc', '1.5', '']) falha(() => api(e, 'GET', `/api/lembretes?dias=${ruim}`), 400, 'dias');
});

test('lembretes: aviso de backup só quando há lançamentos e o último foi há 7+ dias', () => {
  const e = criarEstadoInicial();
  assert.equal(api(e, 'GET', '/api/lembretes').backup.atrasado, false, 'sem dados: nada a perder');
  novo(e);
  assert.deepEqual(api(e, 'GET', '/api/lembretes').backup, { ultimo: null, diasDesde: null, atrasado: true });

  api(e, 'POST', '/api/backup/registrar', {}, '2026-11-09T12:00:00.000Z'); // 6 dias antes
  assert.deepEqual(api(e, 'GET', '/api/lembretes').backup, { ultimo: '2026-11-09T12:00:00.000Z', diasDesde: 6, atrasado: false });

  e.config.backup.ultimo = '2026-11-08T12:00:00.000Z'; // 7 dias
  assert.equal(api(e, 'GET', '/api/lembretes').backup.atrasado, true);

  api(e, 'POST', '/api/backup/registrar', { automatico: true }, '2026-11-14T12:00:00.000Z'); // o automático conta
  assert.deepEqual(api(e, 'GET', '/api/lembretes').backup, { ultimo: '2026-11-14T12:00:00.000Z', diasDesde: 1, atrasado: false });
});

test('diasEntre atravessa meses, anos e horário de verão', () => {
  assert.equal(diasEntre('2026-11-15', '2026-11-22'), 7);
  assert.equal(diasEntre('2026-12-31', '2027-01-01'), 1);
  assert.equal(diasEntre('2026-03-01', '2026-02-27'), -2);
  assert.equal(diasEntre('2028-02-28', '2028-03-01'), 2);
});

// ---------------- Notificações (APK) ----------------

function estadoComLembretes(cfg = {}) {
  const e = criarEstadoInicial();
  api(e, 'PUT', '/api/config', { lembretes: { ativo: true, diasAntes: 1, hora: 9, ...cfg } });
  return e;
}
const local = (a, m, d, h = 0, min = 0) => new Date(a, m - 1, d, h, min);

test('notificações: desligadas não agendam nada', () => {
  const e = criarEstadoInicial();
  novo(e);
  assert.deepEqual(planejarNotificacoes(e, { agora: local(2026, 11, 15, 8) }), []);
});

test('notificações: aviso antecipado e no dia, na hora escolhida, só pendentes futuros', () => {
  const e = estadoComLembretes({ diasAntes: 3, hora: 20 });
  const aluguel = novo(e, { descricao: 'Aluguel', data: '2026-11-20', valor: 1500 });
  novo(e, { descricao: 'Pago', data: '2026-11-21', status: 'PagoRecebido' });
  novo(e, { descricao: 'Venceu', data: '2026-11-10' });
  const salario = novo(e, { descricao: 'Salário', data: '2026-11-16', tipo: 'Receita', categoriaId: cat(e, 'Salário'), valor: 5000 });

  const p = planejarNotificacoes(e, { agora: local(2026, 11, 15, 21) }); // 15/11 21h
  assert.deepEqual(p.map((x) => [x.lancamentoId, x.quando.getTime(), x.titulo]), [
    // o aviso antecipado do salário seria 13/11 20h (passado): só o do dia
    [salario, local(2026, 11, 16, 20).getTime(), 'Receita prevista para hoje: Salário'],
    [aluguel, local(2026, 11, 17, 20).getTime(), 'Vence em 3 dias: Aluguel'],
    [aluguel, local(2026, 11, 20, 20).getTime(), 'Vence hoje: Aluguel'],
  ]);
  assert.match(p[1].texto, /R\$\s1\.500,00 · Moradia/);
  assert.equal(new Set(p.map((x) => x.id)).size, p.length, 'ids únicos');
  assert.ok(p.every((x) => Number.isInteger(x.id) && x.id < 2 ** 31));
});

test('notificações: "amanhã", sem detalhes, e mesmo dia já passado da hora', () => {
  const e = estadoComLembretes({ diasAntes: 1, detalhes: false });
  novo(e, { data: '2026-11-16' });
  novo(e, { data: '2026-11-15', descricao: 'Hoje' });
  const p = planejarNotificacoes(e, { agora: local(2026, 11, 15, 8) });
  assert.deepEqual(p.map((x) => x.titulo), [
    'Você tem uma conta que vence amanhã', // 15/11 9h, aviso antecipado do dia 16 (mesmo horário: desempata pelo id)
    'Você tem uma conta que vence hoje',  // 15/11 9h (ainda não passou às 8h)
    'Você tem uma conta que vence hoje',  // 16/11 9h
  ]);
  assert.ok(p.every((x) => x.texto === 'Abra o Controle Financeiro para ver.' && !x.titulo.includes('Aluguel')));
  assert.equal(planejarNotificacoes(e, { agora: local(2026, 11, 15, 10) }).length, 1, 'às 10h só sobra o de 16/11');
});

test('notificações: antecedência zero e limite de quantidade (os mais próximos)', () => {
  const e = estadoComLembretes({ diasAntes: 0 });
  for (let d = 16; d <= 30; d += 1) novo(e, { data: `2026-11-${d}`, descricao: `Conta ${d}` });
  const todas = planejarNotificacoes(e, { agora: local(2026, 11, 15, 12) });
  assert.equal(todas.length, 15);
  const cinco = planejarNotificacoes(e, { agora: local(2026, 11, 15, 12), maximo: 5 });
  assert.deepEqual(cinco.map((x) => x.titulo.slice(-7)), ['Conta 16', 'Conta 17', 'Conta 18', 'Conta 19', 'Conta 20'].map((t) => t.slice(-7)));
});

function pluginFalso({ pendentes = [], permissao = 'granted', pedido = 'granted' } = {}) {
  const chamadas = [];
  return {
    chamadas,
    async getPending() { chamadas.push('getPending'); return { notifications: pendentes }; },
    async cancel(op) { chamadas.push(['cancel', op.notifications.map((n) => n.id)]); },
    async schedule(op) { chamadas.push(['schedule', op.notifications]); },
    async checkPermissions() { return { display: permissao }; },
    async requestPermissions() { chamadas.push('requestPermissions'); return { display: pedido }; },
  };
}

test('reagendar: cancela os antigos e agenda os novos; lista vazia só cancela', async () => {
  const LN = pluginFalso({ pendentes: [{ id: 11 }, { id: 20 }] });
  const quando = local(2026, 11, 20, 9);
  await reagendar([{ id: 30, quando, titulo: 'T', texto: 'X', lancamentoId: 3 }], LN);
  assert.deepEqual(LN.chamadas[1], ['cancel', [11, 20]]);
  assert.deepEqual(LN.chamadas[2], ['schedule', [
    { id: 30, title: 'T', body: 'X', schedule: { at: quando, allowWhileIdle: true }, extra: { lancamentoId: 3 } },
  ]]);

  const vazio = pluginFalso({ pendentes: [{ id: 5 }] });
  assert.equal(await reagendar([], vazio), 0);
  assert.deepEqual(vazio.chamadas, ['getPending', ['cancel', [5]]]);

  const nada = pluginFalso();
  await reagendar([], nada);
  assert.deepEqual(nada.chamadas, ['getPending']);
});

test('permissão: já concedida, perguntar, negada', async () => {
  assert.equal(await pedirPermissao(pluginFalso()), true);
  const p = pluginFalso({ permissao: 'prompt', pedido: 'granted' });
  assert.equal(await pedirPermissao(p), true);
  assert.ok(p.chamadas.includes('requestPermissions'));
  assert.equal(await pedirPermissao(pluginFalso({ permissao: 'prompt', pedido: 'denied' })), false);
  const negada = pluginFalso({ permissao: 'denied' });
  assert.equal(await pedirPermissao(negada), false);
  assert.ok(!negada.chamadas.includes('requestPermissions'), 'negada de vez: não insiste');
});

// ---------------- Backup automático (APK) ----------------

test('backup automático: desligado, sem dados, primeira vez, intervalo de 7 dias', () => {
  const e = criarEstadoInicial();
  const agora = local(2026, 11, 15, 10);
  assert.equal(backupAutomaticoDevido(e, agora), false, 'desligado');
  api(e, 'PUT', '/api/config', { backup: { automatico: true } });
  assert.equal(backupAutomaticoDevido(e, agora), false, 'sem lançamentos');
  novo(e);
  assert.equal(backupAutomaticoDevido(e, agora), true, 'nunca feito');
  e.config.backup.ultimoAutomatico = local(2026, 11, 9, 23).toISOString();
  assert.equal(backupAutomaticoDevido(e, agora), false, '6 dias');
  e.config.backup.ultimoAutomatico = local(2026, 11, 8, 0, 1).toISOString();
  assert.equal(backupAutomaticoDevido(e, agora), true, '7 dias');
  e.config.backup.ultimo = agora.toISOString(); // o manual não substitui o automático
  assert.equal(backupAutomaticoDevido(e, agora), true);
});

function fsFalso(arquivos = []) {
  const pasta = new Set(arquivos);
  const ops = [];
  return {
    pasta, ops,
    Directory: { Documents: 'DOCUMENTS' },
    Encoding: { UTF8: 'utf8' },
    Filesystem: {
      async writeFile(op) { ops.push(['write', op.path, op.directory, op.recursive]); pasta.add(op.path.split('/').pop()); return { uri: 'x' }; },
      async readdir(op) { ops.push(['readdir', op.path]); return { files: [...pasta].map((name) => ({ name })) }; },
      async deleteFile(op) { ops.push(['delete', op.path]); pasta.delete(op.path.split('/').pop()); },
    },
  };
}

test('backup automático: grava backup válido e mantém só os 4 mais recentes, sem tocar nos manuais', async () => {
  const e = criarEstadoInicial();
  novo(e);
  const fs = fsFalso([
    'backup-automatico-2026-10-11.json', 'backup-automatico-2026-10-18.json', 'backup-automatico-2026-10-25.json',
    'backup-automatico-2026-11-01.json', 'controle-financeiro-backup-2026-09-01.json', 'backup-automatico-x.json',
  ]);
  const caminho = await gravarBackupAutomatico(e, fs, local(2026, 11, 8, 10));
  assert.equal(caminho, 'Documentos/Controle Financeiro/backup-automatico-2026-11-08.json');
  assert.deepEqual(fs.ops[0], ['write', 'Controle Financeiro/backup-automatico-2026-11-08.json', 'DOCUMENTS', true]);
  assert.deepEqual(fs.ops.filter((o) => o[0] === 'delete'), [['delete', 'Controle Financeiro/backup-automatico-2026-10-11.json']]);
  assert.deepEqual([...fs.pasta].filter((n) => n.startsWith('backup-automatico-2026')).sort(), [
    'backup-automatico-2026-10-18.json', 'backup-automatico-2026-10-25.json', 'backup-automatico-2026-11-01.json', 'backup-automatico-2026-11-08.json',
  ]);
  assert.ok(fs.pasta.has('controle-financeiro-backup-2026-09-01.json') && fs.pasta.has('backup-automatico-x.json'));
  assert.equal(MANTER, 4);
});

test('backup automático: o arquivo gravado pode ser importado; falha ao limpar não invalida', async () => {
  const e = criarEstadoInicial();
  novo(e, { descricao: 'Conta X' });
  let texto;
  const fs = fsFalso();
  fs.Filesystem.writeFile = async (op) => { texto = op.data; };
  fs.Filesystem.readdir = async () => { throw new Error('sem acesso'); };
  await gravarBackupAutomatico(e, fs, local(2026, 11, 8));
  assert.equal(lerBackup(texto).lancamentos[0].descricao, 'Conta X');

  const quebrado = fsFalso();
  quebrado.Filesystem.writeFile = async () => { throw new Error('Permission denied'); };
  await assert.rejects(gravarBackupAutomatico(e, quebrado), /Permission denied/);
});
