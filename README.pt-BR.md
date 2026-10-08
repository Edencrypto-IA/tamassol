# TAMASSOL

![Os seis companheiros TAMASSOL](docs/brand/universe.webp)

**Um companheiro vivo para Solana.** Presença física, intenção de privacidade e aprovação consciente.

[Site](https://tamassol.com) · [Evidência Localnet](https://tamassol.com/privacy.html#localnet-proof) · [README completo em inglês](README.md)

## Visão

TAMASSOL combina um companheiro físico expressivo com uma experiência Solana mais compreensível. Solflame já faz parte do protótipo ESP32-S3. Frost, Volt, Mizu, Verdant e Void compõem o universo visual e a experiência planejada; não são seis integrações prontas na placa.

O **Veil Router** recebe a intenção de privacidade, verifica capacidades e saúde dos provedores e só seleciona uma rota compatível. Sem rota saudável, a operação é bloqueada em vez de reduzir silenciosamente a proteção. Fallback com outro provedor é testado com mocks, não apresentado como integração ativa em produção.

## O que foi comprovado

Em **8 de outubro de 2026**, a execução automatizada Veil + Zolana Localnet concluiu roteamento, prova, transação local, descriptografia dos saldos e verificação do recibo:

| Resultado | Valor |
| --- | ---: |
| Depósito privado | 0,010 SOL de teste |
| Transferência confidencial | 0,003 SOL de teste |
| Saldo privado do remetente | 0,007 SOL de teste |
| Saldo privado do destinatário | 0,003 SOL de teste |

[Execução original](https://github.com/Edencrypto-IA/tamassol/actions/runs/37798210420) · [Código da validação em branch separada](https://github.com/Edencrypto-IA/tamassol/tree/veil-localnet-validation) · [Resumo público](https://tamassol.com/evidence/veil-localnet-summary.json)

Esse teste **não comprova aprovação física integrada, assinatura móvel ou funcionamento na Devnet**. Há um teste confidencial Devnet anterior e separado. Valor e ativo são confidenciais na rota testada; remetente e destinatário são públicos. Não é anonimato total. A integridade do recibo, isoladamente, não comprova liquidação.

## Arquitetura correta

- **Testes:** chave Solana e assinatura no computador local, com carteiras isoladas de teste.
- **Produto móvel planejado:** chave da carteira no celular do usuário.
- **ESP32-S3:** interface para exibir valor, destino e rede e receber aprovação física. Não guarda nem usa a chave privada Solana. Uma chave separada de autenticação do dispositivo não é a chave da carteira.
- **Veil + Zolana:** seleção de rota, criptografia subjacente do Zolana, execução e verificação.

O próximo marco vinculará a aprovação autenticada à transação exata, rejeitando replay, expiração e alterações antes da assinatura pelo aplicativo de teste. Um simples sinal USB/Wi-Fi não é autorização segura. Um computador ou celular de assinatura comprometido pode contornar sua própria lógica: **não é uma carteira fria tradicional nem um produto auditado**.

## Roadmap

1. **Validado:** teste automatizado Veil + Zolana Localnet e protótipo físico separado.
2. **Próximo:** aprovação física autenticada da transação exata no fluxo Localnet completo, incluindo testes negativos.
3. **Depois:** repetir o fluxo integrado em Devnet com provedor saudável.
4. **Depois:** aplicativo móvel, pareamento autenticado, recuperação e piloto em rede de teste com feedback documentado.
5. **Decisão futura:** revisão de segurança e critérios próprios antes de qualquer uso com fundos reais.

## Código e testes

Consulte o [mapa do repositório e comandos de teste](README.md#explore-the-code). A branch padrão mantém a base de saúde de provedores; a validação Localnet está na branch indicada acima, sem merge implícito.

Não versione seeds, chaves privadas, keypairs, APIs, arquivos `.env`, witnesses ou logs sensíveis. Use apenas carteiras e tokens de teste.

TAMASSOL é independente. Não há alegação de investimento, parceria, auditoria ou endosso da Solana/Zolana. A licença MIT do core não é uma licença geral para as artes e a marca do projeto.
