# Carteira Fácil (versão 2, rede de teste)

App web pra pagar e receber "reais de teste" (tBRL) entre a família, na rede de teste Polygon Amoy.
O dinheiro **não tem valor**. Serve pra testar o funcionamento real antes de usar dinheiro de verdade.

## Como funciona
- Cada pessoa tem a própria carteira, guardada no celular dela (12 palavras de segurança).
- Ninguém precisa de gás: o celular só **assina** o pedido, e o "tanque" da família envia a transação e paga a taxa.
- A moeda (contrato `RealTesteFamilia.sol`) é criada pelo organizador dentro do próprio app.

## Arquivos
- `index.html`, `estilo.css`, `app.js`: o app
- `config.js`: rede, endereços de RPC e sites de POL de teste
- `contrato.js`: contrato compilado (gerado a partir de `RealTesteFamilia.sol`)
- `lib/`: bibliotecas (ethers, QR code, leitor de QR)

## Avisos
- O link de convite carrega a chave do tanque de gás. Isso só é aceitável em rede de teste.
  Na versão com dinheiro real, o tanque vira um "paymaster" (serviço patrocinador) e o convite não leva chave nenhuma.
- Se alguém trocar de celular sem as 12 palavras, perde a carteira.
