// Configuração da rede. Por enquanto: Polygon Amoy (rede de TESTE, dinheiro sem valor).
window.CONFIG = {
  nomeRede: 'Polygon Amoy (teste)',
  chainId: 80002,
  rpcs: [
    'https://rpc-amoy.polygon.technology',
    'https://polygon-amoy-bor-rpc.publicnode.com',
    'https://polygon-amoy.api.onfinality.io/public'
  ],
  explorer: 'https://amoy.polygonscan.com',
  // Gorjeta mínima de gás aceita pela rede Amoy (em gwei)
  gorjetaMinGwei: 30,
  // Quando o gás da família ficar abaixo disso (em POL), o organizador recebe aviso
  avisoGasPOL: 0.02,
  faucets: [
    {nome:'Alchemy', url:'https://www.alchemy.com/faucets/polygon-amoy'},
    {nome:'QuickNode', url:'https://faucet.quicknode.com/polygon/amoy'}
  ]
};
