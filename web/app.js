import { WEI, parseEther, formatEther, minimumWei, hex, word, short } from './lib.mjs';

const $ = id => document.getElementById(id);
const state = { config: null, mode: 'local', account: null, busy: false, online: false, quote: null, minimum: 5n * WEI, balance: 0n, walletBalance: 0n, owner: null, walletChain: null, hash: null, refreshPromise: null };
const usd = value => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(Number(value) / 1e18);

async function rpc(method, params = []) {
  const response = await fetch('/api/rpc', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, params }), signal: AbortSignal.timeout(12000),
  });
  const body = await response.json();
  if (!response.ok || body.error) {
    const error = new Error(body.error?.message || body.error || '本地节点请求失败');
    error.data = body.error?.data;
    error.code = body.error?.code;
    throw error;
  }
  return body.result;
}

const selector = signature => state.config.selectors[signature];
const isOwner = () => Boolean(state.account && state.owner && state.account.toLowerCase() === state.owner.toLowerCase());
const networkMatches = () => state.mode === 'local' || state.walletChain === state.config?.chainId;
const call = (signature, args = '') => rpc('eth_call', [{ to: state.config.address, data: selector(signature) + args }, 'latest']);

function explain(error) {
  if (error.code === 4001 || error.code === 'ACTION_REJECTED') return '你取消了钱包请求，未完成交易。';
  const text = [error.message, JSON.stringify(error.data || '')].join(' ');
  if (state.config) {
    const messages = {
      'BelowMinimum(uint256,uint256)': '捐款未达到 5 美元门槛，请增加金额。',
      'Unauthorized()': '当前账户不是管理员，无法提现。',
      'StalePrice()': '本地测试报价已过期。请重启前端启动脚本，部署新的 Mock 报价。',
      'InvalidPrice()': '价格预言机返回了无效报价。',
      'EmptyBalance()': '合约余额为零，暂时没有可提取资金。',
      'TransferFailed()': '接收账户未能收到 ETH，提现已回滚。',
      'Reentrancy()': '检测到重复进入提现流程，交易已拒绝。',
    };
    for (const [signature, message] of Object.entries(messages)) {
      if (text.toLowerCase().includes(selector(signature).toLowerCase())) return message;
    }
  }
  if (/insufficient funds/i.test(text)) return '账户测试 ETH 不足，需保留支付 gas 的余额。';
  if (/fetch|timeout|network|failed to fetch/i.test(text)) return '无法访问本地节点，请确认 Anvil 与网页服务仍在运行，再点击重新连接。';
  return error.message || '操作失败，请重试。';
}

function toast(title, description, type = 'success', hash = null) {
  $('toast').hidden = false;
  $('toast').classList.toggle('error', type === 'error');
  $('toast-icon').textContent = type === 'error' ? '!' : type === 'pending' ? '↻' : '✓';
  $('toast-title').textContent = title;
  $('toast-description').textContent = description;
  state.hash = hash;
  $('copy-transaction').hidden = !hash;
}

function renderAmount() {
  let valid = false;
  $('amount-help').classList.remove('invalid');
  if (!state.quote) {
    $('amount-help').textContent = '报价暂不可用，捐款暂停。余额查询和管理员提现仍可使用。';
  } else {
    try {
      const amount = parseEther($('amount').value);
      const amountUsd = amount * state.quote / WEI;
      $('amount-help').textContent = `约 ${usd(amountUsd)} USD · 最低 ${formatEther(minimumWei(state.minimum, state.quote), 18)} ETH`;
      if (amountUsd < state.minimum) {
        $('amount-help').textContent = `当前约 ${usd(amountUsd)}，尚未达到 ${usd(state.minimum)} 最低门槛`;
        $('amount-help').classList.add('invalid');
      } else valid = true;
    } catch (error) {
      $('amount-help').textContent = error.message;
      $('amount-help').classList.add('invalid');
    }
  }
  $('donate-button').disabled = state.busy || !state.online || (Boolean(state.account) && !valid);
  $('donate-label').textContent = state.busy ? '交易处理中，请稍候…'
    : !state.account ? (state.mode === 'local' ? '连接本地账户，开始支持' : '连接钱包，开始支持')
      : !networkMatches() ? '切换到 Anvil 网络' : '确认捐款';
  document.querySelectorAll('[data-amount]').forEach(button => {
    button.classList.toggle('selected', button.dataset.amount === $('amount').value);
    button.disabled = state.busy;
  });
}

function renderAccount() {
  $('mode-local').classList.toggle('selected', state.mode === 'local');
  $('mode-wallet').classList.toggle('selected', state.mode === 'wallet');
  $('mode-local').setAttribute('aria-pressed', state.mode === 'local');
  $('mode-wallet').setAttribute('aria-pressed', state.mode === 'wallet');
  const localConnected = state.mode === 'local' && Boolean(state.account);
  $('local-account').hidden = !localConnected;
  $('local-account-label').hidden = !localConnected;
  $('local-account').disabled = state.busy;
  $('mode-local').disabled = state.busy;
  $('mode-wallet').disabled = state.busy;
  $('connect-top').disabled = state.busy || !state.online;
  $('connect-label').textContent = state.account ? short(state.account) : state.mode === 'local' ? '连接本地账户' : '连接钱包';
  $('account-title').textContent = state.account ? `${isOwner() ? '管理员' : '捐款人'} · ${short(state.account)}`
    : state.mode === 'local' ? '无需钱包，也能体验链上交互' : '使用你的以太坊钱包连接';
  $('account-description').textContent = state.mode === 'local'
    ? '使用 Anvil 测试账户，交易会真实写入本地链。'
    : state.account && !networkMatches() ? '钱包网络不匹配，请切换到 Anvil（31337）。' : '由钱包确认交易，网页不会读取或保存你的私钥。';
  $('account-role').textContent = !state.account ? '未连接' : isOwner() ? '管理员' : '捐款人';
  $('copy-account').disabled = !state.account;
  $('copy-account').textContent = state.account ? `${short(state.account)} ⧉` : '—';
  $('owner-box').hidden = !isOwner();
  $('withdraw-button').disabled = state.busy || !state.online || state.balance === 0n;
  $('withdraw-button').textContent = state.busy ? '处理中…' : '提取资金 ↗';
  $('wallet-balance').textContent = state.account ? `余额 ${formatEther(state.walletBalance, 4)} ETH` : '账户余额 —';
  renderAmount();
}

function setBusy(value) {
  state.busy = value;
  $('donate-button').classList.toggle('busy', value);
  $('refresh').disabled = value;
  $('amount').disabled = value;
  renderAccount();
}

function renderEvents(logs) {
  const sorted = logs.slice().sort((a, b) => Number(BigInt(b.blockNumber) - BigInt(a.blockNumber)) || Number(BigInt(b.logIndex) - BigInt(a.logIndex)));
  $('activity-count').textContent = String(sorted.length);
  $('activity-body').replaceChildren();
  $('empty-state').hidden = sorted.length > 0;
  for (const log of sorted.slice(0, 8)) {
    const donated = log.topics[0] === selector('Funded(address,uint256,uint256)');
    const address = '0x' + log.topics[1].slice(-40);
    const amount = BigInt('0x' + log.data.slice(2, 66));
    const row = document.createElement('tr');
    const eventCell = document.createElement('td');
    const wrapper = document.createElement('div'); wrapper.className = 'event-cell';
    const icon = document.createElement('span'); icon.className = 'event-icon' + (donated ? '' : ' withdraw'); icon.textContent = donated ? '↙' : '↗';
    const detail = document.createElement('div');
    const title = document.createElement('strong'); title.textContent = donated ? '收到捐款' : '管理员提现';
    const subtitle = document.createElement('small'); subtitle.textContent = short(address);
    detail.append(title, subtitle); wrapper.append(icon, detail); eventCell.append(wrapper);
    const amountCell = document.createElement('td'); amountCell.textContent = `${formatEther(amount)} ETH`;
    const hashCell = document.createElement('td');
    const hashButton = document.createElement('button'); hashButton.className = 'hash-copy'; hashButton.type = 'button'; hashButton.textContent = short(log.transactionHash) + ' ⧉'; hashButton.title = '复制交易哈希';
    hashButton.addEventListener('click', () => copy(log.transactionHash, '交易哈希已复制'));
    hashCell.append(hashButton);
    const statusCell = document.createElement('td');
    const status = document.createElement('span'); status.className = 'event-status'; status.textContent = '✓ 已确认'; statusCell.append(status);
    row.append(eventCell, amountCell, hashCell, statusCell);
    $('activity-body').append(row);
  }
}

async function doRefresh() {
  if (!state.config) return;
  try {
    const [chain, balance, total, withdrawn, minimum, owner] = await Promise.all([
      rpc('eth_chainId'), rpc('eth_getBalance', [state.config.address, 'latest']),
      call('totalRaised()'), call('totalWithdrawn()'), call('MINIMUM_USD()'), call('owner()'),
    ]);
    if (chain !== state.config.chainId) throw new Error('本地节点的链 ID 不匹配，请重新启动项目。');
    if (!owner || owner === '0x') throw new Error('合约不存在。本地链可能已重启，请重新运行启动脚本。');
    state.balance = BigInt(balance); state.minimum = BigInt(minimum);
    state.owner = '0x' + owner.slice(-40);
    state.online = true;
    $('network-dot').className = 'online';
    $('network-label').textContent = 'Anvil · 31337';
    $('connection-error').hidden = true;
    $('pool-balance').textContent = formatEther(balance);
    $('total-raised').textContent = formatEther(total);
    $('minimum-usd').textContent = (Number(state.minimum) / 1e18).toFixed(2);
    try {
      state.quote = BigInt(await call('getUsdValue(uint256)', word(WEI)));
      $('eth-price').textContent = usd(state.quote);
      $('pool-usd').textContent = `约 ${usd(state.balance * state.quote / WEI)} USD`;
      $('minimum-eth').textContent = `约 ${formatEther(minimumWei(state.minimum, state.quote), 10)} ETH`;
      $('quote-status').textContent = '● 报价正常'; $('quote-status').className = 'quote-status good';
    } catch (error) {
      state.quote = null;
      $('eth-price').textContent = '—'; $('pool-usd').textContent = '报价不可用'; $('minimum-eth').textContent = '报价不可用，捐款暂停';
      $('quote-status').textContent = '● 报价异常'; $('quote-status').className = 'quote-status bad';
      $('quote-status').title = explain(error);
    }
    if (state.account) {
      const accountAtRequest = state.account;
      const [contribution, accountBalance] = await Promise.all([
        call('contributions(address)', state.account.slice(2).padStart(64, '0')),
        rpc('eth_getBalance', [state.account, 'latest']),
      ]);
      if (state.account === accountAtRequest) {
        $('my-contribution').textContent = formatEther(contribution);
        state.walletBalance = BigInt(accountBalance);
      }
    } else $('my-contribution').textContent = '—';
    const events = await rpc('eth_getLogs', [{ address: state.config.address, fromBlock: state.config.deploymentBlock, toBlock: 'latest', topics: [[selector('Funded(address,uint256,uint256)'), selector('Withdrawn(address,uint256)')]] }]);
    renderEvents(events);
    $('total-raised').title = `已提现 ${formatEther(withdrawn)} ETH`;
    renderAccount();
  } catch (error) {
    state.online = false;
    $('network-dot').className = '';
    $('network-label').textContent = '节点未连接';
    $('connection-error').hidden = false;
    $('connection-message').textContent = explain(error);
    renderAccount();
  }
}

async function refresh() {
  if (state.refreshPromise) {
    await state.refreshPromise;
    return refresh();
  }
  state.refreshPromise = doRefresh().finally(() => { state.refreshPromise = null; });
  return state.refreshPromise;
}

async function switchWalletNetwork() {
  const provider = window.ethereum;
  if (!provider) throw new Error('未检测到浏览器钱包。请在安装 MetaMask 的浏览器中打开此地址，或选择本地体验。');
  try { await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: state.config.chainId }] }); }
  catch (error) {
    if (error.code !== 4902) throw error;
    await provider.request({ method: 'wallet_addEthereumChain', params: [{ chainId: state.config.chainId, chainName: 'Anvil Local', rpcUrls: [state.config.rpcUrl], nativeCurrency: { name: 'Test Ether', symbol: 'ETH', decimals: 18 } }] });
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: state.config.chainId }] });
  }
  state.walletChain = await provider.request({ method: 'eth_chainId' });
  if (!networkMatches()) throw new Error('请在钱包中切换到 Anvil（31337）。');
}

async function connect() {
  if (!state.online || state.busy) return;
  setBusy(true);
  try {
    if (state.mode === 'local') {
      const chosen = $('local-account').value === 'owner' ? 0 : 1;
      state.account = state.config.accounts[chosen];
      toast('本地账户已连接', '使用 Anvil 解锁账户签署测试交易，可在下拉框切换管理员。');
    } else {
      if (!window.ethereum) throw new Error('未检测到浏览器钱包。请在安装 MetaMask 的浏览器中打开此地址，或选择本地体验。');
      await switchWalletNetwork();
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
      state.account = accounts[0] || null;
      if (!state.account) throw new Error('钱包未返回账户');
      toast('钱包已连接', '当前网络：Anvil 本地测试链。请确保此账户有测试 ETH 支付交易。');
    }
    await refresh();
  } catch (error) { toast('连接未完成', explain(error), 'error'); }
  finally { setBusy(false); }
}

async function sendTransaction(tx, kind) {
  setBusy(true);
  try {
    if (state.mode === 'wallet') {
      state.walletChain = await window.ethereum.request({ method: 'eth_chainId' });
      if (!networkMatches()) await switchWalletNetwork();
      const accounts = await window.ethereum.request({ method: 'eth_accounts' });
      if (!accounts[0] || accounts[0].toLowerCase() !== state.account.toLowerCase()) throw new Error('钱包账户已改变，请重新连接后操作。');
    }
    // Simulate first: surface contract errors before requesting a signature.
    await rpc('eth_call', [tx, 'latest']);
    toast('等待交易确认', state.mode === 'wallet' ? '请在钱包中确认交易，然后等待链上回执。' : '正在向本地 Anvil 测试链发送交易。', 'pending');
    const hash = state.mode === 'local' ? await rpc('eth_sendTransaction', [tx])
      : await window.ethereum.request({ method: 'eth_sendTransaction', params: [tx] });
    toast('交易已提交', '正在等待链上确认，请勿重复提交。', 'pending', hash);
    let receipt;
    for (let attempt = 0; attempt < 120; attempt++) {
      receipt = await rpc('eth_getTransactionReceipt', [hash]);
      if (receipt) break;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    if (!receipt) throw new Error(`暂未收到交易回执，请复制哈希稍后核查，避免重复提交。${hash}`);
    if (receipt.status !== '0x1') throw new Error('交易执行失败，合约状态已回滚，gas 仍可能被消耗。');
    await refresh();
    toast(kind === 'donation' ? '捐款成功，谢谢你的支持' : '提现成功', kind === 'donation' ? '资金已进入募捐合约，链上动态与个人累计金额已更新。' : '合约资金已转至管理员账户，历史捐款记录保留。', 'success', hash);
  } catch (error) { toast('交易未完成', explain(error), 'error', state.hash); }
  finally { setBusy(false); }
}

async function copy(text, message) {
  if (!text) return;
  try { await navigator.clipboard.writeText(text); toast(message, text); }
  catch { toast('请手动复制', text); }
}

$('donate-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (state.busy || !state.online) return;
  if (!state.account) return connect();
  if (!networkMatches()) {
    setBusy(true);
    try { await switchWalletNetwork(); } catch (error) { toast('网络切换失败', explain(error), 'error'); }
    finally { setBusy(false); }
    return;
  }
  try {
    if (!state.quote) throw new Error('报价不可用，暂时无法捐款。');
    const amount = parseEther($('amount').value);
    if (amount * state.quote / WEI < state.minimum) throw new Error('未达到最低 5 美元门槛。');
    if (amount >= state.walletBalance) throw new Error('余额不足，请为 gas 预留一些测试 ETH。');
    state.hash = null;
    await sendTransaction({ from: state.account, to: state.config.address, data: selector('fund()'), value: hex(amount), gas: '0x493e0' }, 'donation');
  } catch (error) { toast('请检查捐款金额', explain(error), 'error'); }
});
$('withdraw-button').addEventListener('click', async () => {
  if (state.busy || !isOwner()) return;
  state.hash = null;
  await sendTransaction({ from: state.account, to: state.config.address, data: selector('withdraw()'), gas: '0x493e0' }, 'withdrawal');
});
$('connect-top').addEventListener('click', connect);
$('amount').addEventListener('input', renderAmount);
document.querySelectorAll('[data-amount]').forEach(button => button.addEventListener('click', () => { $('amount').value = button.dataset.amount; renderAmount(); }));
for (const mode of ['local', 'wallet']) $('mode-' + mode).addEventListener('click', async () => {
  if (state.busy) return;
  state.mode = mode; state.account = null; state.walletChain = null; state.walletBalance = 0n;
  $('toast').hidden = true;
  $('my-contribution').textContent = '—'; renderAccount(); await refresh();
});
$('local-account').addEventListener('change', async () => {
  if (state.mode !== 'local' || state.busy) return;
  state.account = state.config.accounts[$('local-account').value === 'owner' ? 0 : 1];
  state.walletBalance = 0n;
  $('my-contribution').textContent = '—';
  renderAccount(); await refresh();
});
$('refresh').addEventListener('click', () => refresh());
$('retry').addEventListener('click', () => state.config ? refresh() : initialize());
$('copy-account').addEventListener('click', () => copy(state.account, '账户地址已复制'));
$('copy-contract').addEventListener('click', () => copy(state.config?.address, '合约地址已复制'));
$('copy-transaction').addEventListener('click', () => copy(state.hash, '交易哈希已复制'));
$('close-toast').addEventListener('click', () => { $('toast').hidden = true; });
if (window.ethereum?.on) {
  window.ethereum.on('accountsChanged', async accounts => {
    if (state.mode !== 'wallet') return;
    state.account = accounts[0] || null; renderAccount(); await refresh();
  });
  window.ethereum.on('chainChanged', async chain => {
    if (state.mode !== 'wallet') return;
    state.walletChain = chain; renderAccount();
    if (!networkMatches()) toast('钱包网络已改变', '请切换回 Anvil（31337）后继续操作。', 'error');
  });
}

async function initialize() {
  $('connect-top').disabled = true;
  $('donate-button').disabled = true;
  try {
    const response = await fetch('/api/config', { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error('无法读取项目配置，请重新运行启动脚本。');
    state.config = await response.json();
    $('contract-address').textContent = short(state.config.address);
    $('copy-contract').title = state.config.address;
    await refresh();
  } catch (error) {
    $('connection-error').hidden = false; $('connection-message').textContent = explain(error);
    $('network-label').textContent = '连接未完成';
  }
}
await initialize();
setInterval(() => { if (state.online && !state.busy && document.visibilityState === 'visible') refresh(); }, 15000);
