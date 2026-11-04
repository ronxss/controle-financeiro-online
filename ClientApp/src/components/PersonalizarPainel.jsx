import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Divider, Stack, Switch, Typography } from '@mui/material';
import { NOME_SECAO, SECOES_PAINEL } from '../painel.js';
import { painelPadrao } from '../local/engine.js';
import { SeletorTipo } from './SecaoPainel.jsx';

/** Liga/desliga cada seção do painel e escolhe o tipo de gráfico. Cada mudança é salva na hora. */
export default function PersonalizarPainel({ aberto, onFechar, painel, onAlterar, ids = Object.keys(SECOES_PAINEL) }) {
  const padrao = painelPadrao();
  const ehPadrao = ids.every((id) => painel[id].visivel === padrao[id].visivel && painel[id].tipo === padrao[id].tipo);
  return (
    <Dialog open={aberto} onClose={onFechar} fullWidth maxWidth="xs">
      <DialogTitle>Personalizar painel</DialogTitle>
      <DialogContent sx={{ px: { xs: 2, sm: 3 } }}>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Escolha o que aparece no Resumo e como cada gráfico é mostrado.
        </Typography>
        <Stack divider={<Divider flexItem />}>
          {ids.map((id) => (
            <Stack key={id} direction="row" alignItems="center" spacing={1} sx={{ py: 1 }}>
              <Switch
                checked={painel[id].visivel} edge="start"
                inputProps={{ 'aria-label': `Mostrar ${NOME_SECAO[id]}` }}
                onChange={(e) => onAlterar({ [id]: { visivel: e.target.checked } })}
              />
              <Typography sx={{ flex: 1, minWidth: 0 }} color={painel[id].visivel ? 'text.primary' : 'text.secondary'}>
                {NOME_SECAO[id]}
              </Typography>
              <Box sx={{ opacity: painel[id].visivel ? 1 : 0.5 }}>
                <SeletorTipo id={id} tipo={painel[id].tipo} onTipo={(tipo) => onAlterar({ [id]: { tipo } })} />
              </Box>
            </Stack>
          ))}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button disabled={ehPadrao} onClick={() => onAlterar(Object.fromEntries(ids.map((id) => [id, padrao[id]])))}>Restaurar padrão</Button>
        <Button variant="contained" onClick={onFechar}>Fechar</Button>
      </DialogActions>
    </Dialog>
  );
}
