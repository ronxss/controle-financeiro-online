import { useEffect, useState } from 'react';
import {
  Alert, Box, Button, Card, CardContent, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle, Divider,
  IconButton, InputAdornment, Link, Stack, Tab, Tabs, TextField, Typography,
} from '@mui/material';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet';
import { useAuth } from '../auth/AuthContext.jsx';
import { api } from '../api.js';
import GoogleButton from '../components/GoogleButton.jsx';
import FingerprintIcon from '@mui/icons-material/Fingerprint';
import { assinarEntrada, passkeyDesteAparelho, passkeysDisponiveis, prepararEntrada } from '../passkeysOnline.js';

export default function Login() {
  const { entrar, registrar, entrarComGoogle, entrarComPasskey } = useAuth();
  const [googleClientId, setGoogleClientId] = useState(null);
  const [aba, setAba] = useState(0); // 0 = entrar, 1 = criar conta
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [mostrar, setMostrar] = useState(false);
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [esqueci, setEsqueci] = useState(false);

  const novo = aba === 1;

  // O servidor informa o Client ID do Google; se não estiver configurado, o botão simplesmente não aparece.
  useEffect(() => {
    api.get('/api/auth/config').then((c) => setGoogleClientId(c?.googleClientId || null)).catch(() => {});
  }, []);

  // Desbloqueio do aparelho: aparece se uma passkey foi ativada neste aparelho. O desafio é pedido antes do toque
  // (o Safari só mostra o Face ID logo depois de um toque) e renovado a cada 4 minutos (ele vale 5).
  const [desafio, setDesafio] = useState(null);
  const [comPasskey, setComPasskey] = useState(false);
  const renovarDesafio = () => prepararEntrada().then(setDesafio).catch(() => setDesafio(null));
  useEffect(() => {
    let vivo = true;
    let t;
    if (passkeyDesteAparelho()) {
      passkeysDisponiveis().then((ok) => {
        if (!vivo || !ok) return;
        setComPasskey(true);
        renovarDesafio();
        t = setInterval(renovarDesafio, 4 * 60 * 1000);
      });
    }
    return () => { vivo = false; clearInterval(t); };
  }, []);

  const entrarComDesbloqueio = async () => {
    setErro('');
    setEnviando(true);
    try {
      const opcoes = desafio ?? (await prepararEntrada()); // se ainda não chegou, pede agora
      setDesafio(null);
      await entrarComPasskey(await assinarEntrada(opcoes));
    } catch (err) {
      setErro(err.message || 'Não foi possível entrar com o desbloqueio do aparelho.');
      renovarDesafio(); // cada desafio vale uma vez
      setEnviando(false);
    }
  };

  const aoReceberGoogle = async (credential) => {
    setErro('');
    try {
      await entrarComGoogle(credential);
    } catch (err) {
      setErro(err.message);
    }
  };

  const enviar = async (e) => {
    e.preventDefault();
    setErro('');
    if (novo && nome.trim().length < 2) return setErro('Informe seu nome.');
    if (novo && senha.length < 8) return setErro('A senha deve ter pelo menos 8 caracteres.');
    setEnviando(true);
    try {
      if (novo) await registrar(nome.trim(), email.trim(), senha);
      else await entrar(email.trim(), senha);
    } catch (err) {
      setErro(err.message);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Box sx={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', p: 2 }}>
      <Card sx={{ width: '100%', maxWidth: 420 }}>
        <CardContent sx={{ p: 3 }}>
          <Stack alignItems="center" spacing={1} sx={{ mb: 2 }}>
            <AccountBalanceWalletIcon color="primary" sx={{ fontSize: 48 }} />
            <Typography variant="h5" fontWeight={700}>Controle Financeiro</Typography>
            <Typography variant="body2" color="text.secondary">Suas receitas e despesas em um só lugar</Typography>
          </Stack>

          <Tabs value={aba} onChange={(_, v) => { setAba(v); setErro(''); }} variant="fullWidth" sx={{ mb: 2 }}>
            <Tab label="Entrar" />
            <Tab label="Criar conta" />
          </Tabs>

          <Box component="form" onSubmit={enviar} noValidate>
            <Stack spacing={2}>
              {erro && <Alert severity="error">{erro}</Alert>}
              {novo && (
                <TextField label="Nome" value={nome} onChange={(e) => setNome(e.target.value)} autoComplete="name" required />
              )}
              <TextField label="E-mail" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                autoComplete="email" required autoFocus />
              <TextField
                label="Senha" type={mostrar ? 'text' : 'password'} value={senha} onChange={(e) => setSenha(e.target.value)}
                autoComplete={novo ? 'new-password' : 'current-password'} required
                helperText={novo ? 'Mínimo de 8 caracteres, com letra maiúscula, minúscula e número.' : undefined}
                slotProps={{
                  input: {
                    endAdornment: (
                      <InputAdornment position="end">
                        <IconButton aria-label={mostrar ? 'Ocultar senha' : 'Mostrar senha'} onClick={() => setMostrar((v) => !v)} edge="end">
                          {mostrar ? <VisibilityOffIcon /> : <VisibilityIcon />}
                        </IconButton>
                      </InputAdornment>
                    ),
                  },
                }}
              />
              <Button type="submit" variant="contained" size="large" disabled={enviando || !email || !senha}>
                {novo ? 'Criar conta' : 'Entrar'}
              </Button>
              {!novo && comPasskey && (
                <>
                  <Divider>ou</Divider>
                  <Button variant="outlined" size="large" startIcon={<FingerprintIcon />} onClick={entrarComDesbloqueio} disabled={enviando}>
                    Entrar com desbloqueio do aparelho
                  </Button>
                </>
              )}
              {!novo && (
                <Link component="button" type="button" variant="body2" onClick={() => setEsqueci(true)} sx={{ alignSelf: 'center' }}>
                  Esqueci minha senha
                </Link>
              )}
            </Stack>
          </Box>

          {googleClientId && (
            <>
              <Divider sx={{ my: 2.5 }}>ou</Divider>
              <GoogleButton clientId={googleClientId} onCredential={aoReceberGoogle} onErro={setErro} />
            </>
          )}
        </CardContent>
      </Card>
      <EsqueciSenhaDialog open={esqueci} emailInicial={email} onClose={() => setEsqueci(false)} />
    </Box>
  );
}

/** Pede o link de troca de senha por e-mail. A resposta é sempre a mesma (não revela quem tem conta). */
function EsqueciSenhaDialog({ open, emailInicial, onClose }) {
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState('');
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);

  useEffect(() => { if (open) { setEmail(emailInicial); setMsg(''); setErro(''); } }, [open, emailInicial]);

  const enviar = async (e) => {
    e.preventDefault();
    setErro('');
    setEnviando(true);
    try {
      const r = await api.post('/api/auth/esqueci-senha', { email: email.trim() });
      setMsg(r?.mensagem || 'Se houver uma conta com esse e-mail, enviamos um link.');
    } catch (err) {
      setErro(err.message);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <Box component="form" onSubmit={enviar} noValidate>
        <DialogTitle>Esqueci minha senha</DialogTitle>
        <DialogContent>
          <Stack spacing={2}>
            {msg ? (
              <Alert severity="success">{msg} Confira também a caixa de spam.</Alert>
            ) : (
              <DialogContentText>Informe o e-mail da conta. Enviaremos um link para você criar uma nova senha.</DialogContentText>
            )}
            {erro && <Alert severity="error">{erro}</Alert>}
            {!msg && (
              <TextField label="E-mail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" autoFocus />
            )}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={onClose}>{msg ? 'Fechar' : 'Cancelar'}</Button>
          {!msg && <Button type="submit" variant="contained" disabled={enviando || !email.trim()}>Enviar link</Button>}
        </DialogActions>
      </Box>
    </Dialog>
  );
}
