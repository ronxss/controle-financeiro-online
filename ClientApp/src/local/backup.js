// Backup manual dos dados do modo local.
//
// Os dados ficam SÓ no aparelho. Se o celular for perdido, formatado, ou o app/navegador for desinstalado
// ou tiver os dados limpos, tudo se perde, a não ser que exista um backup. Por isso o menu oferece
// "Exportar backup" e "Importar backup".
import { montarBackup, lerBackup, hojeISO, gerarCsv } from './engine.js';
import { lerEstadoAtual, substituirEstado, requestLocal } from './localApi.js';
import { Capacitor } from '@capacitor/core';
import { exportarNoAparelho } from './exportarNativo.js';
import { MODO_LOCAL } from '../modo.js';

// ---------- Modo online: o servidor guarda os dados; aqui só baixamos/enviamos os arquivos ----------

async function pedirServidor(metodo, url, corpo) {
  const r = await fetch(url, {
    method: metodo, credentials: 'same-origin', body: corpo,
    headers: { 'X-Requested-With': 'XMLHttpRequest', ...(corpo ? { 'Content-Type': 'application/json' } : {}) },
  });
  if (!r.ok) {
    let msg = 'Não foi possível concluir a operação.';
    try { const j = await r.json(); msg = j.mensagem || Object.values(j.errors ?? {}).flat()[0] || msg; } catch { /* sem corpo */ }
    if (r.status === 401) window.dispatchEvent(new Event('auth:expirou'));
    throw new Error(msg);
  }
  return r;
}

function baixar(arquivo) {
  const url = URL.createObjectURL(arquivo);
  const a = document.createElement('a');
  a.href = url;
  a.download = arquivo.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * Gera o arquivo de backup. Devolve { resultado, salvoEm }:
 * - APK (Android): cópia em Documentos/Controle Financeiro + folha de compartilhamento ('salvo', 'compartilhado' ou
 *   'cancelado'); `salvoEm` diz onde a cópia ficou.
 * - Navegador de celular: folha de compartilhamento ('compartilhado' ou 'cancelado').
 * - Computador: baixa o arquivo ('baixado').
 */
export async function exportarBackup() {
  if (!MODO_LOCAL) {
    const texto = await (await pedirServidor('GET', '/api/backup')).text();
    return entregarArquivo(`controle-financeiro-backup-${hojeISO()}.json`, texto, 'application/json', 'Backup do Controle Financeiro');
  }
  const r = await gerarBackup();
  if (r.resultado !== 'cancelado') {
    // Anota a data para o lembrete de backup (falhar aqui não desfaz o backup).
    try { await requestLocal('POST', '/api/backup/registrar', {}); } catch { /* ignora */ }
  }
  return r;
}

/** Texto curto para mostrar depois de exportar. */
export function mensagemExportacao({ resultado, salvoEm }) {
  const cuidado = 'O arquivo não é criptografado: guarde-o em lugar seguro.';
  const copia = salvoEm ? `Cópia salva em ${salvoEm}. ` : '';
  if (resultado === 'baixado') return `Backup salvo na pasta Downloads. ${cuidado}`;
  if (resultado === 'compartilhado') return `Backup pronto. ${copia}${cuidado}`;
  if (resultado === 'salvo') return `${copia}${cuidado}`;
  return 'Exportação cancelada. Nenhum arquivo foi salvo.';
}

async function gerarBackup() {
  const estado = await lerEstadoAtual();
  return entregarArquivo(`controle-financeiro-backup-${hojeISO()}.json`, montarBackup(estado), 'application/json', 'Backup do Controle Financeiro');
}

/**
 * Entrega um arquivo de texto à pessoa, do jeito que cada lugar permite. Devolve { resultado, salvoEm }:
 * - APK: cópia em Documentos/Controle Financeiro + folha de compartilhamento do Android;
 * - navegador de celular: folha de compartilhamento;
 * - computador: download (pasta Downloads).
 */
export async function entregarArquivo(nome, texto, tipo, titulo) {
  if (Capacitor.isNativePlatform()) {
    // Carregados só no app nativo: o PWA não precisa deles.
    const [{ Filesystem, Directory, Encoding }, { Share }] = await Promise.all([
      import('@capacitor/filesystem'), import('@capacitor/share'),
    ]);
    const r = await exportarNoAparelho(nome, texto, { Filesystem, Directory, Encoding, Share }, titulo);
    if (r.compartilhado) return { resultado: 'compartilhado', salvoEm: r.salvoEm };
    if (r.salvoEm) return { resultado: 'salvo', salvoEm: r.salvoEm };
    return { resultado: 'cancelado', salvoEm: null };
  }

  const arquivo = new File([texto], nome, { type: tipo });
  if (navigator.canShare?.({ files: [arquivo] })) {
    try {
      await navigator.share({ files: [arquivo], title: titulo });
      return { resultado: 'compartilhado', salvoEm: null };
    } catch (e) {
      if (e?.name === 'AbortError') return { resultado: 'cancelado', salvoEm: null }; // fechou a folha
      // qualquer outro erro: tenta baixar o arquivo
    }
  }
  baixar(arquivo);
  return { resultado: 'baixado', salvoEm: null };
}

/** Planilha (CSV) dos lançamentos do período. `de`/`ate` em aaaa-mm-dd (opcionais). */
export async function exportarCsv({ de = null, ate = null, sufixo = 'tudo' } = {}) {
  let texto;
  let quantidade;
  if (MODO_LOCAL) {
    ({ texto, quantidade } = gerarCsv(await lerEstadoAtual(), { de, ate }));
  } else {
    const qs = new URLSearchParams();
    if (de) qs.set('de', de);
    if (ate) qs.set('ate', ate);
    const r = await pedirServidor('GET', `/api/exportar/csv?${qs}`);
    quantidade = Number(r.headers.get('X-Quantidade') ?? 0);
    texto = await r.text();
    // response.text() descarta a marca BOM; sem ela o Excel erra os acentos.
    if (!texto.startsWith('\uFEFF')) texto = `\uFEFF${texto}`;
  }
  if (quantidade === 0) return { resultado: 'vazio', salvoEm: null, quantidade };
  const r = await entregarArquivo(`controle-financeiro-${sufixo}.csv`, texto, 'text/csv', 'Planilha do Controle Financeiro');
  return { ...r, quantidade };
}

/** Valida o texto do backup (lança ErroLocal se estiver errado) sem alterar nada. Útil antes de pedir confirmação. */
export function conferirBackup(texto) {
  lerBackup(texto);
}

/** Substitui TODOS os dados do aparelho pelo conteúdo do backup. */
export async function importarBackup(texto) {
  const estado = lerBackup(texto); // valida aqui também, para mensagens imediatas
  if (MODO_LOCAL) {
    await substituirEstado(estado);
    return;
  }
  await pedirServidor('POST', '/api/backup/importar', texto);
}
