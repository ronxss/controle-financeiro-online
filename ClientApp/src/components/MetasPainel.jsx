import { useCallback, useEffect, useState } from 'react';
import {
  Alert, Box, Button, Card, CardContent, Chip, Collapse, Dialog, DialogActions, DialogContent, DialogTitle, IconButton,
  LinearProgress, Skeleton, Snackbar, Stack, TextField, ToggleButton, ToggleButtonGroup, Typography,
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import FlagIcon from '@mui/icons-material/Flag';
import { api } from '../api.js';
import { brl, dataBR, hojeISO, parseValor, valorParaCampo } from '../utils/format.js';
import CampoMoeda from './CampoMoeda.jsx';
import ConfirmDialog from './ConfirmDialog.jsx';

const SITUACAO = {
  concluida: { rotulo: 'Concluída', cor: 'success' },
  noRitmo: { rotulo: 'No ritmo', cor: 'success' },
  abaixoDoRitmo: { rotulo: 'Abaixo do ritmo', cor: 'warning' },
  atrasada: { rotulo: 'Prazo vencido', cor: 'error' },
  semPrazo: { rotulo: 'Sem prazo', cor: 'default' },
};

function MetaDialog({ open, meta, onClose, onSalvo }) {
  const celular = useMediaQuery(useTheme().breakpoints.down('sm'));
  const [nome, setNome] = useState('');
  const [alvo, setAlvo] = useState('');
  const [prazo, setPrazo] = useState('');
  const [erro, setErro] = useState('');
  useEffect(() => {
    if (!open) return;
    setNome(meta?.nome ?? '');
    setAlvo(meta ? valorParaCampo(meta.alvo) : '');
    setPrazo(meta?.prazo ?? '');
    setErro('');
  }, [open, meta]);

  const salvar = async () => {
    const v = parseValor(alvo);
    if (!nome.trim()) return setErro('Informe o nome da meta.');
    if (Number.isNaN(v) || v <= 0) return setErro('Informe um valor-alvo maior que zero.');
    try {
      const corpo = { nome: nome.trim(), alvo: v, prazo: prazo || null };
      if (meta) await api.put(`/api/metas/${meta.id}`, corpo);
      else await api.post('/api/metas', corpo);
      onSalvo(meta ? 'Meta atualizada.' : 'Meta criada.');
      onClose();
    } catch (e) {
      setErro(e.message);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs" fullScreen={celular}>
      <DialogTitle>{meta ? 'Editar meta' : 'Nova meta'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {erro && <Alert severity="error">{erro}</Alert>}
          <TextField label="Nome" placeholder="Ex.: Viagem, Reserva de emergência" value={nome} onChange={(e) => setNome(e.target.value)}
            autoFocus slotProps={{ htmlInput: { maxLength: 60 } }} />
          <CampoMoeda label="Quanto quer juntar" value={alvo} onChange={setAlvo} />
          <TextField label="Até quando (opcional)" type="date" value={prazo} onChange={(e) => setPrazo(e.target.value)}
            slotProps={{ inputLabel: { shrink: true } }} helperText="Com prazo, o app calcula quanto guardar por mês." />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 'max(16px, env(safe-area-inset-bottom))' }}>
        <Button onClick={onClose}>Cancelar</Button>
        <Button variant="contained" onClick={salvar}>Salvar</Button>
      </DialogActions>
    </Dialog>
  );
}

function AporteDialog({ meta, retirada, onClose, onSalvo }) {
  const [valor, setValor] = useState('');
  const [data, setData] = useState(hojeISO());
  const [nota, setNota] = useState('');
  const [modo, setModo] = useState('deposito');
  const [erro, setErro] = useState('');
  useEffect(() => {
    if (!meta) return;
    setValor(''); setData(hojeISO()); setNota(''); setErro(''); setModo(retirada ? 'retirada' : 'deposito');
  }, [meta, retirada]);

  const salvar = async () => {
    const v = parseValor(valor);
    if (Number.isNaN(v) || v <= 0) return setErro('Informe um valor maior que zero.');
    try {
      await api.post(`/api/metas/${meta.id}/aportes`, { valor: v, data, nota: nota.trim(), retirada: modo === 'retirada' });
      onSalvo(modo === 'retirada' ? 'Retirada registrada.' : 'Depósito registrado.');
      onClose();
    } catch (e) {
      setErro(e.message);
    }
  };

  return (
    <Dialog open={Boolean(meta)} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{meta?.nome}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {erro && <Alert severity="error">{erro}</Alert>}
          <ToggleButtonGroup exclusive fullWidth value={modo} onChange={(_, v) => v && setModo(v)}>
            <ToggleButton value="deposito" color="success">Guardar</ToggleButton>
            <ToggleButton value="retirada" color="error">Retirar</ToggleButton>
          </ToggleButtonGroup>
          <CampoMoeda label="Valor" value={valor} onChange={setValor} autoFocus />
          <TextField label="Data" type="date" value={data} onChange={(e) => setData(e.target.value)} slotProps={{ inputLabel: { shrink: true } }} />
          <TextField label="Observação (opcional)" value={nota} onChange={(e) => setNota(e.target.value)} slotProps={{ htmlInput: { maxLength: 100 } }} />
          <Typography variant="caption" color="text.secondary">
            Isto só registra na meta; não cria lançamento. Se o dinheiro saiu da sua conta, registre também a transferência em Lançamentos.
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>Cancelar</Button>
        <Button variant="contained" onClick={salvar}>Salvar</Button>
      </DialogActions>
    </Dialog>
  );
}

function Meta({ m, onGuardar, onRetirar, onEditar, onExcluir, onExcluirAporte }) {
  const [aberta, setAberta] = useState(false);
  const s = SITUACAO[m.situacao];
  return (
    <Card>
      <CardContent>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" spacing={1}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
            <FlagIcon color="primary" />
            <Typography variant="h6" fontWeight={500} sx={{ overflowWrap: 'anywhere' }}>{m.nome}</Typography>
          </Stack>
          <Chip size="small" label={s.rotulo} color={s.cor} variant={m.situacao === 'concluida' ? 'filled' : 'outlined'} />
        </Stack>

        <Stack direction="row" justifyContent="space-between" alignItems="baseline" sx={{ mt: 1.5 }} flexWrap="wrap" useFlexGap>
          <Typography variant="h5" fontWeight={700}>{brl(m.guardado)}</Typography>
          <Typography color="text.secondary">de {brl(m.alvo)} ({Math.round(m.percentual)}%)</Typography>
        </Stack>
        <LinearProgress
          variant="determinate" value={m.percentual} color={s.cor === 'default' ? 'primary' : s.cor}
          sx={{ height: 10, borderRadius: 5, mt: 0.5 }}
        />
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {m.situacao === 'concluida' && 'Meta alcançada!'}
          {m.situacao !== 'concluida' && `Faltam ${brl(m.falta)}`}
          {m.prazo && ` · prazo ${dataBR(m.prazo)}`}
          {m.mensalSugerido !== null && ` · guarde ${brl(m.mensalSugerido)} por mês (${m.mesesRestantes} ${m.mesesRestantes === 1 ? 'mês' : 'meses'})`}
        </Typography>

        <Stack direction="row" spacing={1} sx={{ mt: 2 }} alignItems="center">
          <Button variant="contained" size="small" startIcon={<AddIcon />} onClick={() => onGuardar(m)}>Guardar</Button>
          <Button size="small" onClick={() => onRetirar(m)} disabled={m.guardado <= 0}>Retirar</Button>
          <Box sx={{ flex: 1 }} />
          <IconButton aria-label="Editar meta" onClick={() => onEditar(m)}><EditIcon fontSize="small" /></IconButton>
          <IconButton aria-label="Excluir meta" onClick={() => onExcluir(m)}><DeleteIcon fontSize="small" /></IconButton>
          {m.aportes.length > 0 && (
            <IconButton aria-label={aberta ? 'Esconder histórico' : 'Ver histórico'} onClick={() => setAberta((v) => !v)}>
              {aberta ? <ExpandLessIcon /> : <ExpandMoreIcon />}
            </IconButton>
          )}
        </Stack>

        <Collapse in={aberta} unmountOnExit>
          <Stack spacing={0.75} sx={{ mt: 1.5 }}>
            {m.aportes.map((a) => (
              <Stack key={a.id} direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="body2" fontWeight={500} color={a.valor < 0 ? 'error.main' : 'success.main'}>
                    {a.valor < 0 ? '− ' : '+ '}{brl(Math.abs(a.valor))}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
                    {dataBR(a.data)}{a.nota && ` · ${a.nota}`}
                  </Typography>
                </Box>
                <IconButton size="small" aria-label="Excluir registro" onClick={() => onExcluirAporte(a)}><DeleteIcon fontSize="small" /></IconButton>
              </Stack>
            ))}
          </Stack>
        </Collapse>
      </CardContent>
    </Card>
  );
}

/** Metas de economia (modo local): aba dentro de Orçamento. */
export default function MetasPainel() {
  const [metas, setMetas] = useState(null);
  const [erro, setErro] = useState('');
  const [msg, setMsg] = useState('');
  const [editar, setEditar] = useState({ aberto: false, meta: null });
  const [aporte, setAporte] = useState({ meta: null, retirada: false });
  const [excluir, setExcluir] = useState(null); // { tipo: 'meta'|'aporte', item }

  const carregar = useCallback(() => {
    api.get('/api/metas').then((d) => { setMetas(d); setErro(''); }).catch((e) => setErro(e.message));
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  const salvo = (texto) => { setMsg(texto); carregar(); };

  const confirmarExclusao = async () => {
    try {
      if (excluir.tipo === 'meta') await api.delete(`/api/metas/${excluir.item.id}`);
      else await api.delete(`/api/aportes/${excluir.item.id}`);
      salvo(excluir.tipo === 'meta' ? 'Meta excluída.' : 'Registro excluído.');
    } catch (e) {
      setErro(e.message);
    } finally {
      setExcluir(null);
    }
  };

  const totalGuardado = metas?.reduce((t, m) => t + m.guardado, 0) ?? 0;

  return (
    <Stack spacing={2}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
        <Typography color="text.secondary">
          {metas?.length ? <>Guardado nas metas: <strong>{brl(totalGuardado)}</strong></> : 'Junte dinheiro para seus objetivos.'}
        </Typography>
        <Button variant="contained" startIcon={<AddIcon />} onClick={() => setEditar({ aberto: true, meta: null })} sx={{ whiteSpace: 'nowrap' }}>
          Nova meta
        </Button>
      </Stack>

      {erro && <Alert severity="error" onClose={() => setErro('')}>{erro}</Alert>}
      {!metas && !erro && <Skeleton variant="rounded" height={180} />}
      {metas?.length === 0 && (
        <Alert severity="info">
          Nenhuma meta ainda. Crie uma (ex.: “Reserva de emergência — R$ 10.000 até dezembro”) e registre quanto guardou.
        </Alert>
      )}

      <Box sx={{ display: 'grid', gap: 2, gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)' } }}>
        {metas?.map((m) => (
          <Meta
            key={m.id} m={m}
            onGuardar={(x) => setAporte({ meta: x, retirada: false })}
            onRetirar={(x) => setAporte({ meta: x, retirada: true })}
            onEditar={(x) => setEditar({ aberto: true, meta: x })}
            onExcluir={(x) => setExcluir({ tipo: 'meta', item: x })}
            onExcluirAporte={(a) => setExcluir({ tipo: 'aporte', item: a })}
          />
        ))}
      </Box>

      <MetaDialog open={editar.aberto} meta={editar.meta} onClose={() => setEditar({ aberto: false, meta: null })} onSalvo={salvo} />
      <AporteDialog meta={aporte.meta} retirada={aporte.retirada} onClose={() => setAporte({ meta: null, retirada: false })} onSalvo={salvo} />
      <ConfirmDialog
        open={Boolean(excluir)}
        titulo={excluir?.tipo === 'meta' ? 'Excluir meta?' : 'Excluir registro?'}
        texto={excluir?.tipo === 'meta'
          ? `“${excluir.item.nome}” e todo o histórico dela serão removidos.`
          : excluir ? `O registro de ${brl(Math.abs(excluir.item.valor))} em ${dataBR(excluir.item.data)} será removido.` : ''}
        onConfirmar={confirmarExclusao} onCancelar={() => setExcluir(null)}
      />
      <Snackbar open={Boolean(msg)} autoHideDuration={3000} onClose={() => setMsg('')} message={msg} />
    </Stack>
  );
}
