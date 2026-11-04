import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Box, Button, Card, CardContent, LinearProgress, Skeleton, Stack, Typography } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import TrendingDownIcon from '@mui/icons-material/TrendingDown';
import AccountBalanceIcon from '@mui/icons-material/AccountBalance';
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty';
import { api } from '../api.js';
import { useMes } from '../MesContext.jsx';
import { brl } from '../utils/format.js';
import { TEM_FIXAS } from '../modo.js';
import AvisosResumo from '../components/AvisosResumo.jsx';
import PainelResumo from '../components/PainelResumo.jsx';

function Indicador({ titulo, valor, icone, cor }) {
  return (
    <Card>
      <CardContent>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ color: 'text.secondary', mb: 1 }}>
          {icone}
          <Typography variant="body2">{titulo}</Typography>
        </Stack>
        <Typography variant="h5" fontWeight={700} color={cor}>{valor === undefined ? <Skeleton width={120} /> : brl(valor)}</Typography>
      </CardContent>
    </Card>
  );
}

export default function Resumo() {
  const { mes } = useMes();
  const navigate = useNavigate();
  const [r, setR] = useState(null);
  const [erro, setErro] = useState('');
  const [versao, setVersao] = useState(0); // muda quando um aviso marca algo como pago: recarrega os números

  useEffect(() => {
    if (versao === 0) setR(null);
    api.get(`/api/resumo?mes=${mes}`).then((d) => { setR(d); setErro(''); }).catch((e) => setErro(e.message));
  }, [mes, versao]);

  const totalDespesas = r ? r.despesasPorCategoria.reduce((s, x) => s + x.realizado, 0) : 0;
  const visiveis = r ? r.despesasPorCategoria.filter((x) => x.realizado > 0) : [];
  const vazio = r && r.receitasRecebidas + r.despesasPagas + r.receitasPendentes + r.despesasPendentes === 0;

  return (
    <Stack spacing={3}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1.5}>
        <Typography variant="h5" fontWeight={700} sx={{ fontSize: { xs: '1.25rem', sm: '1.5rem' }, minWidth: 0 }}>Resumo do mês</Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => navigate('/lancamentos?novo=1')} sx={{ flexShrink: 0 }}>
          Novo lançamento
        </Button>
      </Stack>

      <AvisosResumo onMudou={() => setVersao((v) => v + 1)} />
      {erro && <Alert severity="error">{erro}</Alert>}
      {vazio && <Alert severity="info">Nenhum lançamento neste mês ainda. Clique em “Novo lançamento” para começar.</Alert>}

      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)' } }}>
        <Indicador titulo="Receitas recebidas" valor={r?.receitasRecebidas} cor="success.main" icone={<TrendingUpIcon fontSize="small" />} />
        <Indicador titulo="Despesas pagas" valor={r?.despesasPagas} cor="error.main" icone={<TrendingDownIcon fontSize="small" />} />
        <Indicador titulo="Saldo realizado" valor={r?.saldoRealizado} cor={r && r.saldoRealizado < 0 ? 'error.main' : 'primary.main'} icone={<AccountBalanceIcon fontSize="small" />} />
        <Indicador titulo="Receitas pendentes" valor={r?.receitasPendentes} icone={<HourglassEmptyIcon fontSize="small" />} />
        <Indicador titulo="Despesas pendentes" valor={r?.despesasPendentes} icone={<HourglassEmptyIcon fontSize="small" />} />
        <Indicador titulo="Saldo previsto (com pendentes)" valor={r?.saldoPrevisto} cor={r && r.saldoPrevisto < 0 ? 'error.main' : undefined} icone={<AccountBalanceIcon fontSize="small" />} />
      </Box>

      <Card>
        <CardContent>
          <Typography variant="h6" fontWeight={500} gutterBottom>Despesas por categoria</Typography>
          {!r && <Skeleton variant="rounded" height={120} />}
          {r && visiveis.length === 0 && (
            <Typography color="text.secondary">Nenhuma despesa paga neste mês.</Typography>
          )}
          <Stack spacing={2}>
            {visiveis.map((x) => {
              const pct = totalDespesas ? (x.realizado / totalDespesas) * 100 : 0;
              return (
                <Box key={x.categoria}>
                  <Stack direction="row" justifyContent="space-between">
                    <Typography>{x.categoria}</Typography>
                    <Typography fontWeight={500}>
                      {brl(x.realizado)} <Typography component="span" variant="body2" color="text.secondary">({pct.toFixed(0)}%)</Typography>
                    </Typography>
                  </Stack>
                  <LinearProgress variant="determinate" value={pct} sx={{ height: 8, borderRadius: 4, mt: 0.5 }} />
                </Box>
              );
            })}
          </Stack>
        </CardContent>
      </Card>

      {TEM_FIXAS && <PainelResumo mes={mes} versao={versao} />}
    </Stack>
  );
}
