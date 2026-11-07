import { test } from 'node:test';
import assert from 'node:assert/strict';
import { criarServicoUsuarios, normalizarNome, validarSenha } from './usuarios.js';
import { criarEstadoInicial, rotear } from './engine.js';

// Armazenamento falso, em memória, com a mesma interface do real. Guarda cópias (como um banco de verdade).
function repoFalso() {
  const m = new Map();
  return {
    m,
    async ler(k) { return m.has(k) ? structuredClone(m.get(k)) : null; },
    async gravar(k, v) { m.set(k, structuredClone(v)); },
    async gravarVarios(pares) { for (const [k, v] of pares) m.set(k, structuredClone(v)); },
    async apagar(k) { m.delete(k); },
  };
}
// 1.000 iterações nos testes (o app usa 600.000): a lógica é a mesma, só roda rápido.
const novo = () => { const repo = repoFalso(); return { repo, svc: criarServicoUsuarios(repo, { iteracoes: 1000 }) }; };
const SENHA = 'Senha123';
const rejeita = (promessa, status, trecho) =>
  assert.rejects(promessa, (e) => e.status === status && (!trecho || e.message.includes(trecho)));

test('criar conta devolve sessão com dados iniciais e registra o usuário', async () => {
  const { svc } = novo();
  const s = await svc.criar('  Maria  Silva ', SENHA);
  assert.equal(s.usuario.nome, 'Maria Silva');
  assert.equal(s.adotouLegado, false);
  assert.ok(s.estado.categorias.length > 0 && s.estado.contas.length > 0);
  assert.deepEqual((await svc.listar()).map((u) => u.nome), ['Maria Silva']);
});

test('entrar com a senha certa recupera exatamente os dados salvos', async () => {
  const { svc } = novo();
  const s = await svc.criar('ana', SENHA);
  const r = rotear(s.estado, 'POST', '/api/lancamentos', {
    data: '2026-11-03', tipo: 'Despesa', categoriaId: s.estado.categorias.find((c) => c.tipo === 'Despesa').id,
    descricao: 'Mercado', contaId: s.estado.contas[0].id, valor: 123.45, status: 'PagoRecebido',
  });
  assert.equal(r.status, 200);
  await svc.salvar(s, s.estado);

  const e = await svc.entrar('ANA', SENHA); // maiúsculas/minúsculas não importam no nome
  assert.deepEqual(e.estado, s.estado);
  assert.equal(e.estado.lancamentos[0].valorCentavos, 12345);
});

test('senha errada e usuário inexistente dão a MESMA mensagem (não revela quem existe)', async () => {
  const { svc } = novo();
  await svc.criar('ana', SENHA);
  await rejeita(svc.entrar('ana', 'Outra1234'), 401, 'Usuário ou senha incorretos.');
  await rejeita(svc.entrar('bia', SENHA), 401, 'Usuário ou senha incorretos.');
  await rejeita(svc.entrar('ana', ''), 401, 'Usuário ou senha incorretos.');
});

test('nome repetido é recusado, ignorando maiúsculas, acentos de composição e espaços', async () => {
  const { svc } = novo();
  await svc.criar('José', SENHA);
  await rejeita(svc.criar('  josé ', SENHA), 409, 'Já existe');
  await rejeita(svc.criar('José'.replace('Jose', 'jose'), SENHA), 409); // "e" + acento combinado
});

test('valida nome e senha', async () => {
  const { svc } = novo();
  await rejeita(svc.criar('a', SENHA), 400, 'nome de usuário');
  await rejeita(svc.criar('x'.repeat(41), SENHA), 400, 'nome de usuário');
  for (const fraca of ['curta1A', 'semmaiuscula1', 'SEMMINUSCULA1', 'SemNumeroAqui', '']) {
    assert.throws(() => validarSenha(fraca), (e) => e.status === 400, fraca);
  }
  assert.equal(validarSenha('Abcdefg1'), 'Abcdefg1');
  assert.equal(normalizarNome('  a   b '), 'a b');
});

test('nada legível fica gravado: os dados e a senha estão cifrados', async () => {
  const { repo, svc } = novo();
  const s = await svc.criar('ana', SENHA);
  s.estado.lancamentos.push({
    id: 1, data: '2026-11-03', tipo: 'Despesa', categoriaId: s.estado.categorias.find((c) => c.tipo === 'Despesa').id,
    descricao: 'Segredo do mercado', contaId: s.estado.contas[0].id, valorCentavos: 100, status: 'Pendente', criadoEm: 'x',
  });
  s.estado.seq.lancamento = 1;
  await svc.salvar(s, s.estado);

  const tudo = JSON.stringify([...repo.m.entries()]);
  for (const proibido of ['Segredo do mercado', 'Alimentação', 'Conta corrente', SENHA]) {
    assert.ok(!tudo.includes(proibido), `"${proibido}" apareceu em claro`);
  }
});

test('cada gravação usa um IV diferente', async () => {
  const { repo, svc } = novo();
  const s = await svc.criar('ana', SENHA);
  const a = (await repo.ler(`estado:${s.usuario.id}`)).iv;
  await svc.salvar(s, s.estado);
  const b = (await repo.ler(`estado:${s.usuario.id}`)).iv;
  assert.notEqual(a, b);
});

test('contas são isoladas: dados de uma não aparecem na outra', async () => {
  const { svc } = novo();
  const a = await svc.criar('ana', SENHA);
  const b = await svc.criar('bia', 'Outra1234');
  a.estado.contas.push({ id: 99, nome: 'Só da Ana' });
  a.estado.seq.conta = 99;
  await svc.salvar(a, a.estado);
  const eb = await svc.entrar('bia', 'Outra1234');
  assert.ok(!eb.estado.contas.some((c) => c.nome === 'Só da Ana'));
  const ea = await svc.entrar('ana', SENHA);
  assert.ok(ea.estado.contas.some((c) => c.nome === 'Só da Ana'));
});

test('blocos cifrados são presos ao id da conta: copiar tudo da conta A para a B não abre', async () => {
  const { repo, svc } = novo();
  const a = await svc.criar('ana', SENHA);
  const b = await svc.criar('bia', 'Outra1234');
  // Deixa B com o MESMO sal, iterações, verificador e dados de A (portanto a mesma chave para a senha SENHA).
  // A única coisa diferente é o id: só o "dado autenticado" do AES-GCM impede que isso abra.
  const lista = await repo.ler('usuarios');
  const ra = lista.find((u) => u.id === a.usuario.id);
  const rb = lista.find((u) => u.id === b.usuario.id);
  Object.assign(rb, { sal: ra.sal, iteracoes: ra.iteracoes, verificador: ra.verificador });
  await repo.gravar('usuarios', lista);
  await repo.gravar(`estado:${b.usuario.id}`, await repo.ler(`estado:${a.usuario.id}`));
  await assert.rejects(svc.entrar('bia', SENHA), (e) => e.status === 401 || e.status === 500);
});

test('dado adulterado no disco é detectado (não abre com lixo)', async () => {
  const { repo, svc } = novo();
  const s = await svc.criar('ana', SENHA);
  const env = await repo.ler(`estado:${s.usuario.id}`);
  const bytes = Buffer.from(env.dados, 'base64');
  bytes[bytes.length >> 1] ^= 0xff;
  await repo.gravar(`estado:${s.usuario.id}`, { ...env, dados: bytes.toString('base64') });
  await rejeita(svc.entrar('ana', SENHA), 500, 'danificados');
});

test('alterar senha: a antiga para de funcionar, a nova abre os mesmos dados', async () => {
  const { svc } = novo();
  const s = await svc.criar('ana', SENHA);
  s.estado.contas.push({ id: 50, nome: 'Minha conta' });
  s.estado.seq.conta = 50;

  await rejeita(svc.alterarSenha(s, 'Errada123', 'NovaSenha9', s.estado), 401, 'senha atual');
  await rejeita(svc.alterarSenha(s, SENHA, 'fraca', s.estado), 400, 'A senha deve');

  const nova = await svc.alterarSenha(s, SENHA, 'NovaSenha9', s.estado);
  assert.equal(nova.usuario.id, s.usuario.id);
  await rejeita(svc.entrar('ana', SENHA), 401);
  const e = await svc.entrar('ana', 'NovaSenha9');
  assert.ok(e.estado.contas.some((c) => c.nome === 'Minha conta'));

  // a sessão devolvida já consegue salvar e reler
  await svc.salvar(nova, e.estado);
  assert.deepEqual((await svc.entrar('ana', 'NovaSenha9')).estado, e.estado);
});

test('excluir remove a conta e os dados, e libera o nome', async () => {
  const { repo, svc } = novo();
  const s = await svc.criar('ana', SENHA);
  await svc.excluir('Ana');
  assert.deepEqual(await svc.listar(), []);
  assert.equal(await repo.ler(`estado:${s.usuario.id}`), null);
  await rejeita(svc.entrar('ana', SENHA), 401);
  await rejeita(svc.excluir('ana'), 404);
  await svc.criar('ana', SENHA); // o nome pode ser usado de novo
});

test('a primeira conta adota os dados antigos (sem senha); a segunda começa limpa', async () => {
  const { repo, svc } = novo();
  const legado = criarEstadoInicial();
  legado.contas.push({ id: 77, nome: 'Conta antiga' });
  legado.seq.conta = 77;
  repo.m.set('principal', legado);

  assert.equal(await svc.temLegado(), true);
  const a = await svc.criar('ana', SENHA);
  assert.equal(a.adotouLegado, true);
  assert.ok(a.estado.contas.some((c) => c.nome === 'Conta antiga'));
  assert.equal(repo.m.has('principal'), false, 'o arquivo antigo, sem senha, deve ser apagado');
  assert.equal(await svc.temLegado(), false);

  const b = await svc.criar('bia', SENHA);
  assert.equal(b.adotouLegado, false);
  assert.ok(!b.estado.contas.some((c) => c.nome === 'Conta antiga'));
});

test('dados antigos inválidos não são adotados nem apagados', async () => {
  const { repo, svc } = novo();
  repo.m.set('principal', { lixo: true });
  assert.equal(await svc.temLegado(), false);
  const a = await svc.criar('ana', SENHA);
  assert.equal(a.adotouLegado, false);
  assert.ok(repo.m.has('principal'));
});

test('conta sem arquivo de dados abre com dados iniciais', async () => {
  const { repo, svc } = novo();
  const s = await svc.criar('ana', SENHA);
  await repo.apagar(`estado:${s.usuario.id}`);
  const e = await svc.entrar('ana', SENHA);
  assert.ok(e.estado.categorias.length > 0);
});

// ---------------- Desbloqueio do aparelho (passkey com PRF) ----------------

const segredo = (n = 7) => new Uint8Array(32).fill(n); // o que o PRF do aparelho devolveria
const passkey = (n = 7) => ({ credId: 'cred-abc_-', salPrf: 'c2FsLXByZg==', segredo: segredo(n) });

test('deriveBits + importKey dá a mesma chave que o deriveKey usado antes (contas antigas continuam abrindo)', async () => {
  const sal = new Uint8Array(16).fill(3);
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(SENHA), 'PBKDF2', false, ['deriveKey', 'deriveBits']);
  const p = { name: 'PBKDF2', salt: sal, iterations: 1000, hash: 'SHA-256' };
  const antiga = await crypto.subtle.deriveKey(p, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const nova = await crypto.subtle.importKey('raw', await crypto.subtle.deriveBits(p, material, 256), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  const iv = new Uint8Array(12);
  const c = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, antiga, new TextEncoder().encode('teste'));
  assert.equal(new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, nova, c)), 'teste');
});

test('desbloqueio: ativar, entrar sem senha e ver os mesmos dados', async () => {
  const { svc, repo } = novo();
  const s = await svc.criar('ana', SENHA);
  rotear(s.estado, 'POST', '/api/categorias', { nome: 'Pets', tipo: 'Despesa' });
  await svc.salvar(s, s.estado);
  assert.equal(await svc.desbloqueioDe('ana'), null);
  assert.equal((await svc.listar())[0].desbloqueio, false);

  await svc.ativarDesbloqueio(s, SENHA, passkey());
  assert.deepEqual(await svc.desbloqueioDe('ANA'), { id: s.usuario.id, nome: 'ana', credId: 'cred-abc_-', salPrf: 'c2FsLXByZg==' });
  assert.equal((await svc.listar())[0].desbloqueio, true);
  assert.ok(!JSON.stringify(repo.m.get('usuarios')).includes(SENHA), 'a senha não é gravada');

  const e = await svc.entrarComDesbloqueio('ana', segredo());
  assert.equal(e.usuario.id, s.usuario.id);
  assert.ok(e.estado.categorias.some((c) => c.nome === 'Pets'));
  // a sessão aberta pelo desbloqueio grava dados que a senha abre
  rotear(e.estado, 'POST', '/api/categorias', { nome: 'Academia', tipo: 'Despesa' });
  await svc.salvar(e, e.estado);
  assert.ok((await svc.entrar('ana', SENHA)).estado.categorias.some((c) => c.nome === 'Academia'));
});

test('desbloqueio: senha errada, segredo errado, dados adulterados e outra conta falham', async () => {
  const { svc, repo } = novo();
  const s = await svc.criar('ana', SENHA);
  const b = await svc.criar('bia', SENHA);
  await rejeita(svc.ativarDesbloqueio(s, 'Errada123', passkey()), 401, 'senha está incorreta');
  await rejeita(svc.ativarDesbloqueio(s, SENHA, { ...passkey(), segredo: new Uint8Array(8) }), 400);
  await rejeita(svc.ativarDesbloqueio(s, SENHA, { ...passkey(), credId: '' }), 400);
  assert.equal(await svc.desbloqueioDe('ana'), null, 'nada foi gravado nas tentativas que falharam');

  await rejeita(svc.entrarComDesbloqueio('ana', segredo()), 401, 'Entre com a senha', 'sem ativar');
  await svc.ativarDesbloqueio(s, SENHA, passkey(7));
  await rejeita(svc.entrarComDesbloqueio('ana', segredo(8)), 401, 'Entre com a senha');
  await rejeita(svc.entrarComDesbloqueio('bia', segredo(7)), 401, 'Entre com a senha');
  await rejeita(svc.entrarComDesbloqueio('ninguem', segredo(7)), 401);

  // o embrulho de uma conta copiado para outra não abre (o id entra no HKDF e no AAD)
  const lista = repo.m.get('usuarios');
  lista.find((u) => u.nome === 'bia').desbloqueio = structuredClone(lista.find((u) => u.nome === 'ana').desbloqueio);
  await rejeita(svc.entrarComDesbloqueio('bia', segredo(7)), 401);
  assert.equal(b.usuario.nome, 'bia');

  // adulterado
  const ana = repo.m.get('usuarios').find((u) => u.nome === 'ana');
  ana.desbloqueio.chave.dados = ana.desbloqueio.chave.dados.replace(/^./, (c) => (c === 'A' ? 'B' : 'A'));
  await rejeita(svc.entrarComDesbloqueio('ana', segredo(7)), 401);
});

test('desbloqueio: desativar e trocar a senha desligam', async () => {
  const { svc } = novo();
  const s = await svc.criar('ana', SENHA);
  await svc.criar('bia', SENHA);
  const sb = await svc.entrar('bia', SENHA);
  await svc.ativarDesbloqueio(s, SENHA, passkey(1));
  await svc.ativarDesbloqueio(sb, SENHA, passkey(2));

  await svc.desativarDesbloqueio(s);
  assert.equal(await svc.desbloqueioDe('ana'), null);
  await rejeita(svc.entrarComDesbloqueio('ana', segredo(1)), 401);
  assert.ok(await svc.desbloqueioDe('bia'), 'a outra conta não muda');
  assert.equal((await svc.entrarComDesbloqueio('bia', segredo(2))).usuario.nome, 'bia');

  await svc.ativarDesbloqueio(s, SENHA, passkey(1));
  const nova = await svc.alterarSenha(s, SENHA, 'NovaSenha9', s.estado);
  assert.equal(await svc.desbloqueioDe('ana'), null, 'trocar a senha desliga o desbloqueio');
  await rejeita(svc.entrarComDesbloqueio('ana', segredo(1)), 401);
  await svc.ativarDesbloqueio(nova, 'NovaSenha9', passkey(3));
  assert.equal((await svc.entrarComDesbloqueio('ana', segredo(3))).usuario.nome, 'ana');
});
