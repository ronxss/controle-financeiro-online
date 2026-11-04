import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import { SECOES_PAINEL, painelPadrao } from './local/engine.js';

export { SECOES_PAINEL };

export const NOME_SECAO = {
  indicadores: 'Indicadores do mês',
  despesasCategoria: 'Despesas por categoria',
  orcamento: 'Orçamento do mês',
  fixas: 'Receitas e despesas fixas',
  fixasVariaveis: 'Despesas fixas × variáveis',
  evolucao: 'Evolução em 6 meses',
  ritmo: 'Ritmo de gastos',
  maioresDespesas: 'Maiores despesas',
};

export const NOME_TIPO = { barras: 'Barras', pizza: 'Pizza', rosca: 'Rosca', linhas: 'Linhas', lista: 'Lista', cartoes: 'Cartões' };

const CHAVE = 'painel-preferencias';
const lerGuardado = () => { try { return JSON.parse(localStorage.getItem(CHAVE)) || null; } catch { return null; } };
const guardar = (p) => { try { localStorage.setItem(CHAVE, JSON.stringify(p)); } catch { /* sem armazenamento: vale só nesta sessão */ } };
// Servidor sem a rota /api/config (versão antiga): a preferência fica só neste navegador.
const semRota = (e) => e?.status === 404 || e?.status === 405;

/**
 * Preferências do painel (seções visíveis e tipo de gráfico), gravadas em /api/config.
 * A tela muda na hora; se o servidor recusar, volta ao que estava e avisa por `onErro`.
 */
export function usePainel(onErro) {
  const [painel, setPainel] = useState(painelPadrao);
  const atual = useRef(painel);
  atual.current = painel;

  useEffect(() => {
    let vivo = true;
    const local = () => { const g = lerGuardado(); if (vivo && g) setPainel({ ...painelPadrao(), ...g }); };
    api.get('/api/config').then((c) => { if (!vivo) return; if (c?.painel) setPainel({ ...painelPadrao(), ...c.painel }); else local(); }).catch(local);
    return () => { vivo = false; };
  }, []);

  const alterar = useCallback((mudancas) => {
    const antes = atual.current;
    const depois = { ...antes };
    for (const [id, m] of Object.entries(mudancas)) depois[id] = { ...antes[id], ...m };
    setPainel(depois);
    api.put('/api/config', { painel: mudancas })
      .then((c) => { if (c?.painel) setPainel(c.painel); else guardar(depois); })
      .catch((e) => {
        if (semRota(e)) { guardar(depois); return; }
        setPainel(antes);
        onErro?.(e.message || 'Não foi possível salvar a preferência.');
      });
  }, [onErro]);

  return [painel, alterar];
}
