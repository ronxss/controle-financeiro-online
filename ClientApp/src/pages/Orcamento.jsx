import { useEffect, useState } from 'react';
import {
  Alert, Box, Button, Card, CardContent, LinearProgress, Paper, Skeleton, Snackbar, Stack, Tab, Table,
  TableBody, TableCell, TableHead, TableRow, Tabs, TextField, Typography, useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { api } from '../api.js';
import { useMes } from '../MesContext.jsx';
import { brl, parseValor, valorParaCampo } from '../utils/format.js';
import CampoMoeda from '../components/CampoMoeda.jsx';
import MetasPainel from '../components/MetasPainel.jsx';

/** Orçamento: limites por categoria e (no modo local) metas de economia, em abas. */
export default function Orcamento() {
  const [aba, setAba] = useState(0);
  return (
    <Stack spacing={2}>
      <Typography variant="h5" fontWeight={700}>Orçamento</Typography>
      <Tabs value={aba} onChange={(_, v) => setAba(v)} variant="fullWidth" sx={{ maxWidth: 420 }}>
        <Tab label="Limites" />
        <Tab label="Metas" />
      </Tabs>
      {aba === 0 ? <Limites embutido /> : <MetasPainel />}
    </Stack>
  );
}

function Limites({ embutido = false }) {
  const { mes } = useMes();
  const celular = useMediaQuery(useTheme().breakpoints.down('md')); // até tablet em pé: cartões em vez de tabela
  const [itens, setItens] = useState(null);
  const [limites, setLimites] = useState({}); // categoriaId -> texto digitado
  const [erro, setErro] = useState('');
  const [msg, setMsg] = useState('');
  const [salvando, setSalvando] = useState(false);

  const carregar = async () => {
    try {
      const d = await api.get(`/api/orcamento?mes=${mes}`);
      setItens(d);
      setLimites(Object.fromEntries(d.map((i) => [i.categoriaId, valorParaCampo(i.limite)])));
      setErro('');
    } catch (e) {
      setErro(e.message);
    }
  };

  useEffect(() => { setItens(null); carregar(); }, [mes]); // eslint-disable-line react-hooks/exhaustive-deps

  const numero = (id) => {
    const t = limites[id];
    if (!t || !t.trim()) return 0;
    const n = parseValor(t);
    return Number.isNaN(n) ? null : n;
  };

  const invalido = itens?.some((i) => numero(i.categoriaId) === null);

  const salvar = async () => {
    setSalvando(true);
    try {
      await api.put('/api/orcamento', itens.map((i) => ({ categoriaId: i.categoriaId, limite: numero(i.categoriaId) })));
      setMsg('Limites salvos.');
      carregar();
    } catch (e) {
      setErro(e.message);
    } finally {
      setSalvando(false);
    }
  };

  const campoLimite = (i, largura) => (
    <CampoMoeda
      size="small" value={limites[i.categoriaId] ?? ''} label={celular ? 'Limite mensal' : undefined}
      fullWidth={Boolean(largura)} sx={largura ? undefined : { minWidth: 150 }}
      error={numero(i.categoriaId) === null}
      helperText={numero(i.categoriaId) === null ? 'Valor inválido. Ex.: 150,90' : undefined}
      onChange={(v) => setLimites((p) => ({ ...p, [i.categoriaId]: v }))}
      slotProps={{ htmlInput: { 'aria-label': `Limite de ${i.categoria}` } }}
    />
  );

  const barra = (i) => {
    const lim = numero(i.categoriaId) ?? 0;
    const pct = lim > 0 ? (i.realizado / lim) * 100 : 0;
    const cor = pct > 100 ? 'error' : pct >= 80 ? 'warning' : 'success';
    return lim > 0 ? (
      <Box>
        <LinearProgress variant="determinate" value={Math.min(pct, 100)} color={cor} sx={{ height: 8, borderRadius: 4 }} />
        <Typography variant="caption" color="text.secondary">{pct.toFixed(0)}% do limite</Typography>
      </Box>
    ) : (
      <Typography variant="caption" color="text.secondary">sem limite</Typography>
    );
  };

  return (
    <Stack spacing={2}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
        {embutido
          ? <Typography fontWeight={500}>Limite por categoria</Typography>
          : <Typography variant="h5" fontWeight={700}>Orçamento mensal</Typography>}
        <Button variant="contained" onClick={salvar} disabled={!itens || salvando || invalido} sx={{ whiteSpace: 'nowrap' }}>
          Salvar limites
        </Button>
      </Stack>
      <Typography color="text.secondary">
        Defina um limite por categoria. O realizado considera apenas despesas já pagas no mês selecionado.
      </Typography>

      {erro && <Alert severity="error" onClose={() => setErro('')}>{erro}</Alert>}
      {!itens && <Skeleton variant="rounded" height={300} />}

      {itens && celular && (
        <Stack spacing={1.5}>
          {itens.map((i) => {
            const lim = numero(i.categoriaId) ?? 0;
            const disponivel = lim - i.realizado;
            return (
              <Paper key={i.categoriaId} variant="outlined" sx={{ p: 1.5 }}>
                <Typography fontWeight={500} sx={{ mb: 1.5 }}>{i.categoria}</Typography>
                {campoLimite(i, true)}
                <Stack direction="row" justifyContent="space-between" sx={{ mt: 1.5 }}>
                  <Box>
                    <Typography variant="caption" color="text.secondary">Realizado</Typography>
                    <Typography fontWeight={500}>{brl(i.realizado)}</Typography>
                  </Box>
                  <Box sx={{ textAlign: 'right' }}>
                    <Typography variant="caption" color="text.secondary">Disponível</Typography>
                    <Typography fontWeight={500} color={lim > 0 && disponivel < 0 ? 'error.main' : undefined}>
                      {lim > 0 ? brl(disponivel) : '—'}
                    </Typography>
                  </Box>
                </Stack>
                <Box sx={{ mt: 1 }}>{barra(i)}</Box>
              </Paper>
            );
          })}
        </Stack>
      )}

      {itens && !celular && (
        <Card>
          <CardContent sx={{ overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Categoria</TableCell>
                  <TableCell sx={{ width: 170 }}>Limite mensal</TableCell>
                  <TableCell align="right">Realizado</TableCell>
                  <TableCell align="right">Disponível</TableCell>
                  <TableCell sx={{ minWidth: 140 }}>% do limite</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {itens.map((i) => {
                  const lim = numero(i.categoriaId) ?? 0;
                  return (
                    <TableRow key={i.categoriaId}>
                      <TableCell>{i.categoria}</TableCell>
                      <TableCell>{campoLimite(i, false)}</TableCell>
                      <TableCell align="right">{brl(i.realizado)}</TableCell>
                      <TableCell align="right" sx={{ color: lim > 0 && lim - i.realizado < 0 ? 'error.main' : undefined, fontWeight: 500 }}>
                        {lim > 0 ? brl(lim - i.realizado) : '—'}
                      </TableCell>
                      <TableCell>{barra(i)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
      <Snackbar open={Boolean(msg)} autoHideDuration={3000} onClose={() => setMsg('')} message={msg} />
    </Stack>
  );
}
