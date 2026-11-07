import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  AppBar, Avatar, BottomNavigation, BottomNavigationAction, Box, Divider, Drawer, IconButton, List,
  ListItemButton, ListItemIcon, ListItemText, Menu, MenuItem, Paper, Snackbar, Toolbar, Tooltip, Typography,
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import DashboardIcon from '@mui/icons-material/Dashboard';
import ReceiptLongIcon from '@mui/icons-material/ReceiptLong';
import SavingsIcon from '@mui/icons-material/Savings';
import TuneIcon from '@mui/icons-material/Tune';
import CreditCardIcon from '@mui/icons-material/CreditCard';
import LogoutIcon from '@mui/icons-material/Logout';
import LockResetIcon from '@mui/icons-material/LockReset';
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import FileUploadIcon from '@mui/icons-material/FileUpload';
import { useAuth } from '../auth/AuthContext.jsx';
import { useMes } from '../MesContext.jsx';
import { mesAtual, moverMes, rotuloMes } from '../utils/format.js';
import SenhaDialog from './SenhaDialog.jsx';
import ConfirmDialog from './ConfirmDialog.jsx';
import { MODO_LOCAL } from '../modo.js';
import { conferirBackup, exportarBackup, importarBackup, mensagemExportacao } from '../local/backup.js';
import ConfigAparelhoDialog from './ConfigAparelhoDialog.jsx';
import { BotaoTema } from '../tema.jsx';
import ExportarCsvDialog from './ExportarCsvDialog.jsx';
import GridOnIcon from '@mui/icons-material/GridOn';
import NotificationsIcon from '@mui/icons-material/Notifications';
import FingerprintIcon from '@mui/icons-material/Fingerprint';
import DesbloqueioDialog from './DesbloqueioDialog.jsx';
import { desbloqueioDisponivel, deveOfertarDesbloqueio } from '../local/auth.js';
import PasskeysDialog from './PasskeysDialog.jsx';
import { deveOfertar as deveOfertarPasskey, passkeysDisponiveis } from '../passkeysOnline.js';

const LARGURA = 220;
const ITENS = [
  { caminho: '/', rotulo: 'Resumo', icone: <DashboardIcon /> },
  { caminho: '/lancamentos', rotulo: 'Lançamentos', icone: <ReceiptLongIcon /> },
  { caminho: '/cartoes', rotulo: 'Cartões', icone: <CreditCardIcon /> },
  { caminho: '/orcamento', rotulo: 'Orçamento', icone: <SavingsIcon /> },
  { caminho: '/cadastros', rotulo: 'Cadastros', icone: <TuneIcon /> },
];

export default function Layout({ children }) {
  const theme = useTheme();
  const desktop = useMediaQuery(theme.breakpoints.up('md'));
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { usuario, sair } = useAuth();
  const { mes, setMes } = useMes();
  const [ancora, setAncora] = useState(null);
  const [senhaAberta, setSenhaAberta] = useState(false);
  const [configAberta, setConfigAberta] = useState(false);
  const [csvAberto, setCsvAberto] = useState(false);
  // Desbloqueio do aparelho (modo local): opção no menu e oferta única logo depois de entrar com a senha.
  const [temDesbloqueio, setTemDesbloqueio] = useState(false);
  const [desbloqueio, setDesbloqueio] = useState(null); // null | { oferta: bool }
  // (versão online: passkeys conferidas pelo servidor; mesma opção no menu e mesma oferta.)
  useEffect(() => {
    let vivo = true;
    (MODO_LOCAL ? desbloqueioDisponivel() : passkeysDisponiveis()).then((d) => vivo && setTemDesbloqueio(d));
    (MODO_LOCAL ? deveOfertarDesbloqueio() : deveOfertarPasskey(usuario.email))
      .then((o) => vivo && o && setDesbloqueio({ oferta: true })).catch(() => {});
    return () => { vivo = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Backup (só no modo local, onde os dados existem apenas no aparelho).
  const [aviso, setAviso] = useState('');
  const [backupPendente, setBackupPendente] = useState(null); // texto do arquivo, aguardando confirmação
  const seletorArquivo = useRef(null);
  const [versaoDados, setVersaoDados] = useState(0); // muda após importar: as telas recarregam os dados

  const aoExportar = async () => {
    setAncora(null);
    try {
      setAviso(mensagemExportacao(await exportarBackup()));
    } catch (e) {
      setAviso(e.message || 'Não foi possível gerar o backup.');
    }
  };

  const aoEscolherArquivo = async (e) => {
    const arquivo = e.target.files?.[0];
    e.target.value = ''; // permite escolher o mesmo arquivo outra vez
    if (!arquivo) return;
    try {
      const texto = await arquivo.text();
      conferirBackup(texto); // valida antes de perguntar
      setBackupPendente(texto);
    } catch (err) {
      setAviso(err.message || 'Não foi possível ler o arquivo.');
    }
  };

  const confirmarImportacao = async () => {
    try {
      await importarBackup(backupPendente);
      setBackupPendente(null);
      setVersaoDados((v) => v + 1); // remonta as telas, que buscam os dados restaurados (sem deslogar)
      setAviso('Backup importado com sucesso.');
    } catch (err) {
      setBackupPendente(null);
      setAviso(err.message || 'Não foi possível importar o backup.');
    }
  };

  const atual = ITENS.findIndex((i) => i.caminho === pathname);

  return (
    <Box sx={{ display: 'flex', minHeight: '100dvh' }}>
      <AppBar
        position="fixed" elevation={0}
        sx={{ zIndex: (t) => t.zIndex.drawer + 1, pt: 'env(safe-area-inset-top)', pl: 'env(safe-area-inset-left)', pr: 'env(safe-area-inset-right)' }}
      >
        <Toolbar sx={{ gap: { xs: 0, sm: 1 }, px: { xs: 1, sm: 2 } }}>
          <Typography variant="h6" fontWeight={700} sx={{ display: { xs: 'none', sm: 'block' }, mr: 2 }}>
            Controle Financeiro
          </Typography>

          <Box sx={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
            <IconButton color="inherit" aria-label="Mês anterior" onClick={() => setMes(moverMes(mes, -1))}>
              <ChevronLeftIcon />
            </IconButton>
            <Tooltip title="Voltar ao mês atual">
              <Typography
                onClick={() => setMes(mesAtual())}
                sx={{ minWidth: { xs: 130, sm: 150 }, textAlign: 'center', fontWeight: 500, cursor: 'pointer', userSelect: 'none' }}
              >
                {rotuloMes(mes)}
              </Typography>
            </Tooltip>
            <IconButton color="inherit" aria-label="Próximo mês" onClick={() => setMes(moverMes(mes, 1))}>
              <ChevronRightIcon />
            </IconButton>
          </Box>

          <BotaoTema />
          <IconButton onClick={(e) => setAncora(e.currentTarget)} aria-label="Menu do usuário">
            <Avatar sx={{ width: 34, height: 34, bgcolor: 'secondary.main', fontSize: 16 }}>
              {usuario.nome.charAt(0).toUpperCase()}
            </Avatar>
          </IconButton>
          <Menu anchorEl={ancora} open={Boolean(ancora)} onClose={() => setAncora(null)}>
            <Box sx={{ px: 2, py: 1 }}>
              <Typography fontWeight={500}>{usuario.nome}</Typography>
              <Typography variant="body2" color="text.secondary">{usuario.email}</Typography>
            </Box>
            <Divider />
            {usuario.temSenha && (
              <MenuItem onClick={() => { setAncora(null); setSenhaAberta(true); }}>
                <ListItemIcon><LockResetIcon fontSize="small" /></ListItemIcon>Alterar senha
              </MenuItem>
            )}
            {temDesbloqueio && (
              <MenuItem onClick={() => { setAncora(null); setDesbloqueio({ oferta: false }); }}>
                <ListItemIcon><FingerprintIcon fontSize="small" /></ListItemIcon>Desbloqueio do aparelho
              </MenuItem>
            )}
            {MODO_LOCAL && (
              <MenuItem onClick={() => { setAncora(null); setConfigAberta(true); }}>
                <ListItemIcon><NotificationsIcon fontSize="small" /></ListItemIcon>Lembretes e backup
              </MenuItem>
            )}
            {(
              <MenuItem onClick={aoExportar}>
                <ListItemIcon><FileDownloadIcon fontSize="small" /></ListItemIcon>Exportar backup
              </MenuItem>
            )}
            {(
              <MenuItem onClick={() => { setAncora(null); setCsvAberto(true); }}>
                <ListItemIcon><GridOnIcon fontSize="small" /></ListItemIcon>Exportar planilha (CSV)
              </MenuItem>
            )}
            {(
              <MenuItem onClick={() => { setAncora(null); seletorArquivo.current?.click(); }}>
                <ListItemIcon><FileUploadIcon fontSize="small" /></ListItemIcon>Importar backup
              </MenuItem>
            )}
            <MenuItem onClick={() => { setAncora(null); sair(); }}>
              <ListItemIcon><LogoutIcon fontSize="small" /></ListItemIcon>Sair
            </MenuItem>
          </Menu>
        </Toolbar>
      </AppBar>

      {desktop && (
        <Drawer
          variant="permanent"
          sx={{ width: LARGURA, flexShrink: 0, '& .MuiDrawer-paper': { width: LARGURA, boxSizing: 'border-box' } }}
        >
          <Toolbar />
          <Box sx={{ height: 'env(safe-area-inset-top)' }} />
          <List sx={{ p: 1 }}>
            {ITENS.map((i) => (
              <ListItemButton
                key={i.caminho}
                selected={pathname === i.caminho}
                onClick={() => navigate(i.caminho)}
                sx={{ borderRadius: 2, mb: 0.5 }}
              >
                <ListItemIcon sx={{ minWidth: 40 }}>{i.icone}</ListItemIcon>
                <ListItemText primary={i.rotulo} />
              </ListItemButton>
            ))}
          </List>
        </Drawer>
      )}

      <Box
        component="main"
        sx={{
          flex: 1, minWidth: 0, p: { xs: 2, md: 3 },
          pb: { xs: 'calc(88px + env(safe-area-inset-bottom))', md: 3 },
          pl: { xs: 'max(16px, env(safe-area-inset-left))', md: 3 },
          pr: { xs: 'max(16px, env(safe-area-inset-right))', md: 3 },
        }}
      >
        <Toolbar />
        <Box sx={{ height: 'env(safe-area-inset-top)' }} />
        <Box key={versaoDados} sx={{ maxWidth: 1100, mx: 'auto' }}>{children}</Box>
      </Box>

      {!desktop && (
        <Paper
          sx={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: (t) => t.zIndex.appBar, pb: 'env(safe-area-inset-bottom)' }}
          elevation={8}
        >
          <BottomNavigation showLabels value={atual === -1 ? 0 : atual} onChange={(_, v) => navigate(ITENS[v].caminho)}>
            {ITENS.map((i) => (
              <BottomNavigationAction key={i.caminho} label={i.rotulo} icon={i.icone} sx={{ minWidth: 0, px: 0.5 }} />
            ))}
          </BottomNavigation>
        </Paper>
      )}

      <SenhaDialog open={senhaAberta} onClose={() => setSenhaAberta(false)} />
      {MODO_LOCAL ? (
        <DesbloqueioDialog
          open={Boolean(desbloqueio)} oferta={desbloqueio?.oferta} onAviso={setAviso}
          onClose={() => setDesbloqueio(null)}
        />
      ) : (
        <PasskeysDialog
          open={Boolean(desbloqueio)} oferta={desbloqueio?.oferta} onAviso={setAviso} email={usuario.email}
          temSenha={usuario.temSenha} onClose={() => setDesbloqueio(null)}
        />
      )}
      {<ExportarCsvDialog open={csvAberto} mes={mes} onClose={() => setCsvAberto(false)} onAviso={setAviso} />}
      {MODO_LOCAL && <ConfigAparelhoDialog open={configAberta} onClose={() => setConfigAberta(false)} onExportar={aoExportar} />}

      {(
        <input ref={seletorArquivo} type="file" accept="application/json,.json" hidden onChange={aoEscolherArquivo} />
      )}
      <ConfirmDialog
        open={backupPendente !== null} titulo="Importar backup?" rotuloConfirmar="Substituir dados"
        texto={`Todos os dados atuais ${MODO_LOCAL ? 'deste aparelho' : 'desta conta'} serão substituídos pelos do arquivo. Se quiser guardá-los, exporte um backup antes.`}
        onConfirmar={confirmarImportacao} onCancelar={() => setBackupPendente(null)}
      />
      <Snackbar open={Boolean(aviso)} autoHideDuration={6000} onClose={() => setAviso('')} message={aviso} />
    </Box>
  );
}
