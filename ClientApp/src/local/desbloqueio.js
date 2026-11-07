// Desbloqueio do aparelho no modo local: passkey (WebAuthn) com a extensão PRF.
//
// O PRF devolve 32 bytes que dependem da passkey e de um "sal" nosso, e o aparelho só os entrega depois de
// verificar a pessoa (Face ID, digital, PIN ou padrão). Esses bytes abrem a chave dos dados (veja usuarios.js).
// Não há servidor: a assinatura da passkey não é conferida por ninguém; quem protege é o segredo do PRF.
//
// Funciona no Safari do iPhone (iOS 18+) e no Chrome do Android com passkeys do Gerenciador de Senhas do Google.
// Onde não houver PRF, a ativação avisa e nada muda: a pessoa continua entrando com a senha.

const aleatorio = (n) => crypto.getRandomValues(new Uint8Array(n));

const paraB64url = (bytes) => {
  let t = '';
  for (const b of new Uint8Array(bytes)) t += String.fromCharCode(b);
  return btoa(t).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const deB64url = (texto) => {
  const b = String(texto).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b + '='.repeat((4 - (b.length % 4)) % 4)), (c) => c.charCodeAt(0));
};

const ehApk = () => Boolean(globalThis.Capacitor?.isNativePlatform?.());

/** O aparelho tem desbloqueio com biometria/PIN que o navegador pode usar? (não garante o PRF; isso só se sabe ao ativar) */
export async function desbloqueioDisponivel() {
  try {
    if (ehApk() || !window.isSecureContext || !window.PublicKeyCredential || !navigator.credentials) return false;
    if (PublicKeyCredential.getClientCapabilities) {
      const cap = await PublicKeyCredential.getClientCapabilities();
      if (cap['extension:prf'] === false || cap.userVerifyingPlatformAuthenticator === false) return false;
      if (cap.userVerifyingPlatformAuthenticator === true) return true;
    }
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

/** Erros do WebAuthn em português, sem detalhes técnicos. */
function traduzir(e) {
  if (e?.name === 'NotAllowedError' || e?.name === 'AbortError') return new Error('O desbloqueio foi cancelado ou o tempo acabou.');
  if (e?.name === 'InvalidStateError') return new Error('Este aparelho já tem um desbloqueio para esta conta. Tente de novo.');
  if (e?.name === 'SecurityError') return new Error('O desbloqueio só funciona no endereço oficial do app, com HTTPS.');
  if (e?.name === 'NotSupportedError') return new Error('Este aparelho não oferece o desbloqueio para apps da web.');
  return e instanceof Error ? e : new Error('Não foi possível usar o desbloqueio do aparelho.');
}

const SEM_PRF = 'Este aparelho ou navegador não permite usar o desbloqueio para proteger os dados. Continue entrando com a senha. (No iPhone é preciso iOS 18 ou mais novo; no Android, o Chrome atualizado.)';

/** Pede ao aparelho o segredo PRF da passkey (mostra o Face ID / digital / PIN). */
export async function obterSegredo({ credId, salPrf }) {
  let cred;
  try {
    cred = await navigator.credentials.get({
      publicKey: {
        challenge: aleatorio(32), rpId: location.hostname, timeout: 120000, userVerification: 'required',
        allowCredentials: [{ type: 'public-key', id: deB64url(credId) }],
        extensions: { prf: { eval: { first: Uint8Array.from(atob(salPrf), (c) => c.charCodeAt(0)) } } },
      },
    });
  } catch (e) {
    throw traduzir(e);
  }
  const r = cred?.getClientExtensionResults?.().prf?.results?.first;
  if (!r) throw new Error(SEM_PRF);
  return new Uint8Array(r);
}

/**
 * Cria a passkey desta conta neste aparelho. Devolve { credId, salPrf, segredo }; `segredo` é null quando o aparelho
 * só o entrega num segundo pedido (como alguns iPhones) — aí a tela pede mais um toque e chama obterSegredo.
 * Deve ser chamada logo no toque do botão: o Safari exige um gesto recente para mostrar o Face ID.
 */
export async function criarPasskey(usuario) {
  const sal = aleatorio(32);
  const salPrf = btoa(String.fromCharCode(...sal));
  let cred;
  try {
    cred = await navigator.credentials.create({
      publicKey: {
        challenge: aleatorio(32),
        rp: { name: 'Controle Financeiro', id: location.hostname },
        user: { id: aleatorio(16), name: usuario.nome, displayName: `${usuario.nome} (Controle Financeiro)` },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'preferred', userVerification: 'required' },
        attestation: 'none', timeout: 120000,
        extensions: { prf: { eval: { first: sal } } },
      },
    });
  } catch (e) {
    throw traduzir(e);
  }
  const prf = cred?.getClientExtensionResults?.().prf;
  if (!prf?.enabled && !prf?.results) throw new Error(SEM_PRF);
  const r = prf.results?.first;
  return { credId: paraB64url(cred.rawId), salPrf, segredo: r ? new Uint8Array(r) : null };
}
