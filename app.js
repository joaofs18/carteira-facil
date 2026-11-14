/* =========================================================
   Carteira Fácil — versão 2 (rede de teste Polygon Amoy)
   - Cada pessoa tem a própria carteira, guardada no celular dela.
   - Ninguém precisa de gás: o celular só ASSINA o pedido e o
     "tanque" da família envia a transação e paga a taxa.
   - A moeda é tBRL (Real Teste), sem valor. 1 tBRL imita R$ 1.
   ========================================================= */
(function(){
'use strict';
const { ethers } = window;
const C = window.CONFIG;
const ABI = window.CONTRATO.abi;
const BYTECODE = window.CONTRATO.bytecode;
const OP = { PAGAR:1, COLOCAR:2, TIRAR:3, CADASTRAR:4 };

/* ---------- parâmetros de teste (só para desenvolvimento local) ---------- */
const params = new URLSearchParams(location.search);
if (params.get('rpc')) { C.rpcs = [params.get('rpc')]; }
if (params.get('chain')) { C.chainId = Number(params.get('chain')); }

/* ---------- armazenamento local ---------- */
const LS = {
  get(k, d=null){ try{ const v=localStorage.getItem('cf2:'+k); return v?JSON.parse(v):d; }catch(e){ return d; } },
  set(k, v){ try{ localStorage.setItem('cf2:'+k, JSON.stringify(v)); }catch(e){} },
  del(k){ try{ localStorage.removeItem('cf2:'+k); }catch(e){} }
};
let fam = LS.get('familia');        // {token, tankKey, organizador:bool}
let eu  = LS.get('eu');             // {frase, endereco, desde}
let cache = LS.get('cache', { membros:{}, historico:[], ultimoBloco:0, blocosData:{} });
function salvarCache(){ LS.set('cache', cache); }

/* ---------- rede ---------- */
let provider = null, token = null, tank = null, carteira = null;
async function conectar(){
  if (provider) return provider;
  for (const url of C.rpcs){
    try{
      const p = new ethers.JsonRpcProvider(url, C.chainId, { staticNetwork: true });
      await Promise.race([p.getBlockNumber(), new Promise((_,r)=>setTimeout(()=>r(new Error('tempo')),8000))]);
      provider = p; return p;
    }catch(e){ console.warn('RPC falhou', url, e.message); }
  }
  throw new Error('Sem internet ou a rede de teste não respondeu.');
}
async function prepararContas(){
  await conectar();
  if (fam && fam.tankKey) tank = new ethers.Wallet(fam.tankKey, provider);
  if (fam && fam.token) token = new ethers.Contract(fam.token, ABI, tank || provider);
  if (eu && eu.frase) carteira = ethers.Wallet.fromPhrase(eu.frase);
}
async function taxas(){
  const gorjeta = ethers.parseUnits(String(C.gorjetaMinGwei), 'gwei');
  let base = 0n;
  try{ const b = await provider.getBlock('latest'); base = b.baseFeePerGas || 0n; }catch(e){}
  let prio = gorjeta;
  try{ const f = await provider.getFeeData(); if (f.maxPriorityFeePerGas && f.maxPriorityFeePerGas > prio) prio = f.maxPriorityFeePerGas; }catch(e){}
  return { maxPriorityFeePerGas: prio, maxFeePerGas: base*2n + prio };
}

/* ---------- pedido assinado + envio pelo tanque ---------- */
async function enviarPedido(op, para, valorReais, nome='', emoji=''){
  if (!token || !tank || !carteira) throw new Error('Carteira não preparada');
  const valor = ethers.parseUnits(Number(valorReais||0).toFixed(2), 18);
  const destino = para || ethers.ZeroAddress;
  for (let tentativa=0; tentativa<4; tentativa++){
    try{
      const nonce = await token.nonces(carteira.address);
      const h = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
        ['address','uint256','uint8','address','address','uint256','uint256','bytes32','bytes32'],
        [fam.token, C.chainId, op, carteira.address, destino, valor, nonce,
         ethers.keccak256(ethers.toUtf8Bytes(nome)), ethers.keccak256(ethers.toUtf8Bytes(emoji))]));
      const sig = await carteira.signMessage(ethers.getBytes(h));
      const tx = await token.relay(op, carteira.address, destino, valor, nome, emoji, sig, await taxas());
      const rec = await tx.wait();
      if (!rec || rec.status !== 1) throw new Error('A transação falhou');
      return rec;
    }catch(e){
      const m = (e.shortMessage || e.message || '').toLowerCase();
      const repetir = m.includes('nonce') || m.includes('replacement') || m.includes('already known') || m.includes('underpriced');
      if (repetir && tentativa < 3){ await espera(1500 + Math.random()*1500); continue; }
      throw traduzErro(e);
    }
  }
}
function traduzErro(e){
  const m = (e.shortMessage || e.reason || e.message || '').toLowerCase();
  if (m.includes('insufficient funds')) return new Error('O gás da família acabou. Avise o organizador.');
  if (m.includes('saldo insuficiente')) return new Error('Saldo insuficiente.');
  if (m.includes('destino nao e da familia')) return new Error('Essa pessoa não é da família no app.');
  if (m.includes('limite')) return new Error('Valor acima do limite de teste (R$ 1.000).');
  if (m.includes('network') || m.includes('fetch') || m.includes('timeout') || m.includes('tempo')) return new Error('Sem conexão. Tente de novo.');
  return new Error('Não deu certo: ' + (e.shortMessage || e.reason || e.message || 'erro').slice(0,120));
}
const espera = ms => new Promise(r=>setTimeout(r,ms));

/* ---------- membros e saldo ---------- */
async function carregarMembros(){
  if (!token) return;
  try{
    const [contas, nomes, emojis] = await token.membros();
    const m = {};
    contas.forEach((a,i)=>{ m[a.toLowerCase()] = { endereco:a, nome:nomes[i], emoji:emojis[i] || '🙂' }; });
    cache.membros = m; salvarCache();
  }catch(e){ console.warn('membros', e.message); }
}
function membro(addr){
  if (!addr) return null;
  const k = addr.toLowerCase();
  return cache.membros[k] || { endereco:addr, nome:'Desconhecido', emoji:'❔' };
}
function corDe(addr){
  const h = parseInt((addr||'0x0').slice(2,8),16) % 360;
  return `hsl(${h} 85% 86%)`;
}
let saldoAtual = null;
async function lerSaldo(){
  if (!token || !carteira) return 0;
  const b = await token.balanceOf(carteira.address);
  return Number(ethers.formatUnits(b, 18));
}

/* ---------- histórico (eventos Transfer) ---------- */
async function blocoData(n){
  if (cache.blocosData[n]) return cache.blocosData[n];
  try{ const b = await provider.getBlock(n); cache.blocosData[n] = b.timestamp*1000; return cache.blocosData[n]; }
  catch(e){ return Date.now(); }
}
let escaneando = null;
async function atualizarHistorico(){
  if (escaneando) return escaneando;
  escaneando = (async()=>{
    if (!token || !carteira) return [];
    const ultimo = await provider.getBlockNumber();
    let de = Math.max(cache.ultimoBloco ? cache.ultimoBloco+1 : (eu.desde || 0), 0);
    if (de > ultimo) return [];
    const eu32 = ethers.zeroPadValue(carteira.address, 32);
    const sig = ethers.id('Transfer(address,address,uint256)');
    const novos = [];
    let passo = 9000;
    while (de <= ultimo){
      const ate = Math.min(de + passo - 1, ultimo);
      try{
        const [saidas, entradas] = await Promise.all([
          provider.getLogs({ address: fam.token, topics:[sig, eu32], fromBlock: de, toBlock: ate }),
          provider.getLogs({ address: fam.token, topics:[sig, null, eu32], fromBlock: de, toBlock: ate })
        ]);
        const vistos = new Set();
        for (const l of [...saidas, ...entradas]){
          const id = l.transactionHash + ':' + l.index;
          if (vistos.has(id)) continue; vistos.add(id);
          const deA = ethers.getAddress(ethers.dataSlice(l.topics[1], 12));
          const paraA = ethers.getAddress(ethers.dataSlice(l.topics[2], 12));
          const valor = Number(ethers.formatUnits(l.data, 18));
          novos.push({ id, hash: l.transactionHash, bloco: l.blockNumber, de: deA, para: paraA, valor });
        }
        cache.ultimoBloco = ate; de = ate + 1;
      }catch(e){
        if (passo > 500){ passo = Math.floor(passo/2); continue; }
        console.warn('logs', e.message); break;
      }
    }
    for (const t of novos) t.quando = await blocoData(t.bloco);
    if (novos.length){
      const ids = new Set(cache.historico.map(t=>t.id));
      cache.historico = [...novos.filter(t=>!ids.has(t.id)), ...cache.historico].sort((a,b)=>b.bloco-a.bloco).slice(0,500);
    }
    salvarCache();
    return novos;
  })();
  try{ return await escaneando; } finally { escaneando = null; }
}

/* ---------- voz, som, aviso ---------- */
function falar(txt){
  try{
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(txt); u.lang='pt-BR'; u.rate=0.95;
    const v = speechSynthesis.getVoices().find(v=>v.lang && v.lang.toLowerCase().startsWith('pt'));
    if (v) u.voice = v;
    speechSynthesis.speak(u);
  }catch(e){}
}
function valorFalado(v){
  const r=Math.floor(v+1e-9), c=Math.round((v-r)*100);
  let s = r>0 ? `${r} ${r===1?'real':'reais'}` : '';
  if (c>0) s += (s?' e ':'') + `${c} ${c===1?'centavo':'centavos'}`;
  return s || 'zero reais';
}
let actx=null;
function moeda(){
  try{
    actx = actx || new (window.AudioContext||window.webkitAudioContext)();
    [1318,1760].forEach((f,i)=>{
      const o=actx.createOscillator(), g=actx.createGain(), t=actx.currentTime+i*0.09;
      o.type='triangle'; o.frequency.value=f;
      g.gain.setValueAtTime(0.0001,t); g.gain.exponentialRampToValueAtTime(0.3,t+0.01); g.gain.exponentialRampToValueAtTime(0.0001,t+0.35);
      o.connect(g).connect(actx.destination); o.start(t); o.stop(t+0.4);
    });
  }catch(e){}
}
function toast(msg){
  const t=document.createElement('div'); t.className='toast'; t.textContent=msg; document.body.appendChild(t);
  setTimeout(()=>t.remove(), 3200);
}

/* ---------- cédulas ---------- */
const NOTES=[{v:200,c:'#9a8c7a'},{v:100,c:'#3a7bc8'},{v:50,c:'#c98a2b'},{v:20,c:'#d9a521'},{v:10,c:'#c0504d'},{v:5,c:'#8064a2'},{v:2,c:'#4f81bd'}];
const COINS=[1,0.5,0.25,0.1,0.05];
function cedulas(v){
  let rest=Math.round(v*100), out='', n=0;
  for (const x of NOTES){ while(rest>=x.v*100 && n<14){ out+=`<div class="note" style="background:${x.c}">R$ ${x.v}</div>`; rest-=x.v*100; n++; } }
  for (const c of COINS){ const cc=Math.round(c*100); while(rest>=cc && n<18){ out+=`<div class="coin">${c>=1?'1':cc+'¢'}</div>`; rest-=cc; n++; } }
  if (rest>0 || n>=14) out+=`<div class="hint" style="width:100%;margin:2px 0">…e mais</div>`;
  return out;
}
const brl = v => Number(v).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const esc = s => String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

/* ---------- navegação ---------- */
const app = document.getElementById('app');
let view = { name:'inicio' };
function go(name, data={}){ pararCamera(); view = { name, ...data }; render(); window.scrollTo(0,0); }
const BANNER = `<div class="test-banner">🧪 REDE DE TESTE — dinheiro sem valor</div>`;
function header(t, voltar='home'){
  return BANNER + `<div class="screen-title"><button class="back" data-go="${voltar}" aria-label="Voltar">⬅️</button><h1>${t}</h1></div>`;
}
function av(addr, cls=''){
  const m = membro(addr);
  return `<div class="avatar ${cls}" style="background:${corDe(addr)}">${esc(m.emoji)}</div>`;
}

const TELAS = {};
function render(){
  if (!fam || !fam.token){
    if (!['boasVindas','criarFamilia','recuperar','entrarConvite'].includes(view.name)) view = { name:'boasVindas' };
  } else if (!eu){
    if (!['cadastro','recuperar'].includes(view.name)) view = { name:'cadastro' };
  } else if (view.name==='inicio' || !TELAS[view.name]) view = { name:'home' };
  app.innerHTML = TELAS[view.name]();
  ligar();
  if (POS[view.name]) POS[view.name]();
}
function ligar(){
  app.querySelectorAll('[data-go]').forEach(b=>b.addEventListener('click',()=>go(b.dataset.go)));
  app.querySelectorAll('[data-act]').forEach(b=>b.addEventListener('click',()=>ACOES[b.dataset.act](b)));
  app.querySelectorAll('[data-key]').forEach(b=>b.addEventListener('click',()=>{
    const k=b.dataset.key;
    if (k==='del') valorStr=valorStr.slice(0,-1); else if (valorStr.length<8) valorStr=(valorStr+k).replace(/^0+/,'');
    atualizarValor();
  }));
  app.querySelectorAll('[data-note]').forEach(b=>b.addEventListener('click',()=>{
    const v=Math.min(valorNum()+parseInt(b.dataset.note,10), 1000);
    valorStr=String(Math.round(v*100)); atualizarValor(); falar(valorFalado(v));
  }));
  app.querySelectorAll('[data-pagar]').forEach(b=>b.addEventListener('click',()=>escolherDestino(b.dataset.pagar)));
  app.querySelectorAll('[data-tx]').forEach(b=>b.addEventListener('click',()=>{ const t=cache.historico.find(x=>x.id===b.dataset.tx); if(t){ go('detalhe',{id:t.id}); falarTx(t);} }));
  app.querySelectorAll('[data-emoji]').forEach(b=>b.addEventListener('click',()=>{
    app.querySelectorAll('[data-emoji]').forEach(x=>x.classList.remove('sel')); b.classList.add('sel'); view.emoji=b.dataset.emoji;
  }));
  app.querySelectorAll('[data-qr]').forEach(el=>{
    try{ new QRCode(el,{ text: el.dataset.qr, width:240, height:240, correctLevel: QRCode.CorrectLevel.M }); }
    catch(e){ el.innerHTML='<div class="hint">(QR indisponível)</div>'; }
  });
  app.querySelectorAll('[data-copiar]').forEach(b=>b.addEventListener('click',async()=>{
    try{ await navigator.clipboard.writeText(b.dataset.copiar); toast('Copiado ✅'); }catch(e){ toast('Não consegui copiar'); }
  }));
}

/* ---------- valor (teclado + notas) ---------- */
let valorStr='';
const valorNum = () => valorStr ? parseInt(valorStr,10)/100 : 0;
function valorUI(pergunta){
  const np = v => { const n=NOTES.find(n=>n.v===v); return `<button class="note-pick" style="background:${n.c}" data-note="${v}">R$ ${v}</button>`; };
  return `<div class="amount-box"><div class="hint" style="margin:0">${pergunta}</div><div class="val" id="amt">${brl(valorNum())}</div>
    <div class="notes" id="amtNotes">${cedulas(valorNum())}</div></div>
  <div class="hint">Toque nas notas para somar</div>
  <div class="note-picker">${[100,50,20,10,5,2].map(np).join('')}
    <button class="note-pick" style="background:#d9a520;color:#5a4300" data-note="1">R$ 1</button>
    <button class="note-pick" style="background:#555" data-act="limpar">Apagar</button></div>
  <div class="hint">ou digite</div>
  <div class="keypad">${[1,2,3,4,5,6,7,8,9].map(n=>`<button class="key" data-key="${n}">${n}</button>`).join('')}
    <button class="key" data-key="00">00</button><button class="key" data-key="0">0</button><button class="key" data-key="del">⌫</button></div>`;
}
function atualizarValor(){
  const a=document.getElementById('amt'); if(a) a.textContent=brl(valorNum());
  const n=document.getElementById('amtNotes'); if(n) n.innerHTML=cedulas(valorNum());
}

/* =========================================================
   TELAS
   ========================================================= */
TELAS.boasVindas = () => BANNER + `
  <div class="center" style="margin:20px 0 10px"><img src="icone.svg" width="96" height="96" alt=""></div>
  <h1 class="center" style="font-size:30px;margin:0 0 6px">Carteira Fácil</h1>
  <p class="hint">Pagar e receber em reais, de um jeito fácil.</p>
  <div class="card"><h2>📩 Recebeu um convite?</h2><p>Abra o link ou leia o QR que o organizador da família te mandou, com a câmera do celular.</p>
    <button class="btn-sec" data-act="lerConvite">📷 Ler QR do convite</button></div>
  <div class="card"><h2>👑 Organizar uma família</h2><p>Para quem vai criar a carteira da família e convidar os outros.</p>
    <button class="wide b-blue" data-go="criarFamilia">Criar família</button></div>
  <button class="small-link" data-go="recuperar">Já tinha carteira? Recuperar</button>`;

TELAS.entrarConvite = () => header('Ler convite','boasVindas') + `
  <video class="cam" id="cam" playsinline muted></video>
  <p class="hint">Aponte para o QR do convite</p>`;

TELAS.criarFamilia = () => {
  const t = LS.get('tanqueNovo');
  return header('Criar família','boasVindas') + `
  <div class="card"><h2>⛽ Passo 1: gás da família</h2>
    <p>A família precisa de um pouco de <b>POL de teste</b> (grátis) para pagar as taxas da rede. Os parentes nunca vão precisar disso: o app paga por eles.</p>
    <div class="step"><div class="n">1</div><div>Copie o endereço abaixo</div></div>
    <div class="qr-wrap" style="padding:12px"><div data-qr="${t.endereco}"></div>
      <div class="addr" style="font-size:13px">${t.endereco}</div>
      <button class="btn-sec" data-copiar="${t.endereco}">📋 Copiar endereço</button></div>
    <div class="step"><div class="n">2</div><div>Peça POL de teste em um destes sites (cole o endereço):<br>
      ${C.faucets.map(f=>`<a class="link" href="${f.url}" target="_blank" rel="noopener">${f.nome}</a>`).join(' · ')}</div></div>
    <div class="step"><div class="n">3</div><div>Espere aparecer aqui:</div></div>
    <div class="center" style="font-size:28px;font-weight:900" id="gasNovo">… POL</div>
  </div>
  <div class="card"><h2>🪙 Passo 2: criar a moeda da família</h2>
    <p>Depois que o gás chegar, toque abaixo. Leva alguns segundos.</p>
    <button class="wide b-green" id="btnCriar" data-act="criarMoeda" disabled>Criar moeda da família</button>
    <div id="criando"></div></div>`;
};

TELAS.cadastro = () => {
  const EMOJIS=['🙂','👩🏽','👨🏽','👵🏻','👴🏿','👩🏾','👨🏻','🧑🏼','👧🏽','👦🏿','🥖','🍢','🧹','🛠️','🛒','🐶','🌻','⚽','🏠','❤️'];
  view.emoji = view.emoji || EMOJIS[0];
  return BANNER + `<h1 style="font-size:28px;margin:6px 0">Quem é você?</h1>
  <p class="hint" style="text-align:left">Escreva seu nome (ou peça ajuda) e escolha uma figura.</p>
  <input class="inp" id="nome" maxlength="30" placeholder="Seu nome" value="${esc(view.nomeDigitado||'')}" autocomplete="off">
  <div class="emoji-grid">${EMOJIS.map(e=>`<button class="emoji-opt ${e===view.emoji?'sel':''}" data-emoji="${e}">${e}</button>`).join('')}</div>
  <button class="wide b-green" data-act="cadastrar" id="btnCad">Pronto ✅</button>
  <div id="cadMsg"></div>`;
};

TELAS.recuperar = () => header('Recuperar', fam&&fam.token?'cadastro':'boasVindas') + `
  <div class="card"><p>Para recuperar, você precisa do <b>link de convite</b> da família e das <b>12 palavras</b> da sua cópia de segurança.</p></div>
  <input class="inp" id="recConvite" placeholder="Link do convite" style="font-size:16px" value="${fam&&fam.token?'(já tem)':''}" ${fam&&fam.token?'disabled':''}>
  <p></p>
  <textarea class="inp" id="recFrase" placeholder="As 12 palavras, separadas por espaço"></textarea>
  <button class="wide b-blue" data-act="recuperar">Recuperar</button>`;

TELAS.home = () => {
  const m = membro(carteira.address);
  return BANNER + `
  <div class="top">
    <button class="me" data-go="mais">${av(carteira.address)}<b>${esc(m.nome)}</b></button>
    <button class="icon-btn" data-go="extrato" aria-label="Extrato">📜</button>
  </div>
  <div class="balance">
    <div class="lbl">Seu dinheiro</div>
    <div class="val" id="saldo">${saldoAtual===null?'…':brl(saldoAtual)}</div>
    <div class="notes" id="saldoNotas">${saldoAtual? cedulas(saldoAtual) : '<span class="hint">'+(saldoAtual===0?'Sem dinheiro ainda':'Carregando…')+'</span>'}</div>
    <button class="speak" data-act="ouvirSaldo">🔊 Ouvir</button>
  </div>
  <div class="grid4">
    <button class="big-btn b-green" data-act="irColocar"><span class="ico">📥</span>Colocar<br>dinheiro</button>
    <button class="big-btn b-red" data-act="irPagar"><span class="ico">📤</span>Pagar</button>
    <button class="big-btn b-blue" data-act="irReceber"><span class="ico">🔳</span>Receber</button>
    <button class="big-btn b-yellow" data-act="irTirar"><span class="ico">🏦</span>Tirar pro<br>banco</button>
  </div>
  <button class="history-btn" data-go="extrato">📜 Ver o que entrou e saiu</button>
  <div class="gas" id="gasInfo"></div>`;
};

TELAS.colocar = () => header('Colocar dinheiro') + valorUI('Quanto você quer colocar?') +
  `<button class="wide b-green" data-act="colocarSeguir">Continuar ✅</button>`;
TELAS.colocarPix = () => header('Colocar dinheiro','colocar') + `
  <div class="pix-fake"><div class="hint" style="margin-top:0">No app de verdade, aqui aparece o <b>Pix</b> para pagar pelo seu banco. No teste, o dinheiro é criado na hora.</div>
    <div style="font-size:40px;font-weight:900;margin:10px 0">${brl(view.valor)}</div>
    <div class="notes">${cedulas(view.valor)}</div></div>
  <button class="wide b-green" data-act="colocarConfirmar">🧪 Simular: já paguei</button>`;

TELAS.pagar = () => {
  const outros = Object.values(cache.membros).filter(p=>p.endereco.toLowerCase()!==carteira.address.toLowerCase());
  return header('Pagar') + `
  <button class="file-btn" data-act="abrirCamera" style="width:100%">📷 Ler QR de quem vai receber</button>
  <video class="cam" id="cam" playsinline muted style="display:none;margin-bottom:12px"></video>
  <div class="hint">ou toque na foto da pessoa</div>
  <div class="people">${outros.length? outros.map(p=>`<button class="person" data-pagar="${p.endereco}">${av(p.endereco,'big')}${esc(p.nome)}</button>`).join('')
     : '<p class="hint" style="grid-column:1/-1">Ainda não tem mais ninguém na família. Use “Convidar” no menu.</p>'}</div>`;
};
TELAS.pagarValor = () => header('Pagar','pagar') + `<div class="center" style="margin-bottom:10px"><div style="display:flex;justify-content:center">${av(view.para,'big')}</div><b style="font-size:22px">${esc(membro(view.para).nome)}</b></div>` +
  valorUI('Quanto vai pagar?') + `<button class="wide b-red" data-act="pagarSeguir">Continuar ➡️</button>`;
TELAS.pagarConfirmar = () => header('Confirmar','pagarValor') + `
  <div class="confirm-card">
    <div style="display:flex;justify-content:center">${av(carteira.address,'big')}</div>
    <div class="arrow">⬇️</div><div class="val">${brl(view.valor)}</div><div class="notes">${cedulas(view.valor)}</div><div class="arrow">⬇️</div>
    <div style="display:flex;justify-content:center">${av(view.para,'xl')}</div>
    <div style="font-size:24px;font-weight:900;margin-top:6px">${esc(membro(view.para).nome)}</div>
  </div>
  <div class="confirm-row"><button class="no" data-go="home">✖<small>Não</small></button>
    <button class="yes" data-act="pagarConfirmar">✔<small>Sim, pagar</small></button></div>`;

TELAS.receber = () => header('Receber') + `
  <div class="qr-wrap">
    ${av(carteira.address,'big')}
    <div style="font-size:22px;font-weight:900">${esc(membro(carteira.address).nome)}</div>
    <div data-qr="cfam:${carteira.address}"></div>
    <div class="hint" style="margin:0">Mostre este código para quem vai te pagar</div>
    <div class="addr">${carteira.address}</div>
  </div>
  <button class="speak" style="margin:14px auto 0;display:flex" data-act="ouvirReceber">🔊 Ouvir instrução</button>`;

TELAS.tirar = () => header('Tirar pro banco') + valorUI('Quanto quer mandar pro seu banco?') +
  `<button class="wide b-yellow" data-act="tirarSeguir">Continuar ➡️</button>`;
TELAS.tirarConfirmar = () => header('Confirmar','tirar') + `
  <div class="confirm-card">
    <div style="display:flex;justify-content:center">${av(carteira.address,'big')}</div>
    <div class="arrow">⬇️</div><div class="val">${brl(view.valor)}</div><div class="notes">${cedulas(view.valor)}</div><div class="arrow">⬇️</div>
    <div style="font-size:80px">🏦</div><div style="font-size:22px;font-weight:900">Sua conta no banco</div>
    <div class="hint">No teste, o dinheiro só some da carteira. No app de verdade, vai por Pix para a sua conta.</div>
  </div>
  <div class="confirm-row"><button class="no" data-go="home">✖<small>Não</small></button>
    <button class="yes" data-act="tirarConfirmar">✔<small>Sim, tirar</small></button></div>`;

TELAS.enviando = () => BANNER + `<div class="success"><div class="spin"></div><h2>${esc(view.texto||'Enviando…')}</h2><p class="hint">Gravando na blockchain de teste. Leva alguns segundos.</p></div>`;

TELAS.sucesso = () => {
  const mapa = { pagar:{c:'var(--green)',t:'Pago!',s:`para ${esc(membro(view.para)?.nome||'')}`},
                 colocar:{c:'var(--green)',t:'Dinheiro colocado!',s:''},
                 tirar:{c:'var(--yellow)',t:'Enviado pro banco!',s:''} }[view.tipo];
  return BANNER + `<div class="success">
    <div class="tick" style="background:${mapa.c}">✔</div><h2>${mapa.t}</h2>
    <div class="val">${brl(view.valor)}</div><div style="font-size:20px;font-weight:800">${mapa.s}</div>
    <div class="chain">⛓️ Gravado na blockchain de teste<br><a class="link" href="${C.explorer}/tx/${view.hash}" target="_blank" rel="noopener"><code>${view.hash}</code></a></div>
    <button class="wide b-blue" data-go="home">🏠 Voltar ao início</button></div>`;
};

TELAS.erro = () => BANNER + `<div class="success">
  <div class="tick" style="background:var(--red)">!</div><h2>Não deu certo</h2>
  <p class="err">${esc(view.msg)}</p>
  <button class="wide b-blue" data-go="home">🏠 Voltar ao início</button></div>`;

function linhaTx(t){
  const me = carteira.address.toLowerCase();
  const Z = ethers.ZeroAddress.toLowerCase();
  let quem, nome, sinal, cls;
  if (t.de.toLowerCase()===Z){ quem=null; nome='Você colocou'; sinal='+'; cls='in'; }
  else if (t.para.toLowerCase()===Z){ quem=null; nome='Mandou pro banco'; sinal='−'; cls='out'; }
  else if (t.para.toLowerCase()===me){ quem=t.de; nome=membro(t.de).nome; sinal='+'; cls='in'; }
  else { quem=t.para; nome=membro(t.para).nome; sinal='−'; cls='out'; }
  const d = new Date(t.quando||Date.now());
  const avatar = quem ? av(quem) : `<div class="avatar" style="background:#eee">🏦</div>`;
  return `<button class="tx" data-tx="${t.id}">${avatar}
    <div class="info"><div class="who">${esc(nome)}</div><div class="when">${d.toLocaleDateString('pt-BR')} ${d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</div></div>
    <div class="amt ${cls}">${sinal} ${brl(t.valor)}</div><div class="dir">${cls==='in'?'🟢':'🔴'}</div></button>`;
}
TELAS.extrato = () => header('Entrou e saiu') +
  `<div class="hint" style="text-align:left">🟢 entrou &nbsp;&nbsp; 🔴 saiu &nbsp;&nbsp; Toque para ouvir</div>
   <div id="lista">${cache.historico.length ? cache.historico.map(linhaTx).join('') : '<div class="hint" style="margin-top:30px">Carregando…</div>'}</div>`;
TELAS.detalhe = () => {
  const t = cache.historico.find(x=>x.id===view.id);
  return header('Detalhe','extrato') + `<div class="confirm-card">${linhaTx(t).replace('<button','<div').replace(/<\/button>$/,'</div>')}
    <div class="chain" style="margin-top:10px">⛓️ Registro na blockchain de teste<br><a class="link" href="${C.explorer}/tx/${t.hash}" target="_blank" rel="noopener"><code>${t.hash}</code></a></div></div>
    <button class="speak" style="margin:14px auto 0;display:flex" data-act="ouvirTx">🔊 Ouvir</button>`;
};

TELAS.mais = () => header('Mais opções') + `
  <button class="menu-item" data-go="convidar"><span>👪</span>Convidar alguém da família</button>
  <button class="menu-item" data-go="backup"><span>🔐</span>Cópia de segurança</button>
  <button class="menu-item" data-go="gas"><span>⛽</span>Gás da família</button>
  <button class="menu-item" data-act="sair"><span>🚪</span>Sair deste celular</button>
  <p class="hint">Rede: ${C.nomeRede}</p>`;

function linkConvite(){
  const dados = btoa(JSON.stringify({ t: fam.token, k: fam.tankKey })).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  return location.origin + location.pathname + '#convite=' + dados;
}
TELAS.convidar = () => header('Convidar','mais') + `
  <div class="qr-wrap"><div data-qr="${linkConvite()}"></div>
    <div class="hint" style="margin:0">A pessoa aponta a câmera do celular dela para este QR</div></div>
  <button class="btn-sec" data-copiar="${linkConvite()}">📋 Copiar link do convite</button>
  ${navigator.share ? `<button class="btn-sec" data-act="compartilhar">📤 Mandar pelo WhatsApp</button>`:''}
  <div class="card" style="margin-top:14px"><p>⚠️ Mande o convite só para quem é da família. Quem tiver o link entra na família e usa o gás dela.</p></div>`;

TELAS.backup = () => {
  const palavras = eu.frase.split(' ');
  return header('Cópia de segurança','mais') + `
  <div class="card"><p>Se você perder ou trocar de celular, só consegue o dinheiro de volta com estas <b>12 palavras</b>. Guarde num papel, ou peça para alguém de confiança guardar. <b>Nunca mande para estranhos.</b></p></div>
  ${view.mostrar ? `<div class="words">${palavras.map((w,i)=>`<span>${i+1}. ${w}</span>`).join('')}</div>
     <button class="btn-sec" data-copiar="${eu.frase}">📋 Copiar palavras</button>`
   : `<button class="wide b-blue" data-act="mostrarFrase">Mostrar as palavras</button>`}`;
};

TELAS.gas = () => header('Gás da família','mais') + `
  <div class="card"><h2>⛽ Tanque</h2>
    <p>É daqui que sai a taxa de cada pagamento. Ninguém da família precisa ter POL.</p>
    <div class="center" style="font-size:30px;font-weight:900" id="gasTanque">…</div>
    <div class="center hint" id="gasPagamentos"></div></div>
  <div class="card"><h2>Recarregar (grátis, rede de teste)</h2>
    <div class="qr-wrap" style="padding:12px"><div data-qr="${tank.address}"></div><div class="addr">${tank.address}</div>
    <button class="btn-sec" data-copiar="${tank.address}">📋 Copiar endereço</button></div>
    <p>Cole em: ${C.faucets.map(f=>`<a class="link" href="${f.url}" target="_blank" rel="noopener">${f.nome}</a>`).join(' · ')}</p></div>`;

/* ---------- ações pós-render ---------- */
const POS = {};
POS.home = () => { atualizarHome(); };
POS.criarFamilia = () => { vigiarGasNovo(); };
POS.entrarConvite = () => { abrirCamera(lerQRConvite); };
POS.extrato = async () => {
  try{ await atualizarHistorico(); if (view.name==='extrato'){ const l=document.getElementById('lista'); if(l) l.innerHTML = cache.historico.length? cache.historico.map(linhaTx).join('') : '<div class="hint" style="margin-top:30px">Nada ainda</div>'; ligar(); } }
  catch(e){ toast('Sem conexão'); }
};
POS.gas = async () => {
  try{
    const b = await provider.getBalance(tank.address), f = await taxas();
    const pol = Number(ethers.formatEther(b));
    const custo = Number(ethers.formatEther(70000n * f.maxFeePerGas));
    document.getElementById('gasTanque').textContent = pol.toFixed(4) + ' POL';
    document.getElementById('gasPagamentos').textContent = custo>0 ? `Dá para uns ${Math.floor(pol/custo)} pagamentos` : '';
  }catch(e){}
};

async function atualizarHome(){
  try{
    const s = await lerSaldo();
    saldoAtual = s;
    if (view.name!=='home') return;
    document.getElementById('saldo').textContent = brl(s);
    document.getElementById('saldoNotas').innerHTML = s>0 ? cedulas(s) : '<span class="hint">Sem dinheiro ainda</span>';
    const b = await provider.getBalance(tank.address);
    const pol = Number(ethers.formatEther(b));
    const g = document.getElementById('gasInfo');
    if (g){ g.textContent = `⛽ Gás da família: ${pol.toFixed(3)} POL`; g.classList.toggle('low', pol < C.avisoGasPOL); }
  }catch(e){ console.warn(e); }
}

/* ---------- câmera ---------- */
let streamCam = null, loopCam = null;
async function abrirCamera(aoLer){
  const v = document.getElementById('cam'); if (!v) return;
  v.style.display='block';
  try{
    streamCam = await navigator.mediaDevices.getUserMedia({ video:{ facingMode:'environment' }, audio:false });
    v.srcObject = streamCam; await v.play();
    const c = document.createElement('canvas'), ctx = c.getContext('2d', { willReadFrequently:true });
    const tick = () => {
      if (!streamCam) return;
      if (v.readyState >= 2){
        const w = 480, h = Math.round(480 * v.videoHeight / v.videoWidth) || 480;
        c.width=w; c.height=h; ctx.drawImage(v,0,0,w,h);
        const code = jsQR(ctx.getImageData(0,0,w,h).data, w, h, { inversionAttempts:'dontInvert' });
        if (code && code.data){ if (aoLer(code.data) !== false) { pararCamera(); return; } }
      }
      loopCam = setTimeout(tick, 200);
    };
    tick();
  }catch(e){
    v.style.display='none';
    toast('Não consegui abrir a câmera');
    falar('Não consegui abrir a câmera. Toque na foto da pessoa.');
  }
}
function pararCamera(){
  if (loopCam) clearTimeout(loopCam); loopCam=null;
  if (streamCam){ streamCam.getTracks().forEach(t=>t.stop()); streamCam=null; }
}
function lerQRPagamento(txt){
  let addr = txt.startsWith('cfam:') ? txt.slice(5) : txt;
  if (!ethers.isAddress(addr)){ toast('Esse código não é da Carteira Fácil'); return false; }
  addr = ethers.getAddress(addr);
  if (!cache.membros[addr.toLowerCase()]){ toast('Essa pessoa ainda não é da família'); falar('Essa pessoa ainda não é da família no app'); return false; }
  if (addr.toLowerCase()===carteira.address.toLowerCase()){ toast('Esse é o seu próprio código'); return false; }
  escolherDestino(addr); return true;
}
function lerQRConvite(txt){
  const i = txt.indexOf('#convite=');
  if (i<0){ toast('Esse QR não é um convite'); return false; }
  location.hash = txt.slice(i);
  aplicarConviteDaURL();
  return true;
}
function escolherDestino(addr){
  valorStr=''; falar('Pagar para '+membro(addr).nome+'. Quanto?'); go('pagarValor',{ para: addr });
}

/* ---------- convite pela URL ---------- */
function aplicarConviteDaURL(){
  const m = location.hash.match(/#convite=([A-Za-z0-9_-]+)/);
  if (!m) return false;
  try{
    const b64 = m[1].replace(/-/g,'+').replace(/_/g,'/');
    const d = JSON.parse(atob(b64 + '==='.slice((b64.length+3)%4)));
    if (!ethers.isAddress(d.t) || !d.k) throw new Error('convite');
    if (fam && fam.token && fam.token.toLowerCase()!==d.t.toLowerCase() && eu){
      toast('Este celular já é de outra família'); history.replaceState(null,'',location.pathname+location.search); return false;
    }
    fam = { token: ethers.getAddress(d.t), tankKey: d.k, organizador: fam?.organizador || false };
    LS.set('familia', fam);
    history.replaceState(null,'',location.pathname+location.search);
    provider=null; token=null; tank=null;
    prepararContas().then(()=>carregarMembros()).then(()=>{ if (view.name!=='cadastro') render(); }).catch(e=>toast(e.message));
    return true;
  }catch(e){ toast('Convite inválido'); return false; }
}

/* ---------- vigiar gás para criar família ---------- */
let vigiaGas=null;
async function vigiarGasNovo(){
  clearTimeout(vigiaGas);
  if (view.name!=='criarFamilia') return;
  try{
    await conectar();
    const t = LS.get('tanqueNovo');
    const b = Number(ethers.formatEther(await provider.getBalance(t.endereco)));
    const el = document.getElementById('gasNovo'); if (el) el.textContent = b.toFixed(4) + ' POL';
    const btn = document.getElementById('btnCriar'); if (btn) btn.disabled = b < 0.05;
  }catch(e){ const el=document.getElementById('gasNovo'); if(el) el.textContent='sem conexão…'; }
  vigiaGas = setTimeout(vigiarGasNovo, 5000);
}

/* ---------- ações ---------- */
const ACOES = {
  limpar(){ valorStr=''; atualizarValor(); },
  lerConvite(){ go('entrarConvite'); },
  abrirCamera(){ abrirCamera(lerQRPagamento); },
  ouvirSaldo(){ falar('Você tem ' + valorFalado(saldoAtual||0)); },
  ouvirReceber(){ falar('Mostre este código para quem vai te pagar. Quando o dinheiro chegar, você vai ouvir um aviso.'); },
  ouvirTx(){ const t=cache.historico.find(x=>x.id===view.id); if(t) falarTx(t); },
  irColocar(){ valorStr=''; falar('Quanto você quer colocar?'); go('colocar'); },
  irPagar(){ falar('Para quem você vai pagar?'); carregarMembros().then(()=>{ if(view.name==='pagar') render(); }); go('pagar'); },
  irReceber(){ falar('Mostre este código para quem vai te pagar'); go('receber'); },
  irTirar(){ valorStr=''; falar('Quanto quer mandar para o seu banco?'); go('tirar'); },
  colocarSeguir(){
    const v=valorNum(); if(v<=0) return avisar('Escolha um valor');
    if (v>1000) return avisar('No teste, o máximo é mil reais por vez');
    falar('Valor: '+valorFalado(v)); go('colocarPix',{ valor:v });
  },
  async colocarConfirmar(){ await executar('colocar', OP.COLOCAR, null, view.valor, 'Colocando dinheiro…'); },
  pagarSeguir(){
    const v=valorNum(); if(v<=0) return avisar('Escolha um valor');
    if (saldoAtual!==null && v>saldoAtual+1e-9) return avisar('Você não tem dinheiro suficiente. Você tem '+valorFalado(saldoAtual));
    const primeira = !cache.historico.some(t=>t.de.toLowerCase()===carteira.address.toLowerCase() && t.para.toLowerCase()===view.para.toLowerCase());
    falar(`Você vai pagar ${valorFalado(v)} para ${membro(view.para).nome}. ${primeira?'É a primeira vez que você paga essa pessoa. ':''}Confirma? Toque no verde para sim, ou no vermelho para não.`);
    go('pagarConfirmar',{ para:view.para, valor:v });
  },
  async pagarConfirmar(){ await executar('pagar', OP.PAGAR, view.para, view.valor, 'Pagando…'); },
  tirarSeguir(){
    const v=valorNum(); if(v<=0) return avisar('Escolha um valor');
    if (saldoAtual!==null && v>saldoAtual+1e-9) return avisar('Você não tem dinheiro suficiente. Você tem '+valorFalado(saldoAtual));
    falar(`Mandar ${valorFalado(v)} para o seu banco? Toque no verde para sim.`); go('tirarConfirmar',{ valor:v });
  },
  async tirarConfirmar(){ await executar('tirar', OP.TIRAR, null, view.valor, 'Enviando pro banco…'); },
  async criarMoeda(b){
    b.disabled = true;
    const box = document.getElementById('criando');
    box.innerHTML = '<div class="spin"></div><p class="hint">Criando a moeda na blockchain de teste…</p>';
    try{
      await conectar();
      const t = LS.get('tanqueNovo');
      const w = new ethers.Wallet(t.chave, provider);
      const f = new ethers.ContractFactory(ABI, BYTECODE, w);
      const c = await f.deploy(await taxas());
      await c.waitForDeployment();
      fam = { token: await c.getAddress(), tankKey: t.chave, organizador: true };
      LS.set('familia', fam); LS.del('tanqueNovo');
      provider=null; await prepararContas();
      moeda(); falar('Família criada! Agora diga quem é você.');
      go('cadastro');
    }catch(e){
      box.innerHTML = `<p class="err">${esc(traduzErro(e).message)}</p>`; b.disabled=false;
    }
  },
  async cadastrar(b){
    const nome = (document.getElementById('nome').value||'').trim();
    if (!nome) return avisar('Escreva seu nome');
    view.nomeDigitado = nome;
    b.disabled = true;
    const msg = document.getElementById('cadMsg');
    msg.innerHTML = '<div class="spin"></div><p class="hint">Criando sua carteira…</p>';
    try{
      await prepararContas();
      let frase = view.fraseRecuperada || (LS.get('fraseNova'));
      if (!frase){ frase = ethers.Wallet.createRandom().mnemonic.phrase; LS.set('fraseNova', frase); }
      carteira = ethers.Wallet.fromPhrase(frase);
      const desde = await provider.getBlockNumber();
      await enviarPedido(OP.CADASTRAR, null, 0, nome, view.emoji || '🙂');
      eu = { frase, endereco: carteira.address, desde: Math.max(0, desde-5) };
      LS.set('eu', eu); LS.del('fraseNova');
      cache = { membros:{}, historico:[], ultimoBloco:0, blocosData:{} }; salvarCache();
      await carregarMembros();
      saldoAtual = ultimoSaldoVisto = await lerSaldo().catch(()=>0);
      moeda(); falar('Pronto, '+nome+'! Sua carteira está criada.');
      iniciarVigia();
      go('home');
    }catch(e){
      console.warn('cadastro', e);
      const box = document.getElementById('cadMsg'); if (box) box.innerHTML = `<p class="err">${esc(e.message)}</p>`;
      const bt = document.getElementById('btnCad'); if (bt) bt.disabled=false;
    }
  },
  async recuperar(){
    const conv = document.getElementById('recConvite');
    const frase = (document.getElementById('recFrase').value||'').trim().toLowerCase().replace(/\s+/g,' ');
    if (conv && !conv.disabled){
      const v = conv.value.trim(); const i = v.indexOf('#convite=');
      if (i<0) return avisar('Cole o link do convite');
      location.hash = v.slice(i); if (!aplicarConviteDaURL()) return;
    }
    let w; try{ w = ethers.Wallet.fromPhrase(frase); }catch(e){ return avisar('As palavras não estão certas'); }
    try{
      await prepararContas(); await carregarMembros();
      const m = cache.membros[w.address.toLowerCase()];
      if (!m){ view.fraseRecuperada = frase; toast('Carteira encontrada. Agora diga seu nome.'); go('cadastro',{ fraseRecuperada: frase }); return; }
      eu = { frase, endereco: w.address, desde: 0 }; LS.set('eu', eu);
      cache.ultimoBloco = 0; cache.historico = []; salvarCache();
      carteira = w; saldoAtual = ultimoSaldoVisto = await lerSaldo().catch(()=>0); iniciarVigia(); falar('Carteira recuperada'); go('home');
    }catch(e){ avisar(e.message); }
  },
  mostrarFrase(){ view.mostrar = true; render(); },
  async compartilhar(){ try{ await navigator.share({ title:'Carteira Fácil', text:'Entre na nossa Carteira Fácil:', url: linkConvite() }); }catch(e){} },
  sair(){
    const ok = view.confirmarSair;
    if (!ok){ view.confirmarSair = true; toast('Faça a cópia de segurança antes! Toque de novo em “Sair” para confirmar.'); return; }
    LS.del('eu'); LS.del('cache'); eu=null; carteira=null; cache={ membros:{}, historico:[], ultimoBloco:0, blocosData:{} };
    go('cadastro');
  }
};
function avisar(t){ falar(t); toast(t); }

async function executar(tipo, op, para, valor, texto){
  go('enviando',{ texto });
  try{
    const rec = await enviarPedido(op, para, valor);
    moeda();
    if (tipo==='pagar') falar(`Pago! ${valorFalado(valor)} para ${membro(para).nome}`);
    else if (tipo==='colocar') falar('Pronto! Entrou ' + valorFalado(valor));
    else falar(`Pronto! ${valorFalado(valor)} enviados para o seu banco`);
    saldoAtual = await lerSaldo().catch(()=>saldoAtual);
    ultimoSaldoVisto = saldoAtual;
    atualizarHistorico().catch(()=>{});
    go('sucesso',{ tipo, para, valor, hash: rec.hash });
  }catch(e){
    falar(e.message); go('erro',{ msg: e.message });
  }
}
function falarTx(t){
  const me=carteira.address.toLowerCase(), Z=ethers.ZeroAddress.toLowerCase();
  const d = new Date(t.quando||Date.now()).toLocaleDateString('pt-BR',{ day:'numeric', month:'long' });
  let s;
  if (t.de.toLowerCase()===Z) s=`Você colocou ${valorFalado(t.valor)}`;
  else if (t.para.toLowerCase()===Z) s=`Você mandou ${valorFalado(t.valor)} para o banco`;
  else if (t.para.toLowerCase()===me) s=`${membro(t.de).nome} te pagou ${valorFalado(t.valor)}`;
  else s=`Você pagou ${valorFalado(t.valor)} para ${membro(t.para).nome}`;
  falar(s+', no dia '+d);
}

/* ---------- aviso de dinheiro recebido ---------- */
let ultimoSaldoVisto = null, vigia = null;
function iniciarVigia(){
  clearInterval(vigia);
  vigia = setInterval(async ()=>{
    if (!token || !carteira || document.hidden) return;
    try{
      const s = await lerSaldo();
      if (ultimoSaldoVisto!==null && s > ultimoSaldoVisto + 1e-9 && view.name!=='enviando'){
        const novos = await atualizarHistorico();
        const entrada = novos.find(t=>t.para.toLowerCase()===carteira.address.toLowerCase() && t.de!==ethers.ZeroAddress);
        if (entrada){
          if (!cache.membros[entrada.de.toLowerCase()]) await carregarMembros();
          moeda(); falar(`Você recebeu ${valorFalado(entrada.valor)} de ${membro(entrada.de).nome}`);
          toast(`💰 Recebeu ${brl(entrada.valor)} de ${membro(entrada.de).nome}`);
        }
      }
      ultimoSaldoVisto = s; saldoAtual = s;
      if (view.name==='home'){ const el=document.getElementById('saldo'); if(el){ el.textContent=brl(s); document.getElementById('saldoNotas').innerHTML = s>0?cedulas(s):'<span class="hint">Sem dinheiro ainda</span>'; } }
    }catch(e){}
  }, 6000);
}

/* ---------- início ---------- */
async function iniciar(){
  try{ speechSynthesis.getVoices(); }catch(e){}
  if (!LS.get('tanqueNovo')){ const w = ethers.Wallet.createRandom(); LS.set('tanqueNovo', { chave: w.privateKey, endereco: w.address }); }
  const temConvite = aplicarConviteDaURL();
  render();
  if (temConvite) return;
  if (fam && fam.token){
    try{
      await prepararContas(); await carregarMembros();
      if (eu){ ultimoSaldoVisto = saldoAtual = await lerSaldo(); iniciarVigia(); }
      render();
    }catch(e){ toast(e.message); }
  }
}
window.addEventListener('hashchange', ()=>{ if (aplicarConviteDaURL()) render(); });
iniciar();
})();
