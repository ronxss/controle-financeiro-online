import { useEffect, useState } from 'react';
import {
  Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel,
  MenuItem, Stack, Switch, TextField, ToggleButton, ToggleButtonGroup, useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { api } from '../api.js';
import { brl, dataBR, dataPadrao, parseValor, valorParaCampo } from '../utils/format.js';
import CampoMoeda from './CampoMoeda.jsx';
import { faturaDaCompra } from '../local/engine.js';
import { TEM_FIXAS } from '../modo.js';

/** Formulário de registro: um único passo, com os mesmos campos da aba "Lançamentos" da planilha. */
export default function LancamentoDialog({ open, item, categorias, contas, mes, onClose, onSaved }) {
  const editando = Boolean(item);
  const celular = useMediaQuery(useTheme().breakpoints.down('sm'));
  const [f, setF] = useState(null);
  const [erro, setErro] = useState('');
  const [aviso, setAviso] = useState('');
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!open) return;
    setErro('');
    setAviso('');
    setF(
      item
        ? {
            tipo: item.tipo,
            valor: valorParaCampo(item.valor),
            descricao: item.descricao,
            categoriaId: item.categoriaId,
            contaId: item.contaId,
            data: item.data,
            pago: item.status === 'PagoRecebido',
            fixa: item.fixa === true,
            parcelas: 1, valorDaParcela: false,
          }
        : {
            tipo: 'Despesa', valor: '', descricao: '', categoriaId: '', contaId: contas[0]?.id ?? '', data: dataPadrao(mes),
            pago: !contas[0]?.cartao, fixa: false, parcelas: 1, valorDaParcela: false,
          }
    );
  }, [open, item]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!f) return null;
  const set = (campo) => (e) => setF((p) => ({ ...p, [campo]: e.target.value }));
  const categoriasDoTipo = categorias.filter((c) => c.tipo === f.tipo);
  const verbo = f.tipo === 'Receita' ? 'recebido' : 'pago';
  const contaSel = contas.find((c) => c.id === Number(f.contaId));
  const cartao = TEM_FIXAS ? contaSel?.cartao : null;
  const fatura = cartao && /^\d{4}-\d{2}-\d{2}$/.test(f.data) ? faturaDaCompra(cartao, f.data) : null;
  const podeParcelar = TEM_FIXAS && !editando && f.tipo === 'Despesa';
  const parcelado = podeParcelar && f.parcelas > 1;
  const parcelaDoItem = editando ? item.parcela : null;
  const valorDigitado = parseValor(f.valor);
  const totalParcelado = parcelado && !Number.isNaN(valorDigitado)
    ? Math.round(valorDigitado * (f.valorDaParcela ? f.parcelas : 1) * 100) / 100 : null;

  const trocarConta = (e) => {
    const nova = contas.find((c) => c.id === Number(e.target.value));
    // Compra no cartão fica pendente até pagar a fatura.
    setF((p) => ({ ...p, contaId: e.target.value, pago: !editando && TEM_FIXAS && nova?.cartao ? false : p.pago }));
  };

  const salvar = async (continuar) => {
    setErro('');
    setAviso('');
    const valor = parseValor(f.valor);
    if (Number.isNaN(valor) || valor <= 0) return setErro('Informe um valor maior que zero.');
    if (!f.descricao.trim()) return setErro('Informe uma descrição.');
    if (!f.categoriaId) return setErro('Selecione a categoria.');
    if (!f.contaId) return setErro('Selecione a conta.');
    if (!f.data) return setErro('Informe a data.');

    const payload = {
      data: f.data,
      tipo: f.tipo,
      categoriaId: Number(f.categoriaId),
      descricao: f.descricao.trim(),
      contaId: Number(f.contaId),
      valor,
      status: f.pago ? 'PagoRecebido' : 'Pendente',
    };
    if (TEM_FIXAS) payload.fixa = !parcelado && !parcelaDoItem && f.fixa === true;
    if (parcelado) {
      payload.parcelas = f.parcelas;
      payload.valor = totalParcelado; // a API recebe o TOTAL e divide
    }

    setSalvando(true);
    try {
      if (editando) await api.put(`/api/lancamentos/${item.id}`, payload);
      else await api.post('/api/lancamentos', payload);
      onSaved();
      if (continuar && !editando) {
        setF((p) => ({ ...p, valor: '', descricao: '', parcelas: 1 }));
        setAviso(parcelado ? `Compra salva em ${f.parcelas} parcelas. Pode registrar a próxima.` : 'Lançamento salvo! Pode registrar o próximo.');
      } else {
        onClose();
      }
    } catch (e) {
      setErro(e.message);
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm" fullScreen={celular}>
      <DialogTitle>{editando ? 'Editar lançamento' : 'Novo lançamento'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2.5} sx={{ mt: 1 }}>
          {aviso && <Alert severity="success">{aviso}</Alert>}
          {erro && <Alert severity="error">{erro}</Alert>}

          <ToggleButtonGroup
            exclusive fullWidth value={f.tipo}
            onChange={(_, v) => v && setF((p) => ({ ...p, tipo: v, categoriaId: '' }))}
          >
            <ToggleButton value="Despesa" color="error">Despesa</ToggleButton>
            <ToggleButton value="Receita" color="success">Receita</ToggleButton>
          </ToggleButtonGroup>

          <CampoMoeda
            label="Valor" value={f.valor} onChange={(valor) => setF((p) => ({ ...p, valor }))} autoFocus
            sx={{ '& input': { fontSize: 22, fontWeight: 500 } }}
          />

          <TextField label="Descrição" value={f.descricao} onChange={set('descricao')} slotProps={{ htmlInput: { maxLength: 200 } }} />

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField select fullWidth label="Categoria" value={f.categoriaId} onChange={set('categoriaId')}>
              {categoriasDoTipo.map((c) => <MenuItem key={c.id} value={c.id}>{c.nome}</MenuItem>)}
            </TextField>
            <TextField select fullWidth label="Conta" value={f.contaId} onChange={trocarConta}>
              {contas.map((c) => <MenuItem key={c.id} value={c.id}>{c.nome}</MenuItem>)}
            </TextField>
          </Stack>

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
            <TextField
              fullWidth type="date" label="Data" value={f.data} onChange={set('data')}
              slotProps={{ inputLabel: { shrink: true } }}
            />
            <FormControlLabel
              sx={{ minWidth: 160 }}
              control={<Switch checked={f.pago} onChange={(e) => setF((p) => ({ ...p, pago: e.target.checked }))} />}
              label={f.pago ? `Já ${verbo}` : 'Pendente'}
            />
          </Stack>

          {fatura && (
            <Alert severity="info" icon={false}>
              Cartão: entra na fatura que vence em {dataBR(fatura.vencimento)}
              {parcelado ? ' (a 1ª parcela; as outras nas faturas seguintes)' : ''}. Fica pendente até você pagar a fatura em “Cartões”.
            </Alert>
          )}

          {podeParcelar && (
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
              <TextField
                select label="Pagamento" value={f.parcelas} sx={{ minWidth: 160 }}
                onChange={(e) => setF((p) => ({ ...p, parcelas: Number(e.target.value) }))}
              >
                <MenuItem value={1}>À vista</MenuItem>
                {Array.from({ length: 47 }, (_, i) => i + 2).map((n) => <MenuItem key={n} value={n}>{n}x</MenuItem>)}
              </TextField>
              {parcelado && (
                <ToggleButtonGroup
                  exclusive size="small" value={f.valorDaParcela ? 'parcela' : 'total'}
                  onChange={(_, v) => v && setF((p) => ({ ...p, valorDaParcela: v === 'parcela' }))}
                >
                  <ToggleButton value="total">Valor é o total</ToggleButton>
                  <ToggleButton value="parcela">Valor de cada parcela</ToggleButton>
                </ToggleButtonGroup>
              )}
            </Stack>
          )}
          {parcelado && totalParcelado > 0 && (
            <Alert severity="info" icon={false}>
              {f.parcelas}x de {brl(totalParcelado / f.parcelas)} · total {brl(totalParcelado)}. Uma parcela por mês, no mesmo dia;
              só a primeira segue o “{f.pago ? `Já ${verbo}` : 'Pendente'}”, as demais ficam pendentes.
            </Alert>
          )}
          {parcelaDoItem && (
            <Alert severity="info" icon={false}>
              Parcela {parcelaDoItem.numero} de {parcelaDoItem.total}. A alteração vale só para esta parcela.
            </Alert>
          )}

          {TEM_FIXAS && !parcelado && !parcelaDoItem && (
            <FormControlLabel
              control={<Switch checked={f.fixa} onChange={(e) => setF((p) => ({ ...p, fixa: e.target.checked }))} />}
              label={f.tipo === 'Receita' ? 'Receita fixa (repete todo mês)' : 'Despesa fixa (repete todo mês)'}
            />
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 'max(16px, env(safe-area-inset-bottom))', flexWrap: 'wrap', gap: 0.5 }}>
        <Button onClick={onClose}>Cancelar</Button>
        {!editando && <Button onClick={() => salvar(true)} disabled={salvando}>Salvar e adicionar outro</Button>}
        <Button variant="contained" onClick={() => salvar(false)} disabled={salvando}>Salvar</Button>
      </DialogActions>
    </Dialog>
  );
}
