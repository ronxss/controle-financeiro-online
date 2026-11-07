// Usuários e senhas do modo local.
//
// Não existe servidor: as contas vivem no próprio aparelho. Para a senha ter efeito de verdade (e não ser só uma
// tela de "porta aberta" que qualquer um contorna lendo o banco do navegador), os dados de cada usuário são
// CRIPTOGRAFADOS com uma chave derivada da senha:
//
//   senha --PBKDF2-SHA256 (muitas iterações, sal único por usuário)--> chave AES-256-GCM
//
// - A senha nunca é gravada. A chave só existe na memória enquanto a pessoa está logada.
// - Para conferir a senha, tenta-se abrir um pequeno "verificador" cifrado com a mesma chave. Se o AES-GCM abrir,
//   a senha está certa (ele detecta qualquer chave errada ou dado adulterado).
// - Cada gravação usa um IV novo e aleatório. O id do usuário entra como "dado autenticado": um bloco cifrado de
//   uma conta não abre se for copiado para outra.
//
// DESBLOQUEIO DO APARELHO (opcional): uma passkey com a extensão PRF do WebAuthn devolve um segredo que só sai do
// celular depois do Face ID, digital ou PIN. Esse segredo (via HKDF) cifra os bits da chave da senha. Para entrar,
// o aparelho é desbloqueado, o segredo volta e abre a chave. A senha continua sem ser gravada, e trocá-la desliga
// o desbloqueio (ele guardava a chave antiga). A parte do navegador fica em desbloqueio.js; aqui só os bytes.
//
// LIMITE IMPORTANTE: não há recuperação de senha. Sem a senha, os dados ficam ilegíveis para todos, inclusive para
// o autor do app. O backup (Exportar/Importar) é a rede de segurança — e o arquivo de backup NÃO é criptografado.
//
// Este arquivo não usa DOM: roda no navegador e no Node (testes com `node --test`).
import { criarEstadoInicial, validarEstado, ErroLocal } from './engine.js';

export const ITERACOES = 600_000; // recomendação atual (OWASP) para PBKDF2-HMAC-SHA256

const CHAVE_USUARIOS = 'usuarios';
const CHAVE_LEGADO = 'principal'; // versão anterior do app: um único conjunto de dados, sem senha
const chaveEstado = (id) => `estado:${id}`;
const aadEstado = (id) => `estado:${id}`;
const aadVerificador = (id) => `verificador:${id}`;
const aadDesbloqueio = (id) => `desbloqueio:${id}`;

const codificar = new TextEncoder();
const decodificar = new TextDecoder();

// ---------- Regras de entrada ----------

export function normalizarNome(nome) {
  return String(nome ?? '').normalize('NFC').trim().replace(/\s+/g, ' ');
}
const comparavel = (nome) => normalizarNome(nome).toLocaleLowerCase('pt-BR');

export function validarNome(nome) {
  const n = normalizarNome(nome);
  if (n.length < 2 || n.length > 40 || /\p{Cc}/u.test(n)) {
    throw new ErroLocal('Informe um nome de usuário com 2 a 40 caracteres.', 400);
  }
  return n;
}

export function validarSenha(senha) {
  const s = String(senha ?? '');
  if (s.length < 8 || s.length > 200 || !/\p{Ll}/u.test(s) || !/\p{Lu}/u.test(s) || !/\d/u.test(s)) {
    throw new ErroLocal('A senha deve ter pelo menos 8 caracteres, com letra maiúscula, minúscula e número.', 400);
  }
  return s;
}

// ---------- Criptografia (Web Crypto) ----------

function paraB64(bytes) {
  const u8 = new Uint8Array(bytes);
  let texto = '';
  for (let i = 0; i < u8.length; i += 0x8000) texto += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(texto);
}
const deB64 = (texto) => Uint8Array.from(atob(texto), (c) => c.charCodeAt(0));

const aleatorio = (n) => crypto.getRandomValues(new Uint8Array(n));
const idAleatorio = () => Array.from(aleatorio(12), (b) => b.toString(16).padStart(2, '0')).join('');

/** Os 256 bits da chave da senha (PBKDF2). São os mesmos que um deriveKey para AES-256 produziria. */
async function derivarBits(senha, sal, iteracoes) {
  const material = await crypto.subtle.importKey('raw', codificar.encode(senha.normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: sal, iterations: iteracoes, hash: 'SHA-256' }, material, 256));
}

// A chave não pode ser extraída do navegador.
const chaveDeBits = (bits) => crypto.subtle.importKey('raw', bits, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);

async function derivarChave(senha, sal, iteracoes) {
  return chaveDeBits(await derivarBits(senha, sal, iteracoes));
}

/** Chave que embrulha a chave da senha, a partir do segredo PRF da passkey (HKDF-SHA256, amarrada à conta). */
async function chaveDoDesbloqueio(segredo, id) {
  const base = await crypto.subtle.importKey('raw', new Uint8Array(segredo), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: codificar.encode(`controle-financeiro:desbloqueio:${id}`) },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  );
}

async function cifrar(chave, valor, aad) {
  const iv = aleatorio(12);
  const dados = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: codificar.encode(aad) },
    chave,
    codificar.encode(JSON.stringify(valor)),
  );
  return { iv: paraB64(iv), dados: paraB64(dados) };
}

/** Devolve o valor original ou lança Error se a chave estiver errada ou o dado tiver sido alterado. */
async function decifrar(chave, envelope, aad) {
  const aberto = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: deB64(envelope.iv), additionalData: codificar.encode(aad) },
    chave,
    deB64(envelope.dados),
  );
  return JSON.parse(decodificar.decode(aberto));
}

// ---------- Serviço ----------

/**
 * `repo` é o armazenamento: { ler(chave), gravar(chave, valor), gravarVarios([[chave, valor], ...]), apagar(chave) }.
 * `gravarVarios` precisa ser atômico quando possível (tudo ou nada).
 */
export function criarServicoUsuarios(repo, { iteracoes = ITERACOES } = {}) {
  const lerLista = async () => (await repo.ler(CHAVE_USUARIOS)) ?? [];
  const achar = (lista, nome) => lista.find((u) => u.nomeNorm === comparavel(nome));
  const credenciaisInvalidas = () => new ErroLocal('Usuário ou senha incorretos.', 401);

  async function estadoLegado() {
    const bruto = await repo.ler(CHAVE_LEGADO);
    if (!bruto) return null;
    try { return validarEstado(bruto); } catch { return null; }
  }

  /** Confere a senha. Devolve { chave, bits } ou lança "usuário ou senha incorretos". */
  async function verificarComBits(registro, senha) {
    const bits = await derivarBits(String(senha ?? ''), deB64(registro.sal), registro.iteracoes);
    const chave = await chaveDeBits(bits);
    try {
      await decifrar(chave, registro.verificador, aadVerificador(registro.id));
    } catch {
      throw credenciaisInvalidas();
    }
    return { chave, bits };
  }

  /** Abre a conta se a senha estiver certa. Devolve a chave de sessão ou lança "usuário ou senha incorretos". */
  async function verificar(registro, senha) {
    return (await verificarComBits(registro, senha)).chave;
  }

  /** Com a chave já conferida, devolve a sessão com os dados decifrados. */
  async function abrir(registro, chave) {
    const sessao = { usuario: { id: registro.id, nome: registro.nome }, chave };
    const envelope = await repo.ler(chaveEstado(registro.id));
    if (!envelope) return { ...sessao, estado: criarEstadoInicial() }; // conta sem dados: começa limpa
    try {
      return { ...sessao, estado: await carregar(sessao) };
    } catch {
      throw new ErroLocal(
        'Os dados desta conta estão danificados e não puderam ser lidos. Use "Esqueci minha senha" para apagá-la, crie a conta de novo e importe um backup.',
        500,
      );
    }
  }

  const desbloqueioIndisponivel = () => new ErroLocal('Não foi possível entrar com o desbloqueio do aparelho. Entre com a senha.', 401);

  /** Lê e decifra os dados da conta da sessão (lança erro se estiverem ilegíveis ou inválidos). */
  async function carregar(sessao) {
    const envelope = await repo.ler(chaveEstado(sessao.usuario.id));
    if (!envelope) return criarEstadoInicial();
    return validarEstado(await decifrar(sessao.chave, envelope, aadEstado(sessao.usuario.id)));
  }

  return {
    async listar() {
      return (await lerLista()).map(({ id, nome, desbloqueio }) => ({ id, nome, desbloqueio: Boolean(desbloqueio) }));
    },

    /** Há dados da versão anterior (sem senha) neste aparelho? Eles serão adotados pela primeira conta criada. */
    async temLegado() {
      return (await estadoLegado()) !== null;
    },

    async criar(nome, senha) {
      const nomeOk = validarNome(nome);
      validarSenha(senha);
      const lista = await lerLista();
      if (achar(lista, nomeOk)) throw new ErroLocal('Já existe um usuário com esse nome neste aparelho.', 409);

      const id = idAleatorio();
      const sal = aleatorio(16);
      const chave = await derivarChave(senha, sal, iteracoes);

      // A primeira conta herda os dados antigos (sem senha), se houver, para ninguém perder o que já registrou.
      const legado = lista.length === 0 ? await estadoLegado() : null;
      const estado = legado ?? criarEstadoInicial();

      const registro = {
        id, nome: nomeOk, nomeNorm: comparavel(nomeOk), sal: paraB64(sal), iteracoes,
        verificador: await cifrar(chave, 'ok', aadVerificador(id)),
        criadoEm: new Date().toISOString(),
      };
      await repo.gravarVarios([
        [chaveEstado(id), await cifrar(chave, estado, aadEstado(id))],
        [CHAVE_USUARIOS, [...lista, registro]],
      ]);
      if (legado) await repo.apagar(CHAVE_LEGADO); // só depois de os dados estarem seguros na conta nova

      return { usuario: { id, nome: nomeOk }, chave, estado, adotouLegado: legado !== null };
    },

    async entrar(nome, senha) {
      const lista = await lerLista();
      const registro = achar(lista, nome);
      if (!registro) {
        // Mesmo custo de uma tentativa real, para não revelar pelo tempo se o usuário existe.
        await derivarChave(String(senha ?? ''), aleatorio(16), iteracoes);
        throw credenciaisInvalidas();
      }
      return abrir(registro, await verificar(registro, senha));
    },

    // ----- Desbloqueio do aparelho -----

    /** Dados públicos da passkey da conta (para pedir o desbloqueio), ou null se não estiver ativado. */
    async desbloqueioDe(nome) {
      const registro = achar(await lerLista(), nome);
      if (!registro?.desbloqueio) return null;
      const { credId, salPrf } = registro.desbloqueio;
      return { id: registro.id, nome: registro.nome, credId, salPrf };
    },

    /**
     * Liga o desbloqueio. Pede a senha de novo (prova de que é o dono e fonte dos bits da chave).
     * `passkey`: { credId (base64url), salPrf (base64), segredo (bytes do PRF) }.
     */
    async ativarDesbloqueio(sessao, senha, passkey) {
      const lista = await lerLista();
      const registro = lista.find((u) => u.id === sessao.usuario.id);
      if (!registro) throw new ErroLocal('Conta não encontrada.', 404);
      let bits;
      try {
        ({ bits } = await verificarComBits(registro, senha));
      } catch {
        throw new ErroLocal('A senha está incorreta.', 401);
      }
      const segredo = new Uint8Array(passkey?.segredo ?? []);
      if (segredo.length < 32 || !passkey.credId || !passkey.salPrf) throw new ErroLocal('O aparelho não devolveu a chave do desbloqueio.', 400);
      const embrulho = await chaveDoDesbloqueio(segredo, registro.id);
      const atualizado = {
        ...registro,
        desbloqueio: {
          credId: passkey.credId, salPrf: passkey.salPrf, criadoEm: new Date().toISOString(),
          chave: await cifrar(embrulho, paraB64(bits), aadDesbloqueio(registro.id)),
        },
      };
      await repo.gravarVarios([[CHAVE_USUARIOS, lista.map((u) => (u.id === registro.id ? atualizado : u))]]);
    },

    /** Entra com o segredo PRF devolvido pelo aparelho. Qualquer falha vira "entre com a senha". */
    async entrarComDesbloqueio(nome, segredo) {
      const registro = achar(await lerLista(), nome);
      if (!registro?.desbloqueio) throw desbloqueioIndisponivel();
      let chave;
      try {
        const embrulho = await chaveDoDesbloqueio(new Uint8Array(segredo), registro.id);
        const bits = deB64(await decifrar(embrulho, registro.desbloqueio.chave, aadDesbloqueio(registro.id)));
        chave = await chaveDeBits(bits);
        await decifrar(chave, registro.verificador, aadVerificador(registro.id));
      } catch {
        throw desbloqueioIndisponivel();
      }
      return abrir(registro, chave);
    },

    async desativarDesbloqueio(sessao) {
      const lista = await lerLista();
      if (!lista.some((u) => u.id === sessao.usuario.id)) throw new ErroLocal('Conta não encontrada.', 404);
      const sem = (u) => { const { desbloqueio: _removido, ...resto } = u; return resto; };
      await repo.gravarVarios([[CHAVE_USUARIOS, lista.map((u) => (u.id === sessao.usuario.id ? sem(u) : u))]]);
    },

    carregar,

    async salvar(sessao, estado) {
      const id = sessao.usuario.id;
      await repo.gravar(chaveEstado(id), await cifrar(sessao.chave, estado, aadEstado(id)));
    },

    /** Troca a senha: novo sal, nova chave, e todos os dados são recifrados de uma vez (tudo ou nada). */
    async alterarSenha(sessao, senhaAtual, novaSenha, estado) {
      const lista = await lerLista();
      const registro = lista.find((u) => u.id === sessao.usuario.id);
      if (!registro) throw new ErroLocal('Conta não encontrada.', 404);
      try {
        await verificar(registro, senhaAtual);
      } catch {
        throw new ErroLocal('A senha atual está incorreta.', 401);
      }
      validarSenha(novaSenha);

      const sal = aleatorio(16);
      const chave = await derivarChave(novaSenha, sal, iteracoes);
      const { desbloqueio: _antigo, ...semDesbloqueio } = registro; // guardava a chave antiga: precisa ser ativado de novo
      const atualizado = {
        ...semDesbloqueio, sal: paraB64(sal), iteracoes,
        verificador: await cifrar(chave, 'ok', aadVerificador(registro.id)),
      };
      await repo.gravarVarios([
        [chaveEstado(registro.id), await cifrar(chave, estado, aadEstado(registro.id))],
        [CHAVE_USUARIOS, lista.map((u) => (u.id === registro.id ? atualizado : u))],
      ]);
      return { usuario: sessao.usuario, chave };
    },

    /** Apaga a conta e os dados dela, SEM pedir a senha (é o caminho de quem a esqueceu). Irreversível. */
    async excluir(nome) {
      const lista = await lerLista();
      const registro = achar(lista, nome);
      if (!registro) throw new ErroLocal('Usuário não encontrado neste aparelho.', 404);
      await repo.gravarVarios([[CHAVE_USUARIOS, lista.filter((u) => u.id !== registro.id)]]);
      await repo.apagar(chaveEstado(registro.id));
    },
  };
}
