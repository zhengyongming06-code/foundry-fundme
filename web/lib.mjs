export const WEI = 10n ** 18n;

export function parseEther(input) {
  const value = String(input).trim();
  if (!/^(0|[1-9]\d*)(\.\d{1,18})?$/.test(value)) {
    throw new Error('请输入正确的 ETH 金额，最多 18 位小数');
  }
  const [whole, fraction = ''] = value.split('.');
  const amount = BigInt(whole) * WEI + BigInt(fraction.padEnd(18, '0'));
  if (amount <= 0n) throw new Error('捐款金额必须大于零');
  if (amount >= 2n ** 256n) throw new Error('金额超出范围');
  return amount;
}

export function formatEther(value, precision = 6) {
  const amount = BigInt(value);
  const fraction = (amount % WEI).toString().padStart(18, '0').slice(0, precision).replace(/0+$/, '');
  return (amount / WEI).toString() + (fraction ? `.${fraction}` : '');
}

export function minimumWei(minimumUsd, quoteUsd) {
  if (quoteUsd <= 0n) throw new Error('报价不可用');
  return (minimumUsd * WEI + quoteUsd - 1n) / quoteUsd;
}

export const hex = value => '0x' + BigInt(value).toString(16);
export const word = value => BigInt(value).toString(16).padStart(64, '0');
export const short = address => address ? `${address.slice(0, 6)}…${address.slice(-4)}` : '—';

export function validateTransaction(tx, config) {
  if (!tx || typeof tx !== 'object' || Array.isArray(tx)) throw new Error('Invalid transaction');
  const allowedKeys = new Set(['from', 'to', 'data', 'value', 'gas']);
  if (Object.keys(tx).some(key => !allowedKeys.has(key))) throw new Error('Unsupported transaction field');
  if (!config.accounts.some(account => account.toLowerCase() === String(tx.from).toLowerCase())) throw new Error('Unknown local account');
  if (String(tx.to).toLowerCase() !== config.address.toLowerCase()) throw new Error('Unexpected transaction recipient');
  if (![config.selectors['fund()'], config.selectors['withdraw()']].includes(tx.data)) throw new Error('Unsupported transaction call');
  if (tx.value !== undefined && !/^0x[0-9a-f]+$/i.test(tx.value)) throw new Error('Invalid value');
  if (tx.gas !== undefined && (!/^0x[0-9a-f]+$/i.test(tx.gas) || BigInt(tx.gas) > 1_000_000n)) throw new Error('Invalid gas limit');
  if (tx.data === config.selectors['withdraw()'] && BigInt(tx.value ?? 0) !== 0n) throw new Error('Withdrawal cannot include ETH');
  return tx;
}
