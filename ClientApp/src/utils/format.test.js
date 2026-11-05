import test from 'node:test';
import assert from 'node:assert/strict';
import { mascaraMoeda, valorParaCampo, textoLivreParaCampo, parseValor } from './format.js';

test('máscara: dígitos entram pela direita', () => {
  assert.equal(mascaraMoeda(''), '');
  assert.equal(mascaraMoeda('0'), '');
  assert.equal(mascaraMoeda('000'), '');
  assert.equal(mascaraMoeda('1'), '0,01');
  assert.equal(mascaraMoeda('15'), '0,15');
  assert.equal(mascaraMoeda('150'), '1,50');
  assert.equal(mascaraMoeda('15090'), '150,90');
  assert.equal(mascaraMoeda('123456'), '1.234,56');
  assert.equal(mascaraMoeda('100000000'), '1.000.000,00');
  assert.equal(mascaraMoeda('R$ 1.234,567'), '12.345,67', 'ignora o que não é dígito');
  assert.equal(mascaraMoeda('999999999999999'), '999.999.999,99', 'limite de 11 dígitos');
  assert.equal(mascaraMoeda('0,05'), '0,05');
});

test('número vindo da API vira texto do campo', () => {
  assert.equal(valorParaCampo(150.9), '150,90');
  assert.equal(valorParaCampo(1234.56), '1.234,56');
  assert.equal(valorParaCampo(0.1 + 0.2), '0,30', 'sem erro de ponto flutuante');
  assert.equal(valorParaCampo(19.99), '19,99');
  assert.equal(valorParaCampo(5000), '5.000,00');
  for (const v of [0, null, undefined, '', NaN, -3]) assert.equal(valorParaCampo(v), '', String(v));
});

test('texto colado em vários formatos', () => {
  assert.equal(textoLivreParaCampo('150,9'), '150,90');
  assert.equal(textoLivreParaCampo('150.90'), '150,90');
  assert.equal(textoLivreParaCampo('1.234,56'), '1.234,56');
  assert.equal(textoLivreParaCampo('1,234.56'), '1.234,56');
  assert.equal(textoLivreParaCampo('R$ 10'), '10,00');
  assert.equal(textoLivreParaCampo('1.500'), '1.500,00', 'ponto com 3 dígitos é milhar');
  assert.equal(textoLivreParaCampo(' 89,9 '), '89,90');
  assert.equal(textoLivreParaCampo('abc'), '');
});

test('o texto da máscara é lido pelo parseValor', () => {
  for (const [txt, n] of [['0,01', 0.01], ['150,90', 150.9], ['1.234,56', 1234.56], ['999.999.999,99', 999999999.99]]) {
    assert.equal(parseValor(txt), n, txt);
  }
  assert.ok(Number.isNaN(parseValor('')));
});
