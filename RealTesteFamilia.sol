// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// Moeda de TESTE da Carteira da Família (rede de teste, sem valor).
/// 1 tBRL imita 1 real. Os usuários nunca precisam de gás: eles só
/// ASSINAM o pedido no celular e o "tanque" da família envia a transação.
contract RealTesteFamilia {
    string public constant name = "Real Teste da Familia";
    string public constant symbol = "tBRL";
    uint8 public constant decimals = 18;
    uint256 public constant LIMITE_COLOCAR = 1000 ether; // máx. por "colocar dinheiro" (teste)

    uint256 public totalSupply;
    uint256 public immutable blocoCriacao;
    mapping(address => uint256) public balanceOf;
    mapping(address => uint256) public nonces;

    struct Perfil { string nome; string emoji; bool existe; }
    mapping(address => Perfil) public perfis;
    address[] public listaMembros;

    // tipos de pedido
    uint8 constant PAGAR = 1;
    uint8 constant COLOCAR = 2;
    uint8 constant TIRAR = 3;
    uint8 constant CADASTRAR = 4;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Membro(address indexed conta, string nome, string emoji);

    constructor() { blocoCriacao = block.number; }

    function hashPedido(uint8 op, address de, address para, uint256 valor, string memory nome, string memory emoji)
        public view returns (bytes32)
    {
        return keccak256(abi.encode(
            address(this), block.chainid, op, de, para, valor, nonces[de],
            keccak256(bytes(nome)), keccak256(bytes(emoji))
        ));
    }

    /// Qualquer um pode enviar (normalmente o tanque), mas só vale com a assinatura de `de`.
    function relay(uint8 op, address de, address para, uint256 valor, string calldata nome, string calldata emoji, bytes calldata sig) external {
        _conferir(de, hashPedido(op, de, para, valor, nome, emoji), sig);
        nonces[de]++;

        if (op == PAGAR) {
            require(perfis[para].existe, "destino nao e da familia");
            _mover(de, para, valor);
        } else if (op == COLOCAR) {
            require(valor > 0 && valor <= LIMITE_COLOCAR, "valor fora do limite de teste");
            totalSupply += valor;
            balanceOf[de] += valor;
            emit Transfer(address(0), de, valor);
        } else if (op == TIRAR) {
            require(balanceOf[de] >= valor, "saldo insuficiente");
            balanceOf[de] -= valor;
            totalSupply -= valor;
            emit Transfer(de, address(0), valor);
        } else if (op == CADASTRAR) {
            require(bytes(nome).length > 0 && bytes(nome).length <= 40, "nome");
            require(bytes(emoji).length <= 32, "emoji");
            if (!perfis[de].existe) listaMembros.push(de);
            perfis[de] = Perfil(nome, emoji, true);
            emit Membro(de, nome, emoji);
        } else {
            revert("pedido desconhecido");
        }
    }

    function _conferir(address de, bytes32 h, bytes calldata sig) internal pure {
        bytes32 eh = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", h));
        require(sig.length == 65, "assinatura invalida");
        bytes32 r; bytes32 s; uint8 v;
        assembly {
            r := calldataload(sig.offset)
            s := calldataload(add(sig.offset, 32))
            v := byte(0, calldataload(add(sig.offset, 64)))
        }
        if (v < 27) v += 27;
        address quem = ecrecover(eh, v, r, s);
        require(quem != address(0) && quem == de, "assinatura nao confere");
    }

    /// Transferência comum (para quem tiver gás próprio).
    function transfer(address para, uint256 valor) external returns (bool) {
        _mover(msg.sender, para, valor);
        return true;
    }

    function _mover(address de, address para, uint256 valor) internal {
        require(para != address(0), "destino");
        require(valor > 0, "valor");
        require(balanceOf[de] >= valor, "saldo insuficiente");
        balanceOf[de] -= valor;
        balanceOf[para] += valor;
        emit Transfer(de, para, valor);
    }

    function membros() external view returns (address[] memory contas, string[] memory nomes, string[] memory emojis) {
        uint256 n = listaMembros.length;
        contas = new address[](n);
        nomes = new string[](n);
        emojis = new string[](n);
        for (uint256 i = 0; i < n; i++) {
            address a = listaMembros[i];
            contas[i] = a;
            nomes[i] = perfis[a].nome;
            emojis[i] = perfis[a].emoji;
        }
    }
}
