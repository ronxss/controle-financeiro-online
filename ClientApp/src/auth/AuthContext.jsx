import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { api } from '../api.js';
import { MODO_LOCAL } from '../modo.js';
import { solicitarPersistencia } from '../local/armazenamento.js';
import * as contaLocal from '../local/auth.js';
import { iniciarServicosAparelho } from '../local/servicosAparelho.js';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
  const [usuario, setUsuario] = useState(null);
  const [carregando, setCarregando] = useState(!MODO_LOCAL);

  useEffect(() => {
    if (MODO_LOCAL) {
      solicitarPersistencia(); // pede ao navegador para não apagar os dados sozinho
      iniciarServicosAparelho(); // APK: lembretes e backup automático (no navegador não faz nada)
      return undefined; // no modo local, a pessoa sempre começa na tela de login (a chave só vive na memória)
    }

    api.get('/api/auth/eu')
      .then(setUsuario)
      .catch(() => setUsuario(null))
      .finally(() => setCarregando(false));

    const aoExpirar = () => setUsuario(null);
    window.addEventListener('auth:expirou', aoExpirar);
    return () => window.removeEventListener('auth:expirou', aoExpirar);
  }, []);

  // ----- Modo servidor (ASP.NET Core) -----
  const entrar = useCallback(async (email, senha) => {
    setUsuario(await api.post('/api/auth/entrar', { email, senha }));
  }, []);

  const registrar = useCallback(async (nome, email, senha) => {
    setUsuario(await api.post('/api/auth/registrar', { nome, email, senha }));
  }, []);

  const entrarComGoogle = useCallback(async (credential) => {
    setUsuario(await api.post('/api/auth/google', { credential }));
  }, []);

  // ----- Modo local (conta guardada só neste aparelho) -----
  const entrarLocal = useCallback(async (nome, senha) => {
    setUsuario(await contaLocal.entrar(nome, senha));
  }, []);

  const entrarLocalDesbloqueio = useCallback(async (dados) => {
    setUsuario(await contaLocal.entrarComDesbloqueio(dados));
  }, []);

  /** Devolve { adotouLegado } para a tela poder avisar que os dados antigos foram trazidos para a conta. */
  const criarContaLocal = useCallback(async (nome, senha) => {
    const r = await contaLocal.criarConta(nome, senha);
    setUsuario(r.usuario);
    return { adotouLegado: r.adotouLegado };
  }, []);

  const sair = useCallback(async () => {
    if (MODO_LOCAL) {
      contaLocal.sair();
      setUsuario(null);
      return;
    }
    try { await api.post('/api/auth/sair'); } finally { setUsuario(null); }
  }, []);

  return (
    <AuthContext.Provider
      value={{ usuario, carregando, entrar, registrar, entrarComGoogle, entrarLocal, entrarLocalDesbloqueio, criarContaLocal, sair }}
    >
      {children}
    </AuthContext.Provider>
  );
}
