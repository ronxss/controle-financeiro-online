import { useEffect, useState } from 'react';
import {
  Alert, Button, Chip, CircularProgress, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle,
  IconButton, List, ListItem, ListItemText, Stack, TextField, Tooltip,
} from '@mui/material';
import FingerprintIcon from '@mui/icons-material/Fingerprint';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import {
  ativarNesteAparelho, dispensarOferta, listarPasskeys, passkeyDesteAparelho, prepararAtivacao, removerPasskey, temSenhaRecente,
} from '../passkeysOnline.js';
import { dataBR } from '../utils/format.js';

/**
 * Versão online de "Desbloqueio do aparelho": aparelhos com passkey na conta, remover e ativar neste.
 * `oferta`: aberto sozinho logo depois do login com senha (a senha recente evita digitar de novo).
 */
export default function PasskeysDialog({ open, onClose, email, temSenha = true, oferta = false, onAviso }) {
  const [lista, setLista] = useState(null);
  const [etapa, setEtapa] = useState('inicio'); // inicio | senha | tocar
  const [senha, setSenha] = useState('');
  const [opcoes, setOpcoes] = useState(null);
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);

  const executar = async (fn) => {
    setErro(''); setOcupado(true);
    try { await fn(); } catch (e) { setErro(e.message || 'Não foi possível continuar.'); } finally { setOcupado(false); }
  };

  // Prepara as opções antes do toque (o Safari só mostra o Face ID logo depois de um toque).
  const preparar = (s) => executar(async () => { setOpcoes(await prepararAtivacao(s)); setSenha(''); setEtapa('tocar'); });

  useEffect(() => {
    if (!open) return;
    setErro(''); setSenha(''); setOpcoes(null); setLista(null);
    listarPasskeys().then(setLista).catch(() => setLista([]));
    if (temSenhaRecente() || (oferta && !temSenha)) preparar(); else setEtapa(oferta ? 'senha' : 'inicio');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const desteAparelho = passkeyDesteAparelho();
  const ativoAqui = Boolean(lista && desteAparelho && lista.some((p) => p.id === desteAparelho.id));

  const ativar = () => executar(async () => {
    setLista(await ativarNesteAparelho(opcoes, email));
    setOpcoes(null);
    setEtapa('inicio');
    onAviso?.('Pronto! Da próxima vez, toque em “Entrar com desbloqueio do aparelho”.');
    if (oferta) onClose();
  });
  const remover = (id) => executar(async () => {
    setLista(await removerPasskey(id));
    onAviso?.('Aparelho removido. Ele não entra mais sem senha.');
  });
  const fechar = () => { if (oferta && !ativoAqui) dispensarOferta(email); onClose(); };

  return (
    <Dialog open={open} onClose={ocupado ? undefined : fechar} fullWidth maxWidth="xs">
      <DialogTitle>
        <Stack direction="row" spacing={1} alignItems="center">
          <FingerprintIcon color="primary" /><span>{oferta ? 'Entrar sem digitar a senha?' : 'Desbloqueio do aparelho'}</span>
        </Stack>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <DialogContentText>
            Entre usando o Face ID, a digital ou o PIN do celular, sem digitar e-mail e senha. Nada da sua biometria sai
            do aparelho: ele só confirma ao site que é você.
          </DialogContentText>

          {!oferta && (lista === null ? <CircularProgress size={24} sx={{ alignSelf: 'center' }} /> : lista.length > 0 && (
            <List dense disablePadding sx={{ border: 1, borderColor: 'divider', borderRadius: 1 }}>
              {lista.map((p) => (
                <ListItem
                  key={p.id}
                  secondaryAction={(
                    <Tooltip title="Remover">
                      <IconButton edge="end" aria-label={`Remover ${p.nome}`} onClick={() => remover(p.id)} disabled={ocupado}>
                        <DeleteOutlineIcon />
                      </IconButton>
                    </Tooltip>
                  )}
                >
                  <ListItemText
                    primary={<Stack direction="row" spacing={1} alignItems="center"><span>{p.nome}</span>{desteAparelho?.id === p.id && <Chip size="small" label="este aparelho" />}</Stack>}
                    secondary={`Ativado em ${dataBR(String(p.criadoEm).slice(0, 10))}`}
                  />
                </ListItem>
              ))}
            </List>
          ))}

          {!ativoAqui && etapa === 'senha' && (
            <TextField
              label="Sua senha" type="password" value={senha} onChange={(e) => setSenha(e.target.value)} autoFocus
              autoComplete="current-password" helperText="Para confirmar que é você."
              onKeyDown={(e) => { if (e.key === 'Enter' && senha && !ocupado) preparar(senha); }}
            />
          )}
          {ativoAqui && !oferta && <Alert severity="success">Ativado neste aparelho.</Alert>}
          {erro && <Alert severity="error">{erro}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2, flexWrap: 'wrap', gap: 1 }}>
        <Button onClick={fechar} disabled={ocupado}>{oferta ? 'Agora não' : 'Fechar'}</Button>
        {!ativoAqui && etapa === 'inicio' && (
          <Button variant="contained" startIcon={<FingerprintIcon />} onClick={() => (temSenha ? setEtapa('senha') : preparar(''))} disabled={ocupado}>Ativar neste aparelho</Button>
        )}
        {!ativoAqui && etapa === 'senha' && (
          <Button variant="contained" onClick={() => preparar(senha)} disabled={ocupado || !senha}>Continuar</Button>
        )}
        {!ativoAqui && etapa === 'tocar' && (
          <Button variant="contained" startIcon={<FingerprintIcon />} onClick={ativar} disabled={ocupado || !opcoes}>Ativar</Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
