import { InputAdornment, TextField } from '@mui/material';
import { MAX_DIGITOS_MOEDA, mascaraMoeda, textoLivreParaCampo } from '../utils/format.js';

const digitos = (t) => String(t ?? '').replace(/\D/g, '');

/**
 * Campo de valor em reais com máscara: os dígitos entram pela direita (1 -> 0,01; 15090 -> 150,90).
 * `value`/`onChange(texto)` trabalham com o texto já formatado ('1.234,56' ou ''), que o parseValor entende.
 * Colar '150,9', '1.234,56' ou 'R$ 10' também funciona.
 */
export default function CampoMoeda({ value, onChange, slotProps, ...props }) {
  const mudar = (e) => {
    const novo = e.target.value;
    let d = digitos(novo);
    // Apagou só a vírgula ou um ponto: os dígitos não mudaram, então apaga o último dígito.
    if (d === digitos(value) && novo.length < String(value ?? '').length) d = d.slice(0, -1);
    if (d.replace(/^0+/, '').length > MAX_DIGITOS_MOEDA) return; // campo cheio: ignora o dígito a mais
    onChange(mascaraMoeda(d));
  };

  const colar = (e) => {
    const texto = e.clipboardData?.getData('text');
    if (!texto) return;
    e.preventDefault(); // o onChange não dispara: o texto colado é tratado aqui
    onChange(textoLivreParaCampo(texto));
  };

  // Ao entrar no campo, o cursor vai para o fim: é onde os dígitos entram.
  const cursorNoFim = (e) => {
    const el = e.target;
    requestAnimationFrame(() => { try { const n = el.value.length; el.setSelectionRange(n, n); } catch { /* campo já desmontado */ } });
  };

  return (
    <TextField
      {...props}
      value={value ?? ''}
      onChange={mudar}
      placeholder={props.placeholder ?? '0,00'}
      slotProps={{
        ...slotProps,
        input: { startAdornment: <InputAdornment position="start">R$</InputAdornment>, ...slotProps?.input },
        htmlInput: {
          inputMode: 'numeric', autoComplete: 'off', enterKeyHint: 'next',
          onPaste: colar, onFocus: cursorNoFim,
          ...slotProps?.htmlInput,
        },
      }}
    />
  );
}
