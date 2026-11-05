import { createContext, useContext } from 'react';
import { IconButton, Tooltip } from '@mui/material';
import LightModeOutlinedIcon from '@mui/icons-material/LightModeOutlined';
import DarkModeOutlinedIcon from '@mui/icons-material/DarkModeOutlined';

/** Tema claro/escuro. O app sempre abre no escuro; a troca vale até fechar o app. */
export const TemaContext = createContext({ escuro: true, alternar: () => {} });
export const useTema = () => useContext(TemaContext);

export function BotaoTema({ sx, color = 'inherit' }) {
  const { escuro, alternar } = useTema();
  const rotulo = escuro ? 'Usar tema claro' : 'Usar tema escuro';
  return (
    <Tooltip title={rotulo}>
      <IconButton color={color} aria-label={rotulo} onClick={alternar} sx={sx}>
        {escuro ? <LightModeOutlinedIcon /> : <DarkModeOutlinedIcon />}
      </IconButton>
    </Tooltip>
  );
}
