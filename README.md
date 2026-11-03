# Allgo Movie Maker

Editor de vídeo desktop **local, offline e de página única** — estilo CapCut simplificado.
Corta, junta com desvanecimento, coloca placas PNG por cima e exporta em formato horizontal ou Reels com o
encoder da GPU NVIDIA.

O valor do programa é ser simples, bonito e rápido. Ele deliberadamente **não** tem
texto/legendas, keyframes, chroma key, velocidade variável nem outras transições.

## Fluxo

1. Arraste 1 a 5 vídeos para a janela.
2. Escolha **Horizontal · 16:9** ou **Reels · 9:16** no campo Formato da barra superior.
3. Corte o início/fim dos clipes e junte-os com crossfade.
4. Coloque imagens por cima (placas, balões, prints), posicionando e redimensionando na prévia já no formato final.
5. Ajuste brilho, contraste e saturação do vídeo inteiro.
6. Exporte na resolução do projeto ou em resolução dupla, sem alterar o enquadramento.

Projetos antigos continuam com o formato salvo. Para reaproveitar um projeto horizontal em Reels,
troque o Formato para **Reels · 9:16**, confira a posição e o tamanho das imagens na prévia e salve o projeto antes de exportar.

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
| `Del` / `D` | Remover o clipe selecionado |
| `Ctrl+C` / `Ctrl+V` | Copiar / colar a placa selecionada (cola no playhead, com tamanho, posição e fades) |
| `←` / `→` | Frame anterior / próximo |
| `Shift` + `←` / `→` | Pular 1 segundo |
| `Home` / `End` | Ir ao início / fim |
| `Ctrl+Z` / `Ctrl+Y` | Desfazer / refazer |
| Scroll sobre o preview | Redimensionar a placa selecionada (`Shift` = ajuste fino) |
| `Esc` | Sair da prévia de mídia |
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

**Cor: o export replica o `filter` CSS do preview.** Brilho (`1 + v/200`) e contraste
(`1 + v/100`) são aplicados por canal em RGB com `lutrgb`, e a saturação (`1 + v/100`)
com a matriz do `saturate()` do CSS via `colorchannelmixer`. A diferença medida entre
preview e arquivo fica em ~3/255 (arredondamento da conversão YUV↔RGB). Não usar o `eq`
do FFmpeg: o contraste dele só age na luma e as cores saíam bem mais apagadas.

## Formato `.allgo`

JSON simples — o mesmo objeto `Project` de `src/shared/types.ts`. Guarda caminhos
absolutos das mídias; se um arquivo sumir, o item aparece em vermelho no painel de
mídia com botão "Relocalizar". Autosave a cada 30 s e antes de exportar, em
`userData/autosave/`.
