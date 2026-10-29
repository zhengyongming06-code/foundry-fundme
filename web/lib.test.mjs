import test from 'node:test';
import assert from 'node:assert/strict';
import { parseEther, formatEther, minimumWei, validateTransaction } from './lib.mjs';

test('ETH amounts preserve wei precision without floating point', () => {
  assert.equal(parseEther('0.000000000000000001'), 1n);
  assert.equal(parseEther('1.123456789012345678'), 1123456789012345678n);
  assert.equal(formatEther(10000000000000000n), '0.01');
});
test('invalid monetary input is rejected', () => {
  for (const value of ['0', '-1', '1e3', 'NaN', '0.0000000000000000001', '01', '', '1.']) {
    assert.throws(() => parseEther(value), undefined, value);
  }
});
test('minimum ETH rounds upward so threshold is never underfunded', () => {
  const usd = 5n * 10n ** 18n;
  const price = 3001n * 10n ** 18n;
  const result = minimumWei(usd, price);
  assert.ok(result * price / 10n ** 18n >= usd);
  assert.ok((result - 1n) * price / 10n ** 18n < usd);
});
const config = { address: '0x1111', accounts: ['0xaaaa'], selectors: { 'fund()': '0x12345678', 'withdraw()': '0x87654321' } };
const tx = { from: '0xaaaa', to: '0x1111', data: '0x12345678', value: '0x1', gas: '0x493e0' };
test('local proxy allows configured contract calls only', () => {
  assert.equal(validateTransaction(tx, config), tx);
  assert.throws(() => validateTransaction({ ...tx, to: '0x2222' }, config));
  assert.throws(() => validateTransaction({ ...tx, from: '0xbbbb' }, config));
  assert.throws(() => validateTransaction({ ...tx, data: '0x1234567800' }, config));
});
test('local proxy rejects extra fields and invalid gas or value', () => {
  assert.throws(() => validateTransaction({ ...tx, nonce: '0x0' }, config));
  assert.throws(() => validateTransaction({ ...tx, gas: '0x10000000' }, config));
  assert.throws(() => validateTransaction({ ...tx, value: '-1' }, config));
  assert.throws(() => validateTransaction({ ...tx, data: '0x87654321' }, config));
});
