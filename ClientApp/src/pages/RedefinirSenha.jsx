import { useState } from 'react';
import {
  Alert, Box, Button, Card, CardContent, IconButton, InputAdornment, Stack, TextField, Typography,
} from '@mui/material';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import LockResetIcon from '@mui/icons-material/LockReset';
import { api } from '../api.js';

/** Aberta pelo link do e-mail: /redefinir-senha?email=...&token=... */
export default function RedefinirSenha() {
  const params = new URLSearchParams(window.location.search);
  const email = params.get('email') ?? '';
  const token = params.get('token') ?? '';
  const [senha, setSenha] = useState('');
  const [confirmar, setConfirmar] = useState('');
  const [mostrar, setMostrar] = useState(false);
  const [erro, setErro] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [pronto, setPronto] = useState(false);

  const irParaLogin = () => window.location.assign('/');

  const enviar = async (e) => {
    e.preventDefault();
    setErro('');
    if (senha !== confirmar) return setErro('As senhas não conferem.');
    setEnviando(true);
    try {
      await api.post('/api/auth/redefinir-senha', { email, token, novaSenha: senha });
      setPronto(true);
    } catch (err) {
      setErro(err.message);
    } finally {
      setEnviando(false);
    }
  };

  const olho = (
    <InputAdornment position="end">
      <IconButton aria-label={mostrar ? 'Ocultar senha' : 'Mostrar senha'} onClick={() => setMostrar((v) => !v)} edge="end">
        {mostrar ? <VisibilityOffIcon /> : <VisibilityIcon />}
      </IconButton>
    </InputAdornment>
  );

  return (
    <Box sx={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', p: 2 }}>
      <Card sx={{ width: '100%', maxWidth: 420 }}>
        <CardContent sx={{ p: 3 }}>
          <Stack alignItems="center" spacing={1} sx={{ mb: 2 }}>
            <LockResetIcon color="primary" sx={{ fontSize: 48 }} />
            <Typography variant="h5" fontWeight={700} textAlign="center">Criar nova senha</Typography>
            {email && <Typography variant="body2" color="text.secondary">{email}</Typography>}
          </Stack>

          {!email || !token ? (
            <Stack spacing={2}>
              <Alert severity="error">Link incompleto. Abra o link do e-mail de novo ou peça outro em “Esqueci minha senha”.</Alert>
              <Button variant="contained" onClick={irParaLogin}>Ir para o login</Button>
            </Stack>
          ) : pronto ? (
            <Stack spacing={2}>
              <Alert severity="success">Senha alterada. Entre com a nova senha.</Alert>
              <Button variant="contained" onClick={irParaLogin}>Ir para o login</Button>
            </Stack>
          ) : (
            <Box component="form" onSubmit={enviar} noValidate>
              <Stack spacing={2}>
                {erro && <Alert severity="error">{erro}</Alert>}
                <TextField
                  label="Nova senha" type={mostrar ? 'text' : 'password'} value={senha} onChange={(e) => setSenha(e.target.value)}
                  autoComplete="new-password" autoFocus required
                  helperText="Mínimo de 8 caracteres, com letra maiúscula, minúscula e número."
                  slotProps={{ input: { endAdornment: olho } }}
                />
                <TextField
                  label="Repita a nova senha" type={mostrar ? 'text' : 'password'} value={confirmar}
                  onChange={(e) => setConfirmar(e.target.value)} autoComplete="new-password" required
                />
                <Button type="submit" variant="contained" size="large" disabled={enviando || !senha || !confirmar}>
                  {enviando ? 'Salvando…' : 'Salvar nova senha'}
                </Button>
              </Stack>
            </Box>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}
