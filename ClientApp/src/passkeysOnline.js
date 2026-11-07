// Entrar com o desbloqueio do aparelho na versão online: passkeys conferidas pelo servidor (ASP.NET Core Identity).
// O servidor gera as opções em JSON; aqui elas viram o formato do navegador, e a resposta do aparelho volta em JSON.
// Conversão feita à mão (base64url <-> bytes) porque os atalhos parse*FromJSON/toJSON não existem em iPhones mais antigos.
import { api } from './api.js';

const CHAVE_APARELHO = 'cf.passkey-neste-aparelho'; // { id, email } da passkey criada aqui (não é segredo)
const chaveDispensado = (email) => `cf.passkey-dispensado:${email}`;

const deB64url = (s) => {
  const b = String(s).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b + '='.repeat((4 - (b.length % 4)) % 4)), (c) => c.charCodeAt(0));
};
const paraB64url = (buf) => {
  let t = '';
  for (const b of new Uint8Array(buf)) t += String.fromCharCode(b);
  return btoa(t).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const lerJson = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const gravar = (k, v) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignora */ } };

/** Passkey criada neste aparelho ({ id, email }) ou null. */
export const passkeyDesteAparelho = () => lerJson(CHAVE_APARELHO);

export async function passkeysDisponiveis() {
  try {
    if (!window.isSecureContext || !window.PublicKeyCredential || !navigator.credentials) return false;
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

/** Um nome para a lista de aparelhos (só para a pessoa reconhecer). */
export function nomeDoAparelho() {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad|Macintosh/.test(ua) && navigator.maxTouchPoints > 1) return 'iPad';
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'Celular Android' : 'Tablet Android';
  if (/Macintosh/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Computador Windows';
  return 'Aparelho';
}

function opcoesCriacao(j) {
  return {
    ...j,
    challenge: deB64url(j.challenge),
    user: { ...j.user, id: deB64url(j.user.id) },
    excludeCredentials: (j.excludeCredentials ?? []).map((c) => ({ ...c, id: deB64url(c.id) })),
  };
}
function opcoesEntrada(j) {
  return { ...j, challenge: deB64url(j.challenge), allowCredentials: (j.allowCredentials ?? []).map((c) => ({ ...c, id: deB64url(c.id) })) };
}

function credencialJson(cred) {
  if (typeof cred.toJSON === 'function') { try { return JSON.stringify(cred.toJSON()); } catch { /* monta à mão */ } }
  const r = cred.response;
  const response = r.attestationObject
    ? { clientDataJSON: paraB64url(r.clientDataJSON), attestationObject: paraB64url(r.attestationObject), transports: r.getTransports?.() ?? [] }
    : {
      clientDataJSON: paraB64url(r.clientDataJSON), authenticatorData: paraB64url(r.authenticatorData),
      signature: paraB64url(r.signature), userHandle: r.userHandle ? paraB64url(r.userHandle) : null,
    };
  return JSON.stringify({
    id: cred.id, rawId: paraB64url(cred.rawId), type: cred.type, response,
    authenticatorAttachment: cred.authenticatorAttachment ?? null, clientExtensionResults: cred.getClientExtensionResults?.() ?? {},
  });
}

function traduzir(e) {
  if (e?.name === 'NotAllowedError' || e?.name === 'AbortError') return new Error('O desbloqueio foi cancelado ou o tempo acabou.');
  if (e?.name === 'InvalidStateError') return new Error('Este aparelho já está ativado para esta conta.');
  if (e?.name === 'SecurityError') return new Error('O desbloqueio só funciona no endereço oficial do site, com HTTPS.');
  if (e?.name === 'NotSupportedError') return new Error('Este aparelho não oferece o desbloqueio para sites.');
  return e instanceof Error ? e : new Error('Não foi possível usar o desbloqueio do aparelho.');
}

// ---------- Entrar ----------

/** Pede ao servidor um desafio de entrada (antes do toque: o Safari só mostra o Face ID logo depois de um toque). */
export const prepararEntrada = () => api.post('/api/auth/passkeys/opcoes-entrada');

/** No toque: mostra o desbloqueio e devolve a credencial em JSON para o servidor. */
export async function assinarEntrada(opcoes) {
  try {
    return credencialJson(await navigator.credentials.get({ publicKey: opcoesEntrada(opcoes) }));
  } catch (e) {
    throw traduzir(e);
  }
}

// ---------- Ativar ----------

// Senha digitada no login, guardada só na memória por 5 minutos, para a oferta de ativar ser um toque só.
let senhaRecente = null;
let limpeza = null;
export function lembrarSenhaRecente(senha) {
  senhaRecente = senha;
  clearTimeout(limpeza);
  limpeza = setTimeout(() => { senhaRecente = null; }, 5 * 60 * 1000);
}
export const esquecerSenhaRecente = () => { senhaRecente = null; clearTimeout(limpeza); };
export const temSenhaRecente = () => Boolean(senhaRecente);

/** Passo 1: confere a senha no servidor e recebe as opções de criação. */
export async function prepararAtivacao(senha) {
  const opcoes = await api.post('/api/auth/passkeys/opcoes-criacao', { senha: senha ?? senhaRecente ?? '' });
  return opcoes;
}

/** Passo 2, no toque: cria a passkey e registra no servidor. */
export async function ativarNesteAparelho(opcoes, email) {
  let cred;
  try {
    cred = await navigator.credentials.create({ publicKey: opcoesCriacao(opcoes) });
  } catch (e) {
    throw traduzir(e);
  }
  const r = await api.post('/api/auth/passkeys', { credencial: credencialJson(cred), nome: nomeDoAparelho() });
  gravar(CHAVE_APARELHO, { id: r.id, email });
  esquecerSenhaRecente();
  return r.passkeys;
}

export const listarPasskeys = () => api.get('/api/auth/passkeys');

export async function removerPasskey(id) {
  const lista = await api.delete(`/api/auth/passkeys/${encodeURIComponent(id)}`);
  if (passkeyDesteAparelho()?.id === id) gravar(CHAVE_APARELHO, null);
  return lista;
}

/** Oferecer logo depois do login com senha? (aparelho compatível, ainda sem passkey aqui, não dispensado) */
export async function deveOfertar(email) {
  if (!senhaRecente || passkeyDesteAparelho()) return false;
  if (lerJson(chaveDispensado(email))) return false;
  return passkeysDisponiveis();
}
export function dispensarOferta(email) {
  esquecerSenhaRecente();
  gravar(chaveDispensado(email), true);
}
