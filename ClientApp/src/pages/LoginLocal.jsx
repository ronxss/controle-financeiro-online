import { useEffect, useState } from 'react';
import {
  Alert, Box, Button, Card, CardContent, Dialog, DialogActions, DialogContent, DialogContentText, DialogTitle,
  Divider, IconButton, InputAdornment, Link, Stack, Tab, Tabs, TextField, Typography,
} from '@mui/material';
import FingerprintIcon from '@mui/icons-material/Fingerprint';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet';
import { useAuth } from '../auth/AuthContext.jsx';
import {
  desbloqueioDaConta, desbloqueioDisponivel, excluirConta, listarUsuarios, temDadosAntigos, ultimoUsuario,
} from '../local/auth.js';
import { cancelarNotificacoes } from '../local/servicosAparelho.js';

/** Entrar / criar conta no modo local. As contas existem só neste aparelho e protegem (criptografam) os dados. */
export default function LoginLocal() {
  const { entrarLocal, entrarLocalDesbloqueio, criarContaLocal } = useAuth();
  const [pronto, setPronto] = useState(false);
  const [aba, setAba] = useState(0); // 0 = entrar, 1 = criar conta
  const [nome, setNome] = useState(ultimoUsuario());
  const [senha, setSenha] = useState('');
  const [confirmar, setConfirmar] = useState('');
  const [mostrar, setMostrar] = useState(false);
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [temAntigos, setTemAntigos] = useState(false);
  const [primeiraConta, setPrimeiraConta] = useState(false);
  const [esqueci, setEsqueci] = useState(false);

  const novo = aba === 1;

  // Desbloqueio do aparelho: os dados da passkey da conta digitada ficam prontos antes do toque
  // (o Safari só mostra o Face ID se o pedido sair logo depois do toque).
  const [aparelhoOk, setAparelhoOk] = useState(false);
  const [desbloqueio, setDesbloqueio] = useState(null);
  useEffect(() => { desbloqueioDisponivel().then(setAparelhoOk); }, []);
  useEffect(() => {
    if (!aparelhoOk || novo || !nome.trim()) { setDesbloqueio(null); return undefined; }
    let vivo = true;
    const t = setTimeout(() => desbloqueioDaConta(nome).then((d) => vivo && setDesbloqueio(d)), 150);
    return () => { vivo = false; clearTimeout(t); };
  }, [nome, novo, aparelhoOk]);

  const entrarComDesbloqueio = async () => {
    setErro('');
    setEnviando(true);
    try {
      await entrarLocalDesbloqueio(desbloqueio);
    } catch (err) {
      setErro(err.message || 'Não foi possível entrar com o desbloqueio. Entre com a senha.');
      setEnviando(false);
    }
  };

  useEffect(() => {
    let ativo = true;
    Promise.all([listarUsuarios(), temDadosAntigos()])
      .then(([lista, antigos]) => {
        if (!ativo) return;
        setPrimeiraConta(lista.length === 0);
        setTemAntigos(antigos);
        if (lista.length === 0) setAba(1); // ninguém cadastrado ainda: vai direto para "Criar conta"
      })
      .catch(() => {})
      .finally(() => ativo && setPronto(true));
    return () => { ativo = false; };
  }, []);

  const trocarAba = (_, v) => { setAba(v); setErro(''); setSenha(''); setConfirmar(''); };

  const enviar = async (e) => {
    e.preventDefault();
    setErro('');
    if (novo && senha !== confirmar) return setErro('As senhas não conferem.');
    setEnviando(true);
    try {
      if (novo) await criarContaLocal(nome, senha);
      else await entrarLocal(nome, senha);
    } catch (err) {
      setErro(err.message || 'Não foi possível continuar.');
      setEnviando(false);
    }
    // Em caso de sucesso este componente sai da tela; não precisa liberar o botão.
  };

  const botaoOlho = (
    <InputAdornment position="end">
      <IconButton aria-label={mostrar ? 'Ocultar senha' : 'Mostrar senha'} onClick={() => setMostrar((v) => !v)} edge="end">
        {mostrar ? <VisibilityOffIcon /> : <VisibilityIcon />}
      </IconButton>
    </InputAdornment>
  );

  if (!pronto) return null;

  return (
    <Box sx={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', p: { xs: 1.5, sm: 2 } }}>
      <Card sx={{ width: '100%', maxWidth: 440 }}>
        <CardContent sx={{ p: { xs: 2.5, sm: 3 } }}>
          <Stack alignItems="center" spacing={1} sx={{ mb: 2 }}>
            <AccountBalanceWalletIcon color="primary" sx={{ fontSize: 48 }} />
            <Typography variant="h5" fontWeight={700} textAlign="center">Controle Financeiro</Typography>
            <Typography variant="body2" color="text.secondary" textAlign="center">
              Seus dados ficam guardados só neste aparelho
            </Typography>
          </Stack>

          <Tabs value={aba} onChange={trocarAba} variant="fullWidth" sx={{ mb: 2 }}>
            <Tab label="Entrar" />
            <Tab label="Criar conta" />
          </Tabs>

          <Box component="form" onSubmit={enviar} noValidate>
            <Stack spacing={2}>
              {erro && <Alert severity="error">{erro}</Alert>}

              {novo && primeiraConta && temAntigos && (
                <Alert severity="info">
                  Encontramos lançamentos já salvos neste aparelho. Eles serão trazidos para a sua conta e protegidos pela senha.
                </Alert>
              )}
              {novo && (
                <Alert severity="warning">
                  Não existe recuperação de senha. Se esquecê-la, só um backup restaura seus dados. Use “Exportar backup” no menu de vez em quando.
                </Alert>
              )}

              <TextField
                label="Nome de usuário" value={nome} onChange={(e) => setNome(e.target.value)}
                autoComplete="username" autoCapitalize="none" required autoFocus={!nome}
                slotProps={{ htmlInput: { maxLength: 40 } }}
              />
              <TextField
                label="Senha" type={mostrar ? 'text' : 'password'} value={senha} onChange={(e) => setSenha(e.target.value)}
                autoComplete={novo ? 'new-password' : 'current-password'} required autoFocus={Boolean(nome)}
                helperText={novo ? 'Mínimo de 8 caracteres, com letra maiúscula, minúscula e número.' : undefined}
                slotProps={{ input: { endAdornment: botaoOlho } }}
              />
              {novo && (
                <TextField
                  label="Repita a senha" type={mostrar ? 'text' : 'password'} value={confirmar}
                  onChange={(e) => setConfirmar(e.target.value)} autoComplete="new-password" required
                />
              )}

              <Button type="submit" variant="contained" size="large" disabled={enviando || !nome.trim() || !senha || (novo && !confirmar)}>
                {enviando ? (novo ? 'Criando…' : 'Entrando…') : novo ? 'Criar conta' : 'Entrar'}
              </Button>

              {!novo && desbloqueio && (
                <>
                  <Divider>ou</Divider>
                  <Button
                    variant="outlined" size="large" startIcon={<FingerprintIcon />} onClick={entrarComDesbloqueio} disabled={enviando}
                  >
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
        </CardContent>
      </Card>

      <EsqueciSenhaDialog
        open={esqueci} nomeInicial={nome}
        onClose={() => setEsqueci(false)}
        onApagada={(apagado) => {
          setEsqueci(false);
          setSenha('');
          setErro('');
          listarUsuarios().then((l) => { setPrimeiraConta(l.length === 0); if (l.length === 0) setAba(1); });
          if (apagado) setNome('');
        }}
      />
    </Box>
  );
}

/** Explica que não há recuperação e oferece apagar a conta (para recomeçar e importar um backup). */
function EsqueciSenhaDialog({ open, nomeInicial, onClose, onApagada }) {
  const [nome, setNome] = useState('');
  const [erro, setErro] = useState('');
  const [apagando, setApagando] = useState(false);

  useEffect(() => { if (open) { setNome(nomeInicial); setErro(''); } }, [open, nomeInicial]);

  const apagar = async () => {
    setErro('');
    setApagando(true);
    try {
      await excluirConta(nome);
      await cancelarNotificacoes(); // lembretes dessa conta não devem continuar aparecendo
      onApagada(true);
    } catch (e) {
      setErro(e.message);
    } finally {
      setApagando(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Esqueci minha senha</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <DialogContentText>
            Os dados são criptografados com a sua senha, então ela não pode ser recuperada nem redefinida — nem por
            nós. Você tem duas saídas:
          </DialogContentText>
          <DialogContentText component="div">
            <ol style={{ margin: 0, paddingLeft: 20 }}>
              <li>Tentar lembrar da senha. Não há limite de tentativas.</li>
              <li>
                Apagar esta conta, criar uma nova com o mesmo nome e usar “Importar backup” no menu, se você tiver um
                arquivo de backup.
              </li>
            </ol>
          </DialogContentText>
          {erro && <Alert severity="error">{erro}</Alert>}
          <TextField
            label="Nome da conta a apagar" value={nome} onChange={(e) => setNome(e.target.value)}
            helperText="Apaga a conta e todos os lançamentos dela deste aparelho. Não dá para desfazer."
          />
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>Voltar</Button>
        <Button color="error" variant="contained" onClick={apagar} disabled={apagando || !nome.trim()}>
          Apagar conta e dados
        </Button>
      </DialogActions>
    </Dialog>
  );
}
