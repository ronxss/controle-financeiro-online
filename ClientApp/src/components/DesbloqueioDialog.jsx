import { useEffect, useState } from 'react';
import {
  Alert, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Stack, TextField,
} from '@mui/material';
import FingerprintIcon from '@mui/icons-material/Fingerprint';
import {
  ativarDesbloqueio, concluirDesbloqueio, conferirSenha, desativarDesbloqueio, dispensarOfertaDesbloqueio,
  statusDesbloqueio, temSenhaConferida,
} from '../local/auth.js';

/**
 * Liga/desliga "entrar com o desbloqueio do aparelho" (Face ID, digital, PIN).
 * `oferta`: aberto sozinho logo depois de entrar com a senha — a ativação é um toque só.
 */
export default function DesbloqueioDialog({ open, onClose, oferta = false, onAviso }) {
  // etapa: carregando | ativo | senha | tocar | concluir
  const [etapa, setEtapa] = useState('carregando');
  const [senha, setSenha] = useState('');
  const [pendente, setPendente] = useState(null);
  const [erro, setErro] = useState('');
  const [ocupado, setOcupado] = useState(false);

  useEffect(() => {
    if (!open) return;
    setErro(''); setSenha(''); setPendente(null); setEtapa('carregando');
    statusDesbloqueio()
      .then((s) => setEtapa(s.ativo ? 'ativo' : temSenhaConferida() ? 'tocar' : 'senha'))
      .catch(() => setEtapa('senha'));
  }, [open]);

  const executar = async (fn) => {
    setErro(''); setOcupado(true);
    try { await fn(); } catch (e) { setErro(e.message || 'Não foi possível continuar.'); } finally { setOcupado(false); }
  };

  const pronto = () => { onAviso?.('Pronto! Da próxima vez, entre com o desbloqueio do aparelho.'); onClose(); };

  const continuar = () => executar(async () => { await conferirSenha(senha); setSenha(''); setEtapa('tocar'); });
  const ativar = () => executar(async () => {
    const falta = await ativarDesbloqueio(); // primeira coisa no toque: o Safari exige um gesto recente
    if (falta) { setPendente(falta); setEtapa('concluir'); } else pronto();
  });
  const concluir = () => executar(async () => { await concluirDesbloqueio(pendente); pronto(); });
  const desativar = () => executar(async () => { await desativarDesbloqueio(); onAviso?.('Desbloqueio do aparelho desativado. Entre com a senha.'); onClose(); });
  const agoraNao = () => { if (oferta) dispensarOfertaDesbloqueio(); onClose(); };

  const titulo = oferta ? 'Entrar sem digitar a senha?' : 'Desbloqueio do aparelho';

  return (
    <Dialog open={open} onClose={ocupado ? undefined : onClose} fullWidth maxWidth="xs">
      <DialogTitle>
        <Stack direction="row" spacing={1} alignItems="center"><FingerprintIcon color="primary" /><span>{titulo}</span></Stack>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          {etapa === 'carregando' && <CircularProgress sx={{ alignSelf: 'center' }} />}

          {etapa === 'ativo' && (
            <DialogContentText>
              Ativado neste aparelho: na tela de entrada, toque em “Entrar com desbloqueio do aparelho” e use o Face ID, a
              digital ou o PIN do celular. A senha continua funcionando.
            </DialogContentText>
          )}

          {['senha', 'tocar', 'concluir'].includes(etapa) && (
            <DialogContentText>
              Entre usando o Face ID, a digital ou o PIN do celular, sem digitar a senha. Seus dados continuam
              criptografados: só o desbloqueio deste aparelho (ou a senha) abre a conta. Se você trocar a senha, é preciso
              ativar de novo.
            </DialogContentText>
          )}

          {etapa === 'senha' && (
            <TextField
              label="Sua senha" type="password" value={senha} onChange={(e) => setSenha(e.target.value)} autoFocus
              autoComplete="current-password" helperText="Para confirmar que é você."
              onKeyDown={(e) => { if (e.key === 'Enter' && senha && !ocupado) continuar(); }}
            />
          )}
          {etapa === 'concluir' && (
            <Alert severity="info">Falta só um passo: toque em “Concluir” e confirme o desbloqueio mais uma vez.</Alert>
          )}
          {erro && <Alert severity="error">{erro}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2, flexWrap: 'wrap', gap: 1 }}>
        {etapa === 'ativo' ? (
          <>
            <Button color="error" onClick={desativar} disabled={ocupado}>Desativar</Button>
            <Button variant="contained" onClick={onClose}>Fechar</Button>
          </>
        ) : (
          <>
            <Button onClick={agoraNao} disabled={ocupado}>{oferta ? 'Agora não' : 'Cancelar'}</Button>
            {etapa === 'senha' && <Button variant="contained" onClick={continuar} disabled={ocupado || !senha}>Continuar</Button>}
            {etapa === 'tocar' && (
              <Button variant="contained" startIcon={<FingerprintIcon />} onClick={ativar} disabled={ocupado}>Ativar</Button>
            )}
            {etapa === 'concluir' && (
              <Button variant="contained" startIcon={<FingerprintIcon />} onClick={concluir} disabled={ocupado}>Concluir</Button>
            )}
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
