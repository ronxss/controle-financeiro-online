import { useState } from 'react';
import { Box, Stack, Typography } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { brl } from '../utils/format.js';

// Paleta categórica validada (ordem fixa, nunca reciclada): uma para o tema claro e outra para o escuro.
const PALETA = {
  light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300'],
  dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300'],
};
const MAX_FATIAS = 6;

export const coresPainel = (modo) => PALETA[modo === 'dark' ? 'dark' : 'light'];

const pct1 = (v) => `${(Math.round(v * 10) / 10).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;

/** Mais de 6 fatias: as menores viram "Outros" (cor neutra). Fatias sem valor são descartadas. */
export function agruparFatias(fatias) {
  const positivas = fatias.filter((f) => f.valor > 0);
  if (positivas.length <= MAX_FATIAS) return positivas;
  const ordenadas = [...positivas].sort((a, b) => b.valor - a.valor);
  const resto = ordenadas.slice(MAX_FATIAS - 1);
  return [...ordenadas.slice(0, MAX_FATIAS - 1), { rotulo: `Outros (${resto.length})`, valor: resto.reduce((s, f) => s + f.valor, 0), outros: true }];
}

function arco(cx, cy, r, r0, a0, a1) {
  const p = (raio, a) => [cx + raio * Math.sin(a), cy - raio * Math.cos(a)];
  const grande = a1 - a0 > Math.PI ? 1 : 0;
  const [x0, y0] = p(r, a0), [x1, y1] = p(r, a1);
  if (r0 <= 0) return `M${cx},${cy} L${x0},${y0} A${r},${r} 0 ${grande} 1 ${x1},${y1} Z`;
  const [x2, y2] = p(r0, a1), [x3, y3] = p(r0, a0);
  return `M${x0},${y0} A${r},${r} 0 ${grande} 1 ${x1},${y1} L${x2},${y2} A${r0},${r0} 0 ${grande} 0 ${x3},${y3} Z`;
}

/**
 * Pizza ou rosca em SVG, com legenda (valor e %) sempre visível — a cor nunca é a única pista.
 * `fatias`: [{ rotulo, valor }] na ordem em que devem ganhar as cores.
 */
export default function GraficoPizza({ fatias, rosca = false, titulo, rotuloTotal = 'Total' }) {
  const t = useTheme();
  const [ativo, setAtivo] = useState(null);
  const lista = agruparFatias(fatias);
  const total = lista.reduce((s, f) => s + f.valor, 0);
  if (total <= 0) return null;

  const cores = coresPainel(t.palette.mode);
  const cor = (f, i) => (f.outros ? t.palette.grey[t.palette.mode === 'dark' ? 600 : 400] : cores[i % cores.length]);
  const T = 200, c = T / 2, R = 96, R0 = rosca ? 60 : 0;
  let acumulado = 0;
  const fatiasSvg = lista.map((f, i) => {
    const a0 = (acumulado / total) * 2 * Math.PI;
    acumulado += f.valor;
    const a1 = (acumulado / total) * 2 * Math.PI;
    return { ...f, i, a0, a1, p: (f.valor / total) * 100 };
  });
  const destaque = ativo === null ? null : fatiasSvg[ativo];
  const descricao = fatiasSvg.map((f) => `${f.rotulo}: ${brl(f.valor)} (${pct1(f.p)})`).join('; ');

  return (
    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={{ xs: 2, sm: 3 }} alignItems="center">
      <Box sx={{ width: { xs: 180, sm: 190 }, flexShrink: 0 }} onMouseLeave={() => setAtivo(null)}>
        <svg viewBox={`0 0 ${T} ${T}`} width="100%" role="img" aria-label={`${titulo ? `${titulo}. ` : ''}${descricao}`} style={{ display: 'block' }}>
          {fatiasSvg.length === 1 ? (
            <g onMouseEnter={() => setAtivo(0)}>
              <circle cx={c} cy={c} r={R} fill={cor(fatiasSvg[0], 0)} />
              {rosca && <circle cx={c} cy={c} r={R0} fill={t.palette.background.paper} />}
              <title>{`${fatiasSvg[0].rotulo} · ${brl(fatiasSvg[0].valor)} (100%)`}</title>
            </g>
          ) : fatiasSvg.map((f) => (
            <path
              key={f.rotulo} d={arco(c, c, R, R0, f.a0, f.a1)} fill={cor(f, f.i)}
              stroke={t.palette.background.paper} strokeWidth={2} strokeLinejoin="round"
              opacity={ativo === null || ativo === f.i ? 1 : 0.35}
              onMouseEnter={() => setAtivo(f.i)} style={{ cursor: 'default', transition: 'opacity .15s' }}
            >
              <title>{`${f.rotulo} · ${brl(f.valor)} (${pct1(f.p)})`}</title>
            </path>
          ))}
          {rosca && (
            <g pointerEvents="none">
              <text x={c} y={c - 6} textAnchor="middle" fontSize="12" fill={t.palette.text.secondary}>
                {destaque ? (destaque.rotulo.length > 16 ? `${destaque.rotulo.slice(0, 15)}…` : destaque.rotulo) : rotuloTotal}
              </text>
              <text x={c} y={c + 14} textAnchor="middle" fontSize="16" fontWeight={700} fill={t.palette.text.primary}>
                {destaque ? pct1(destaque.p) : brl(total)}
              </text>
            </g>
          )}
        </svg>
      </Box>

      <Stack spacing={0.75} sx={{ width: '100%', maxWidth: 440, minWidth: 0 }} onMouseLeave={() => setAtivo(null)}>
        {fatiasSvg.map((f) => (
          <Stack
            key={f.rotulo} direction="row" spacing={1} alignItems="center" onMouseEnter={() => setAtivo(f.i)}
            sx={{ px: 0.75, py: 0.25, borderRadius: 1, bgcolor: ativo === f.i ? 'action.hover' : 'transparent' }}
          >
            <Box sx={{ width: 12, height: 12, borderRadius: '3px', bgcolor: cor(f, f.i), flexShrink: 0 }} />
            <Typography variant="body2" sx={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{f.rotulo}</Typography>
            <Typography variant="body2" fontWeight={500} sx={{ whiteSpace: 'nowrap' }}>{brl(f.valor)}</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'nowrap', minWidth: 44, textAlign: 'right' }}>{pct1(f.p)}</Typography>
          </Stack>
        ))}
      </Stack>
    </Stack>
  );
}
