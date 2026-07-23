# Allgo Movie Maker

Editor de vídeo desktop **local, offline e de página única** — estilo CapCut simplificado.
Corta, junta com desvanecimento, coloca placas PNG por cima e exporta em 1080p com o
encoder da GPU NVIDIA.

O valor do programa é ser simples, bonito e rápido. Ele deliberadamente **não** tem
texto/legendas, keyframes, chroma key, velocidade variável nem outras transições.

## Fluxo

1. Arraste 1 a 5 vídeos para a janela.
2. Corte o início/fim dos clipes e junte-os com crossfade.
3. Coloque PNGs por cima (placas, balões, prints), posicionando e redimensionando no preview.
4. Ajuste brilho, contraste e saturação do vídeo inteiro.
5. Exporte em 1080p pronto para o YouTube.

## Instalação

```bash
npm install
```

Depois baixe os binários do FFmpeg (~100 MB, uma vez só):

```bash
npm run setup
```

Isso coloca `ffmpeg.exe` e `ffprobe.exe` em `resources/bin/` (pasta ignorada pelo git).
Se você já tem os binários, é só copiá-los para lá. Sem eles o app abre, mas não
consegue analisar mídia nem exportar.

## Scripts

| Comando | O que faz |
|---|---|
| `npm run dev` | Sobe o app em modo desenvolvimento (HMR no renderer) |
| `npm test` | Testes unitários do `computeLayout` e do `buildExportCommand` |
| `npm run typecheck` | `tsc --noEmit` em todo o projeto |
| `npm run build` | Compila main, preload e renderer para `out/` |
| `npm run dist` | Gera instalador NSIS + portable em `release/` |

`ALLGO_DEBUG=1` espelha o console do renderer no terminal.

## Atalhos

| Tecla | Ação |
|---|---|
| `Espaço` | Reproduzir / pausar |
| `S` | Dividir o clipe no playhead |
| `Del` | Remover o clipe selecionado |
| `←` / `→` | Frame anterior / próximo |
| `Shift` + `←` / `→` | Pular 1 segundo |
| `Home` / `End` | Ir ao início / fim |
| `Ctrl+Z` / `Ctrl+Y` | Desfazer / refazer |
| `Ctrl+S` | Salvar projeto |
| `Ctrl+O` | Abrir projeto |
| `Ctrl+E` | Exportar |
| `Ctrl+Shift+S` | Capturar o frame atual em PNG 1080p |
| `+` / `-` | Zoom da timeline |
| `Ctrl` + scroll | Zoom da timeline no cursor |

## Arquitetura

```
electron/           processo main: janela, IPC, FFmpeg (probe, thumbs, detect, export)
  protocol.ts       protocolo allgo:// com suporte a Range (seek em vídeo grande)
src/
  shared/types.ts   formato do projeto .allgo + contrato do IPC
  engine/           computeLayout, buildExportCommand, clock — lógica pura
  store/            zustand: projeto (com undo/redo) e estado de UI
  components/       MediaBin, Preview, Timeline, PropertiesPanel, ExportModal
tests/              testes do computeLayout e do buildExportCommand
resources/bin/      ffmpeg.exe, ffprobe.exe (baixados por npm run setup)
```

### Decisões que valem saber

**`computeLayout` é a única fonte de verdade sobre tempo.** Crossfades sobrepõem
clipes, então a duração total não é a soma das durações. Timeline, preview e export
consomem exclusivamente essa função. Um corte seco é modelado como crossfade de
exatamente **1 frame**, porque é assim que o export monta o grafo (`xfade` não aceita
`duration=0`) — se valesse 0 aqui e 1 frame lá, a duração final derivaria alguns frames
a cada junção.

**O preview não usa FFmpeg.** É composição em tempo real no renderer: dois elementos
`<video>` alternados (para crossfade e para trocar de clipe sem engasgo), `<img>` por
overlay e `filter` CSS no contêiner. A GPU decodifica e compõe de graça.

**O relógio do preview vive fora do React.** Playhead, opacidades e crossfade mudam a
60 fps; se isso passasse pelo estado do React a timeline re-renderizaria a cada frame.
Quem precisa do tempo se inscreve em `clock` e escreve direto no DOM.

**O export é um único comando FFmpeg** com `filter_complex` passado por arquivo
(`-filter_complex_script`), porque o grafo estoura o limite de linha de comando do
Windows com muitos inputs. `buildExportCommand` é uma função pura e é a parte com
mais testes — é onde bugs se escondem.

**Preview e export não são pixel-idênticos em cor.** O preview usa `filter` CSS e o
export usa o filtro `eq` do FFmpeg; as curvas são diferentes. Com o mapeamento usado
(`brightness = v/200`, `contrast = 1 + v/100`, `saturation = 1 + v/100`) os dois ficam
próximos o suficiente para ajustes moderados.

## Formato `.allgo`

JSON simples — o mesmo objeto `Project` de `src/shared/types.ts`. Guarda caminhos
absolutos das mídias; se um arquivo sumir, o item aparece em vermelho no painel de
mídia com botão "Relocalizar". Autosave a cada 30 s e antes de exportar, em
`userData/autosave/`.
