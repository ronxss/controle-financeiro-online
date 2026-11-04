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
    api.get('/api/config').then((c) => { if (vivo && c?.painel) setPainel({ ...painelPadrao(), ...c.painel }); }).catch(() => {});
    return () => { vivo = false; };
  }, []);

  const alterar = useCallback((mudancas) => {
    const antes = atual.current;
    const depois = { ...antes };
    for (const [id, m] of Object.entries(mudancas)) depois[id] = { ...antes[id], ...m };
    setPainel(depois);
    api.put('/api/config', { painel: mudancas })
      .then((c) => { if (c?.painel) setPainel(c.painel); })
      .catch((e) => { setPainel(antes); onErro?.(e.message || 'Não foi possível salvar a preferência.'); });
  }, [onErro]);

  return [painel, alterar];
}
