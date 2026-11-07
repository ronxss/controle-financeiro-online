// Autenticador WebAuthn em software, para os testes de contrato conferirem as passkeys do servidor de verdade
// (sem navegador): gera chaves P-256, monta attestationObject "none" e assinaturas ECDSA como um celular faria.
import { webcrypto as wc } from 'node:crypto';

const te = new TextEncoder();
export const b64url = (bytes) => Buffer.from(bytes).toString('base64url');
export const deB64url = (s) => new Uint8Array(Buffer.from(s, 'base64url'));
const concat = (...partes) => {
  const out = new Uint8Array(partes.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of partes) { out.set(p, i); i += p.length; }
  return out;
};
const sha256 = async (bytes) => new Uint8Array(await wc.subtle.digest('SHA-256', bytes));

// ---- CBOR mínimo (inteiros, bytes, texto, mapas) ----
function cabecalho(tipo, n) {
  if (n < 24) return Uint8Array.of((tipo << 5) | n);
  if (n < 256) return Uint8Array.of((tipo << 5) | 24, n);
  if (n < 65536) return Uint8Array.of((tipo << 5) | 25, n >> 8, n & 255);
  return Uint8Array.of((tipo << 5) | 26, (n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255);
}
export function cbor(v) {
  if (typeof v === 'number') return v >= 0 ? cabecalho(0, v) : cabecalho(1, -1 - v);
  if (v instanceof Uint8Array) return concat(cabecalho(2, v.length), v);
  if (typeof v === 'string') { const b = te.encode(v); return concat(cabecalho(3, b.length), b); }
  if (v instanceof Map) return concat(cabecalho(5, v.size), ...[...v].flatMap(([k, x]) => [cbor(k), cbor(x)]));
  throw new Error(`cbor: tipo não suportado ${typeof v}`);
}

// Assinatura do WebCrypto (r||s, 64 bytes) -> DER, que é o formato do WebAuthn.
function der(rs) {
  const inteiro = (b) => {
    let i = 0;
    while (i < b.length - 1 && b[i] === 0) i += 1;
    let x = b.slice(i);
    if (x[0] & 0x80) x = concat(Uint8Array.of(0), x);
    return concat(Uint8Array.of(0x02, x.length), x);
  };
  const corpo = concat(inteiro(rs.slice(0, 32)), inteiro(rs.slice(32)));
  return concat(Uint8Array.of(0x30, corpo.length), corpo);
}

const UP = 0x01, UV = 0x04, BE = 0x08, BS = 0x10, AT = 0x40;

export class Autenticador {
  constructor(origem) { this.origem = origem; this.credenciais = new Map(); }

  /** Responde às opções de navigator.credentials.create() (JSON do servidor). Devolve o JSON de RegistrationResponse. */
  async criar(opcoes, { uv = true } = {}) {
    const par = await wc.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const bruto = new Uint8Array(await wc.subtle.exportKey('raw', par.publicKey)); // 04 | x | y
    const credId = wc.getRandomValues(new Uint8Array(32));
    const cose = cbor(new Map([[1, 2], [3, -7], [-1, 1], [-2, bruto.slice(1, 33)], [-3, bruto.slice(33)]]));
    const rpId = opcoes.rp.id;
    const authData = concat(
      await sha256(te.encode(rpId)), Uint8Array.of(UP | (uv ? UV : 0) | BE | BS | AT), Uint8Array.of(0, 0, 0, 0),
      new Uint8Array(16), Uint8Array.of(credId.length >> 8, credId.length & 255), credId, cose,
    );
    const clientData = te.encode(JSON.stringify({ type: 'webauthn.create', challenge: opcoes.challenge, origin: this.origem, crossOrigin: false }));
    const attestation = cbor(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]]));
    this.credenciais.set(b64url(credId), { chave: par.privateKey, rpId, userHandle: opcoes.user.id, contador: 0 });
    return {
      id: b64url(credId), rawId: b64url(credId), type: 'public-key', authenticatorAttachment: 'platform',
      response: { clientDataJSON: b64url(clientData), attestationObject: b64url(attestation), transports: ['internal'] },
      clientExtensionResults: {},
    };
  }

  /** Responde às opções de navigator.credentials.get(). `credId` escolhe a passkey (o celular mostraria a lista). */
  async assinar(opcoes, credId, { uv = true, origem = this.origem, rpId, adulterar = false } = {}) {
    const c = this.credenciais.get(credId);
    if (!c) throw new Error('credencial desconhecida no autenticador');
    c.contador += 1;
    const authData = concat(
      await sha256(te.encode(rpId ?? opcoes.rpId ?? c.rpId)), Uint8Array.of(UP | (uv ? UV : 0) | BE | BS),
      Uint8Array.of((c.contador >>> 24) & 255, (c.contador >> 16) & 255, (c.contador >> 8) & 255, c.contador & 255),
    );
    const clientData = te.encode(JSON.stringify({ type: 'webauthn.get', challenge: opcoes.challenge, origin: origem, crossOrigin: false }));
    const sig = new Uint8Array(await wc.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, c.chave, concat(authData, await sha256(clientData))));
    if (adulterar) sig[10] ^= 0xff;
    return {
      id: credId, rawId: credId, type: 'public-key', authenticatorAttachment: 'platform',
      response: { clientDataJSON: b64url(clientData), authenticatorData: b64url(authData), signature: b64url(der(sig)), userHandle: c.userHandle },
      clientExtensionResults: {},
    };
  }
}
