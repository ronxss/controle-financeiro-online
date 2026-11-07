// Contas do modo local, do ponto de vista das telas: criar, entrar, sair, trocar senha, apagar conta.
import {
  servico, abrirSessao, encerrarSessao, sessaoAtual, estadoEmMemoria, atualizarChave,
} from './localApi.js';
import { criarPasskey, desbloqueioDisponivel, obterSegredo } from './desbloqueio.js';

const CHAVE_ULTIMO = 'controle-financeiro:ultimo-usuario';

// Formato que o resto do app já espera de "usuario" (o menu mostra nome e e-mail).
const paraTela = (u) => ({ id: u.id, nome: u.nome, email: 'Dados salvos só neste aparelho', temSenha: true });

/** O último usuário que entrou (só o nome, que não é segredo) — para já vir preenchido na tela de login. */
export function ultimoUsuario() {
  try { return localStorage.getItem(CHAVE_ULTIMO) ?? ''; } catch { return ''; }
}
const lembrar = (nome) => { try { localStorage.setItem(CHAVE_ULTIMO, nome); } catch { /* ignora */ } };

export const listarUsuarios = () => servico.listar();
export const temDadosAntigos = () => servico.temLegado();

// Logo depois de entrar com a senha, o app oferece ligar o desbloqueio sem pedir a senha de novo.
// Ela fica só na memória, por poucos minutos, e é apagada ao responder a oferta ou sair.
let senhaRecente = null;
let limpeza = null;
const guardarSenhaRecente = (senha) => {
  senhaRecente = senha;
  clearTimeout(limpeza);
  limpeza = setTimeout(() => { senhaRecente = null; }, 5 * 60 * 1000);
};
const esquecerSenhaRecente = () => { senhaRecente = null; clearTimeout(limpeza); };
const chaveDispensado = (id) => `controle-financeiro:desbloqueio-dispensado:${id}`;

export async function criarConta(nome, senha) {
  const s = await servico.criar(nome, senha);
  abrirSessao(s);
  lembrar(s.usuario.nome);
  guardarSenhaRecente(senha);
  return { usuario: paraTela(s.usuario), adotouLegado: s.adotouLegado };
}

export async function entrar(nome, senha) {
  const s = await servico.entrar(nome, senha);
  abrirSessao(s);
  lembrar(s.usuario.nome);
  guardarSenhaRecente(senha);
  return paraTela(s.usuario);
}

export function sair() {
  esquecerSenhaRecente();
  encerrarSessao();
}

// ---------- Desbloqueio do aparelho ----------

export { desbloqueioDisponivel };

/** Dados públicos do desbloqueio da conta (pelo nome digitado), ou null. A tela carrega antes, para o toque ir direto ao Face ID. */
export async function desbloqueioDaConta(nome) {
  try { return await servico.desbloqueioDe(nome); } catch { return null; }
}
const temDesbloqueio = async (nome) => Boolean(await desbloqueioDaConta(nome));

/** Entra pedindo o Face ID / digital / PIN do aparelho. `dados` vem de desbloqueioDaConta. */
export async function entrarComDesbloqueio(dados) {
  if (!dados) throw new Error('O desbloqueio do aparelho não está ativado para esta conta. Entre com a senha.');
  const segredo = await obterSegredo(dados); // primeira coisa: o Safari exige um toque recente
  const s = await servico.entrarComDesbloqueio(dados.nome, segredo);
  esquecerSenhaRecente();
  abrirSessao(s);
  lembrar(s.usuario.nome);
  return paraTela(s.usuario);
}

/** Situação para a tela de configuração. */
export async function statusDesbloqueio() {
  const s = sessaoAtual();
  if (!s) return { disponivel: false, ativo: false };
  const [disponivel, ativo] = await Promise.all([desbloqueioDisponivel(), temDesbloqueio(s.usuario.nome)]);
  return { disponivel, ativo };
}

/** Deve oferecer o desbloqueio agora? (acabou de entrar com a senha, aparelho compatível, ainda não ativou nem dispensou) */
export async function deveOfertarDesbloqueio() {
  const s = sessaoAtual();
  if (!s || !senhaRecente) return false;
  try { if (localStorage.getItem(chaveDispensado(s.usuario.id))) return false; } catch { /* sem armazenamento: oferece */ }
  const { disponivel, ativo } = await statusDesbloqueio();
  return disponivel && !ativo;
}

export function dispensarOfertaDesbloqueio() {
  const s = sessaoAtual();
  esquecerSenhaRecente();
  if (s) try { localStorage.setItem(chaveDispensado(s.usuario.id), '1'); } catch { /* ignora */ }
}

/** Há senha conferida na memória (entrou agora ou confirmou)? Então a ativação é só um toque. */
export const temSenhaConferida = () => Boolean(senhaRecente);

/** Passo 1 (quando não acabou de entrar): confere a senha antes de criar a passkey, para não criar uma à toa. */
export async function conferirSenha(senha) {
  const s = sessaoAtual();
  if (!s) throw new Error('Entre na sua conta para continuar.');
  await servico.entrar(s.usuario.nome, senha).catch(() => { throw new Error('A senha está incorreta.'); });
  guardarSenhaRecente(senha);
}

/**
 * Passo 2, no toque do botão: cria a passkey (mostra o Face ID / digital / PIN).
 * Devolve null se já ficou ativo, ou a passkey sem segredo, que precisa de concluirDesbloqueio num novo toque.
 */
export async function ativarDesbloqueio() {
  const s = sessaoAtual();
  if (!s) throw new Error('Entre na sua conta para continuar.');
  if (!senhaRecente) throw new Error('Confirme a sua senha para ativar.');
  const passkey = await criarPasskey(s.usuario);
  if (!passkey.segredo) return passkey;
  await gravarDesbloqueio(s, passkey);
  return null;
}

/** Passo 3, só em alguns aparelhos: novo toque para o aparelho entregar o segredo. */
export async function concluirDesbloqueio(passkey) {
  const s = sessaoAtual();
  if (!s) throw new Error('Entre na sua conta para continuar.');
  await gravarDesbloqueio(s, { ...passkey, segredo: await obterSegredo(passkey) });
}

async function gravarDesbloqueio(s, passkey) {
  if (!senhaRecente) throw new Error('O tempo para ativar acabou. Confirme a sua senha de novo.');
  await servico.ativarDesbloqueio(s, senhaRecente, passkey);
  esquecerSenhaRecente();
}

export async function desativarDesbloqueio() {
  const s = sessaoAtual();
  if (!s) throw new Error('Entre na sua conta para continuar.');
  await servico.desativarDesbloqueio(s);
}

export async function alterarSenha(senhaAtual, novaSenha) {
  const s = sessaoAtual();
  if (!s) throw new Error('Entre na sua conta para continuar.');
  atualizarChave(await servico.alterarSenha(s, senhaAtual, novaSenha, estadoEmMemoria())); // também desliga o desbloqueio
  esquecerSenhaRecente();
}

export const excluirConta = (nome) => servico.excluir(nome);
