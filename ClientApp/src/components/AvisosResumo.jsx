import { useCallback, useEffect, useState } from 'react';
import { Alert, AlertTitle, Box, Button, Snackbar, Stack, Typography } from '@mui/material';
import { api } from '../api.js';
import { brl, dataBR } from '../utils/format.js';
import { exportarBackup, mensagemExportacao } from '../local/backup.js';
import { MODO_LOCAL } from '../modo.js';

const MAX_ITENS = 5;

function quando(dias) {
  if (dias < -1) return `venceu há ${-dias} dias`;
  if (dias === -1) return 'venceu ontem';
  if (dias === 0) return 'hoje';
  if (dias === 1) return 'amanhã';
  return `em ${dias} dias`;
}

function Lista({ itens, onPagar, ocupado }) {
  return (
    <Stack spacing={0.75} sx={{ mt: 0.5 }}>
      {itens.slice(0, MAX_ITENS).map((x) => (
        <Stack key={x.chave} direction="row" alignItems="center" spacing={1} justifyContent="space-between">
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="body2" fontWeight={500} sx={{ overflowWrap: 'anywhere' }}>
              {x.descricao} · <span style={{ whiteSpace: 'nowrap' }}>{x.tipo === 'Receita' ? '+' : '−'} {brl(x.valor)}</span>
            </Typography>
            <Typography variant="caption">{dataBR(x.data)} · {quando(x.dias)}</Typography>
          </Box>
          <Button size="small" color="inherit" variant="outlined" disabled={ocupado} onClick={() => onPagar(x)} sx={{ flexShrink: 0 }}>
            {x.tipo === 'Receita' ? 'Recebi' : x.tipo === 'Fatura' ? 'Paguei a fatura' : 'Paguei'}
          </Button>
        </Stack>
      ))}
      {itens.length > MAX_ITENS && (
        <Typography variant="caption">e mais {itens.length - MAX_ITENS} em Lançamentos (filtro “Pendente”).</Typography>
      )}
    </Stack>
  );
}

/** Avisos do modo local no topo do Resumo: pendentes atrasados, próximos 7 dias e lembrete de backup. */
export default function AvisosResumo({ onMudou }) {
  const [d, setD] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const [msg, setMsg] = useState('');

  const carregar = useCallback(() => {
    api.get('/api/lembretes?dias=7').then(setD).catch(() => setD(null));
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  const pagar = async (x) => {
    setOcupado(true);
    try {
      if (x.tipo === 'Fatura') {
        await api.post(`/api/cartoes/${x.contaId}/pagar`, { mes: x.fatura });
        setMsg(`${x.descricao} marcada como paga.`);
      } else {
        await api.patch(`/api/lancamentos/${x.id}/status`, { status: 'PagoRecebido' });
        setMsg(`“${x.descricao}” marcado como ${x.tipo === 'Receita' ? 'recebido' : 'pago'}.`);
      }
      carregar();
      onMudou?.();
    } catch (e) {
      setMsg(e.message);
    } finally {
      setOcupado(false);
    }
  };

  const exportar = async () => {
    try {
      setMsg(mensagemExportacao(await exportarBackup()));
    } catch (e) {
      setMsg(e.message || 'Não foi possível gerar o backup.');
    }
    carregar();
  };

  if (!d) return null;
  const { atrasados, proximos, totais } = d;
  // Online, os dados ficam no servidor (com backup do banco): o lembrete de backup é só do app local.
  const backup = MODO_LOCAL ? d.backup : { atrasado: false };
  if (atrasados.length === 0 && proximos.length === 0 && !backup.atrasado) return <Snackbar open={Boolean(msg)} autoHideDuration={4000} onClose={() => setMsg('')} message={msg} />;

  return (
    <Stack spacing={1.5}>
      {atrasados.length > 0 && (
        <Alert severity="error">
          <AlertTitle>
            {atrasados.length === 1 ? '1 pendente atrasado' : `${atrasados.length} pendentes atrasados`}
            {totais.despesasAtrasadas > 0 && ` · ${brl(totais.despesasAtrasadas)} a pagar`}
          </AlertTitle>
          <Lista itens={atrasados} onPagar={pagar} ocupado={ocupado} />
        </Alert>
      )}
      {proximos.length > 0 && (
        <Alert severity="warning">
          <AlertTitle>
            Próximos 7 dias
            {totais.despesasProximas > 0 && ` · ${brl(totais.despesasProximas)} a pagar`}
            {totais.receitasProximas > 0 && ` · ${brl(totais.receitasProximas)} a receber`}
          </AlertTitle>
          <Lista itens={proximos} onPagar={pagar} ocupado={ocupado} />
        </Alert>
      )}
      {backup.atrasado && (
        <Alert
          severity="info"
          action={<Button color="inherit" size="small" onClick={exportar}>Exportar</Button>}
        >
          {backup.diasDesde === null
            ? 'Você ainda não fez backup. Sem ele, os dados se perdem se o app for desinstalado ou o celular trocado.'
            : `Seu último backup foi há ${backup.diasDesde} dias.`}
        </Alert>
      )}
      <Snackbar open={Boolean(msg)} autoHideDuration={5000} onClose={() => setMsg('')} message={msg} />
    </Stack>
  );
}
