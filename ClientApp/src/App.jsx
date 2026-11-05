import { useCallback, useMemo, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Box, CircularProgress, CssBaseline, ThemeProvider, createTheme } from '@mui/material';
import { BotaoTema, TemaContext } from './tema.jsx';
import { AuthProvider, useAuth } from './auth/AuthContext.jsx';
import { MesProvider } from './MesContext.jsx';
import Layout from './components/Layout.jsx';
import Login from './pages/Login.jsx';
import LoginLocal from './pages/LoginLocal.jsx';
import { MODO_LOCAL } from './modo.js';
import Resumo from './pages/Resumo.jsx';
import Lancamentos from './pages/Lancamentos.jsx';
import Orcamento from './pages/Orcamento.jsx';
import Cadastros from './pages/Cadastros.jsx';
import Cartoes from './pages/Cartoes.jsx';
import RedefinirSenha from './pages/RedefinirSenha.jsx';

function Conteudo() {
  const { usuario, carregando } = useAuth();

  if (carregando) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '100dvh' }}>
        <CircularProgress />
      </Box>
    );
  }
  if (!usuario) {
    // O link do e-mail de troca de senha abre a tela de redefinição mesmo sem login.
    const tela = MODO_LOCAL ? <LoginLocal /> : window.location.pathname === '/redefinir-senha' ? <RedefinirSenha /> : <Login />;
    return (
      <>
        <BotaoTema color="default" sx={{ position: 'fixed', zIndex: 10, top: 'calc(env(safe-area-inset-top) + 8px)', right: 'calc(env(safe-area-inset-right) + 8px)' }} />
        {tela}
      </>
    );
  }

  return (
    <MesProvider>
      <Layout>
        <Routes>
          <Route path="/" element={<Resumo />} />
          <Route path="/lancamentos" element={<Lancamentos />} />
          <Route path="/orcamento" element={<Orcamento />} />
          <Route path="/cadastros" element={<Cadastros />} />
          <Route path="/cartoes" element={<Cartoes />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </MesProvider>
  );
}

export default function App() {
  // Sempre começa no escuro; o botão da barra (ou da tela de entrada) troca enquanto o app estiver aberto.
  const [escuro, setEscuro] = useState(true);
  const alternar = useCallback(() => setEscuro((e) => !e), []);
  const contexto = useMemo(() => ({ escuro, alternar }), [escuro, alternar]);

  const tema = useMemo(
    () =>
      createTheme({
        palette: {
          mode: escuro ? 'dark' : 'light',
          primary: { main: escuro ? '#4db6ac' : '#00796b' },
          secondary: { main: '#5c6bc0' },
          success: { main: escuro ? '#66bb6a' : '#2e7d32' },
          error: { main: escuro ? '#ef5350' : '#c62828' },
          background: escuro ? {} : { default: '#f5f7f8' },
        },
        shape: { borderRadius: 12 },
        typography: { fontFamily: 'Roboto, Helvetica, Arial, sans-serif' },
        components: {
          MuiButton: { styleOverrides: { root: { textTransform: 'none', fontWeight: 500 } } },
          MuiCard: { defaultProps: { variant: 'outlined' } },
          MuiTextField: { defaultProps: { variant: 'outlined' } },
        },
      }),
    [escuro]
  );

  return (
    <TemaContext.Provider value={contexto}>
      <ThemeProvider theme={tema}>
        <CssBaseline />
        <AuthProvider>
          <Conteudo />
        </AuthProvider>
      </ThemeProvider>
    </TemaContext.Provider>
  );
}
