const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const brl = (v) => moeda.format(v ?? 0);

const pad = (n) => String(n).padStart(2, '0');

/** 'aaaa-mm-dd' -> 'dd/mm/aaaa' (sem passar por Date, evitando problemas de fuso). */
export const dataBR = (iso) => (iso ? iso.split('-').reverse().join('/') : '');

export const hojeISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export const mesAtual = () => hojeISO().slice(0, 7);

export const moverMes = (mes, delta) => {
  const [a, m] = mes.split('-').map(Number);
  const d = new Date(a, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
};

export const rotuloMes = (mes) => {
  const [a, m] = mes.split('-').map(Number);
  const texto = new Date(a, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  return texto.charAt(0).toUpperCase() + texto.slice(1);
};

/** Data padrão para novo lançamento: hoje, se for o mês exibido; senão, dia 1 do mês exibido. */
export const dataPadrao = (mes) => (hojeISO().startsWith(mes) ? hojeISO() : `${mes}-01`);

/** Converte texto digitado ("1.234,56" ou "12.5") em número; NaN se inválido. */
export const parseValor = (texto) => {
  const t = String(texto).trim().replace(/\s/g, '');
  if (!t) return NaN;
  const normalizado = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t;
  return /^\d+(\.\d{1,2})?$/.test(normalizado) ? Number(normalizado) : NaN;
};

// ---------------- Máscara dos campos de valor (R$) ----------------
// Estilo "caixa registradora": os dígitos entram pela direita (1 -> 0,01; 15090 -> 150,90).
export const MAX_DIGITOS_MOEDA = 11; // até 999.999.999,99

/** Só os dígitos -> '1.234,56'. Sem dígitos (ou só zeros) -> ''. */
export const mascaraMoeda = (texto) => {
  const d = String(texto ?? '').replace(/\D/g, '').replace(/^0+/, '').slice(0, MAX_DIGITOS_MOEDA);
  if (!d) return '';
  const c = d.padStart(3, '0');
  const inteiro = c.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${inteiro},${c.slice(-2)}`;
};

/** Número -> texto do campo ('' para vazio/zero/inválido). Ex.: 150.9 -> '150,90'. */
export const valorParaCampo = (n) => {
  const v = Number(n);
  if (n === null || n === undefined || n === '' || !Number.isFinite(v) || v <= 0) return '';
  return mascaraMoeda(String(Math.round(v * 100)));
};

/**
 * Texto colado/digitado livremente -> texto do campo. Aceita '150,9', '1.234,56', '150.90', 'R$ 10', '1,234.56'.
 * O último separador seguido de 1 ou 2 dígitos é o decimal; os outros são de milhar.
 */
export const textoLivreParaCampo = (texto) => {
  const t = String(texto ?? '').replace(/[^\d.,]/g, '');
  const m = t.match(/^(.*?)[.,](\d{1,2})$/);
  if (!m) { const d = t.replace(/\D/g, ''); return d ? mascaraMoeda(`${d}00`) : ''; } // sem decimais: reais inteiros
  const inteiro = m[1].replace(/\D/g, '') || '0';
  return mascaraMoeda(inteiro + m[2].padEnd(2, '0'));
};

/** 'aaaa-mm' -> 'jan/26' (rótulo curto para gráficos). */
export const rotuloMesCurto = (mes) => {
  const [a, m] = mes.split('-').map(Number);
  const mesTxt = new Date(a, m - 1, 1).toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
  return `${mesTxt}/${String(a).slice(2)}`;
};

/** 12.34 -> '12%'  (sem casas decimais). */
export const pct = (v) => `${Math.round(v ?? 0)}%`;
