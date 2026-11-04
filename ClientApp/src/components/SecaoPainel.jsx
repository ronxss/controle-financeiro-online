import { Card, CardContent, IconButton, Stack, ToggleButton, ToggleButtonGroup, Tooltip, Typography } from '@mui/material';
import BarChartIcon from '@mui/icons-material/BarChart';
import PieChartIcon from '@mui/icons-material/PieChart';
import DonutLargeIcon from '@mui/icons-material/DonutLarge';
import ShowChartIcon from '@mui/icons-material/ShowChart';
import FormatListBulletedIcon from '@mui/icons-material/FormatListBulleted';
import VisibilityOffOutlinedIcon from '@mui/icons-material/VisibilityOffOutlined';
import { NOME_SECAO, NOME_TIPO, SECOES_PAINEL } from '../painel.js';

export const ICONE_TIPO = {
  barras: <BarChartIcon fontSize="small" />,
  pizza: <PieChartIcon fontSize="small" />,
  rosca: <DonutLargeIcon fontSize="small" />,
  linhas: <ShowChartIcon fontSize="small" />,
  lista: <FormatListBulletedIcon fontSize="small" />,
};

/** Escolha do tipo de gráfico de uma seção (só aparece se houver mais de um tipo). */
export function SeletorTipo({ id, tipo, onTipo }) {
  const tipos = SECOES_PAINEL[id];
  if (tipos.length < 2) return null;
  return (
    <ToggleButtonGroup
      size="small" exclusive value={tipo} aria-label={`Tipo de gráfico: ${NOME_SECAO[id]}`}
      onChange={(_, t) => t && onTipo(t)}
    >
      {tipos.map((t) => (
        <ToggleButton key={t} value={t} aria-label={NOME_TIPO[t]} sx={{ px: 1, py: 0.5 }}>
          <Tooltip title={NOME_TIPO[t]}>{ICONE_TIPO[t]}</Tooltip>
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}

/**
 * Cartão de uma seção do painel: título, ação própria (opcional), seletor de tipo e botão para ocultar.
 * Sem `id`, é um cartão comum (sem controles).
 */
export default function SecaoPainel({ id, titulo, acao, pref, onAlterar, children }) {
  return (
    <Card>
      <CardContent>
        <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1} sx={{ mb: 1.5, flexWrap: 'wrap' }} useFlexGap>
          <Typography variant="h6" fontWeight={500} sx={{ minWidth: 0 }}>{titulo ?? NOME_SECAO[id]}</Typography>
          <Stack direction="row" spacing={0.5} alignItems="center" sx={{ ml: 'auto' }}>
            {acao}
            {id && pref && <SeletorTipo id={id} tipo={pref.tipo} onTipo={(tipo) => onAlterar({ [id]: { tipo } })} />}
            {id && onAlterar && (
              <Tooltip title="Ocultar do painel">
                <IconButton size="small" aria-label={`Ocultar ${NOME_SECAO[id]}`} onClick={() => onAlterar({ [id]: { visivel: false } })}>
                  <VisibilityOffOutlinedIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            )}
          </Stack>
        </Stack>
        {children}
      </CardContent>
    </Card>
  );
}
