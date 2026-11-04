import { useTheme } from '@mui/material/styles';
import { brl, rotuloMesCurto } from '../utils/format.js';

/**
 * Barras agrupadas (receitas x despesas) por mês, em SVG puro: sem biblioteca, escala com a largura da tela.
 * `dados`: [{ mes: 'aaaa-mm', receitas, despesas }]. O mês selecionado (último) fica em destaque.
 * `tipo`: 'barras' (padrão) ou 'linhas'.
 */
export default function GraficoBarras({ dados, tipo = 'barras' }) {
  const t = useTheme();
  const L = 340, A = 170, base = A - 28, topo = 14, margem = 8;
  const maximo = Math.max(1, ...dados.flatMap((d) => [d.receitas, d.despesas]));
  const largGrupo = (L - margem * 2) / dados.length;
  const largBarra = Math.min(18, largGrupo / 2 - 4);
  const altura = (v) => Math.max(v > 0 ? 2 : 0, (v / maximo) * (base - topo));

  const descricao = dados
    .map((d) => `${rotuloMesCurto(d.mes)}: receitas ${brl(d.receitas)}, despesas ${brl(d.despesas)}`)
    .join('; ');

  return (
    <svg viewBox={`0 0 ${L} ${A}`} width="100%" role="img" aria-label={`Receitas e despesas pagas nos últimos 6 meses. ${descricao}`}
      style={{ display: 'block', maxHeight: 240 }}>
      <line x1={margem} x2={L - margem} y1={base} y2={base} stroke={t.palette.divider} />
      {tipo === 'linhas' && <Linhas dados={dados} t={t} base={base} altura={altura} x={(i) => margem + largGrupo * i + largGrupo / 2} A={A} />}
      {tipo !== 'linhas' && dados.map((d, i) => {
        const cx = margem + largGrupo * i + largGrupo / 2;
        const atual = i === dados.length - 1;
        const hr = altura(d.receitas);
        const hd = altura(d.despesas);
        return (
          <g key={d.mes} opacity={atual ? 1 : 0.6}>
            <rect x={cx - largBarra - 1} y={base - hr} width={largBarra} height={hr} rx={2} fill={t.palette.success.main}>
              <title>{`${rotuloMesCurto(d.mes)} · receitas ${brl(d.receitas)}`}</title>
            </rect>
            <rect x={cx + 1} y={base - hd} width={largBarra} height={hd} rx={2} fill={t.palette.error.main}>
              <title>{`${rotuloMesCurto(d.mes)} · despesas ${brl(d.despesas)}`}</title>
            </rect>
            <text x={cx} y={A - 10} textAnchor="middle" fontSize="10" fill={t.palette.text.secondary} fontWeight={atual ? 700 : 400}>
              {rotuloMesCurto(d.mes)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** Duas linhas (receitas e despesas) com marcadores; cada mês tem uma área de toque com o detalhe. */
function Linhas({ dados, t, base, altura, x, A }) {
  const series = [
    { chave: 'receitas', nome: 'receitas', cor: t.palette.success.main },
    { chave: 'despesas', nome: 'despesas', cor: t.palette.error.main },
  ];
  const largura = dados.length > 1 ? x(1) - x(0) : 40;
  return (
    <g>
      {series.map((s) => (
        <polyline
          key={s.chave} fill="none" stroke={s.cor} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round"
          points={dados.map((d, i) => `${x(i)},${base - altura(d[s.chave])}`).join(' ')}
        />
      ))}
      {dados.map((d, i) => {
        const atual = i === dados.length - 1;
        return (
          <g key={d.mes}>
            <rect x={x(i) - largura / 2} y={0} width={largura} height={base} fill="transparent">
              <title>{`${rotuloMesCurto(d.mes)} · receitas ${brl(d.receitas)} · despesas ${brl(d.despesas)}`}</title>
            </rect>
            {series.map((s) => (
              <circle key={s.chave} cx={x(i)} cy={base - altura(d[s.chave])} r={atual ? 5 : 4} fill={s.cor}
                stroke={t.palette.background.paper} strokeWidth={2} pointerEvents="none" />
            ))}
            <text x={x(i)} y={A - 10} textAnchor="middle" fontSize="10" fill={t.palette.text.secondary} fontWeight={atual ? 700 : 400}>
              {rotuloMesCurto(d.mes)}
            </text>
          </g>
        );
      })}
    </g>
  );
}
