# TAMASSOL: teste real confidencial em Devnet

Escopo: somente Devnet. Não acessar carteira principal, publicar site ou inscrever projeto.

## Pré-requisito

Configurar HELIUS_API_KEY no ambiente local (nunca enviar pelo chat). Pode ser
colocada em um arquivo local `.env` ignorado nesta pasta, contendo apenas
`HELIUS_API_KEY=...`. Não usar a chave privada da carteira nesse arquivo.

Executar `node --env-file-if-exists=.env preflight.mjs` nesta pasta.
Esse comando só verifica rede e autenticação RPC; não comprova transferência.

## Critério de sucesso, ainda pendente

1. Duas carteiras novas exclusivamente de teste, sem fundos reais.
2. Depósito público confirmado em Devnet para saldo privado.
3. Transferência confidencial confirmada com assinatura e slot verificáveis.
4. Descriptografia local comprova a redução do saldo do remetente e o aumento
   exato do destinatário. Falha ou timeout não pode ser apresentado como sucesso.
5. Resultado distingue valor/ativo privados de remetente/destinatário públicos.
6. Integração com Veil é uma verificação separada de executar o exemplo do fornecedor.

SDK oficial identificado: @heliuslabs/zolana 0.3.1-alpha, @solana/kit 8.3.0.
Exemplos oficiais baixados em ../veil-devnet-examples apenas para inspeção;
não foram executados nem instalados. Não utilizar o payer padrão da Solana CLI.

Fontes: https://www.helius.dev/docs/privacy/sdk
https://www.helius.dev/docs/privacy/endpoints
https://github.com/helius-labs/zolana-examples
