// Configuração da rede.
// Rede principal da Polygon: o GÁS é POL de verdade (centavos por pagamento),
// mas a MOEDA da família continua sendo de teste (tBRL, sem valor).
window.CONFIG = {
  nomeRede: 'Polygon (gás real, moeda de teste)',
  chainId: 137,
  // Servidores públicos da rede. Se um recusar, o app tenta o próximo.
  rpcs: [
    'https://polygon.drpc.org',
    'https://polygon-rpc.com',
    'https://1rpc.io/matic',
    'https://polygon-public.nodies.app',
    'https://polygon-bor-rpc.publicnode.com'
  ],
  explorer: 'https://polygonscan.com',
  // Gorjeta mínima de gás aceita pela rede Polygon (em gwei)
  gorjetaMinGwei: 30,
  // POL necessário para criar a moeda da família
  minimoCriarPOL: 0.1,
  // Quando o gás da família ficar abaixo disso (em POL), aparece aviso
  avisoGasPOL: 0.2,
  comoRecarregar: 'Compre POL numa corretora (ex.: Mercado Bitcoin) e envie para este endereço escolhendo a rede <b>Polygon</b>. R$ 5 a R$ 10 já dão para muitos pagamentos.'
};
