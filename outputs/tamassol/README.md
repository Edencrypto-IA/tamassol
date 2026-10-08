# TAMASSOL v0.8 — botão de fala

Para falar sem comandos manuais, abra `ABRIR-VOZ-TAMASSOL.cmd` e use BOOT longo.
Veja [VOICE-BUTTON.md](VOICE-BUTTON.md). Reconhecimento local no computador; nenhum envio automático.

Atualização atual: [RELIABILITY_v07.md](RELIABILITY_v07.md). Indicadores Wi-Fi e validade de preço/saldo no lugar da bateria fictícia; resultados temporários da interação por voz. Visual, pinagem, Devnet e regras de autorização preservados. As seções abaixo registram versões anteriores.

Atualização mais recente: [ONLINE_v05.md](ONLINE_v05.md). Preço, saldo e USD simulado no painel esquerdo; botões no rodapé; celebração com saltos, brilho e partículas durante seis segundos. Hardware e sprites preservados.

Base online anterior: [ONLINE_v04.md](ONLINE_v04.md). ENVIAR desativado, BOOT abre/fecha o endereço de recebimento. Preço e variação 24h reais; emoções seguem o mercado com cochilos periódicos. A configuração privada e os binários online contêm credenciais Wi-Fi: não compartilhar.

## Histórico v0.2 — paisagem e Solflame

FREENOVE **FNK0104A**, ILI9341, **320×240 landscape**, COM3. Pinagem, driver, orientação, plataforma, entrada BOOT e arquitetura da v0.1 preservados.

## Interface

- Paisagem pixel-art estática 320×240: árvore, lago, castelo e pedestal central.
- Solflame adaptado da referência visual oficial de 21/09/2026, sem o placeholder anterior.
- Nove frames RGBA 128×128: três por estado SLEEP/HAPPY/ANGRY; alvos de 4/8/8 FPS.
- Painel SOL **$142.37 / +2.6%** e **BAT 78%**, todos valores fictícios locais. O painel está marcado DEMO.
- Texto e botões desenhados separadamente do background; estado ativo destacado em amarelo, cyan ou vermelho.
- BOOT/GPIO0 continua alternando SLEEP → HAPPY → ANGRY → SLEEP, debounce de 30 ms.
- Sem Wi-Fi, API, blockchain, Bluetooth, carteira ou medição real de bateria.

## Renderização

O cenário RGB565 ocupa 153.600 bytes em flash e é enviado ao display **uma vez** na inicialização da UI. Cada frame recompõe somente a região `(96,72,128,128)`: copia essa área do cenário para o buffer existente de 32 KiB, aplica uma máscara de opacidade de um bit e envia o retângulo final ao LCD. Essa região não intercepta painéis/textos/botões. Não há leitura do LCD, decoding PNG, alocação ou redesenho da tela inteira no loop.

Assets totais: 466.944 bytes (background + RGB565 + máscaras). Não é mantido framebuffer completo em RAM. Usa PSRAM para o buffer parcial, com fallback para RAM interna. A telemetria serial mostra o estado, FPS, duração do blit e memória livre a cada 5 s.

## Comandos neste computador

Execute da raiz da tarefa:

```powershell
.\outputs\tamassol\tools\run.ps1 build
.\outputs\tamassol\tools\run.ps1 upload -Port COM3
.\outputs\tamassol\tools\run.ps1 monitor -Port COM3
```

O wrapper usa o ambiente local `work/build-env` e um alias curto temporário para evitar limites de caminho do GCC no Windows. Em um checkout curto com PlatformIO instalado: `pio run -e freenove_fnk0104ab`, seguido de `pio run -e freenove_fnk0104ab -t upload --upload-port COM3`.

Versões preservadas: Espressif32 6.9.0 / Arduino-ESP32 2.0.17 / TFT_eSPI 2.5.43. Compilar não exige Pillow porque os arrays gerados estão no projeto.

## Assets e edição

Fontes finais otimizadas: `assets/background/landscape.png` (320×240) e `assets/solflame/{sleep,happy,angry}/01..03.png` (128×128 RGBA). O pipeline converte esses arquivos em `src/mascot/generated/`:

```sh
python -m pip install -r tools/requirements.txt
python tools/prepare_assets.py
```

O extrator de sprite sheets continua separado em `tools/extract_sheet.py`. A importação opcional de uma folha 3×3 com chroma-key está disponível por `prepare_assets.py --background <imagem> --sheet <atlas>`. O fundo magenta só é removido quando conectado às bordas da célula, preservando o emblema roxo interno.

`preview_sleep.png`, `preview_happy.png` e `preview_angry.png` mostram a composição no tamanho real; a rasterização de texto da prévia é aproximada. A interface da placa usa fontes da TFT_eSPI.

Referências e prompts: [assets/PROVENANCE.md](assets/PROVENANCE.md). Hardware: [HARDWARE.md](HARDWARE.md). Validação desta versão: [VALIDATION_v02.md](VALIDATION_v02.md). `VALIDATION.md` e os logs sem sufixo registram a versão anterior.

## Estrutura preservada

`src/main`, `display`, `input`, `animation`, `mascot`, `ui`; `include/BoardConfig.h` centraliza os GPIOs. `Mascot.setAnimation()`, `update()` e `draw()` permanecem separados. Testes de temporização/debounce em `tests/core_tests.cpp`.
# Atualização online v0.3

Integração somente Devnet documentada em [ONLINE.md](ONLINE.md). A base visual descrita abaixo permanece preservada. `include/OnlineConfig.h` e os binários online contêm credenciais locais: não compartilhar. O `firmware.bin`/`firmware-v02.bin` anterior continua sendo o backup offline; builds novos são gerados em `.pio/build/freenove_fnk0104ab/`.

