# Allgo Movie Maker — Especificação de Implementação

> Documento para implementação completa. Leia tudo antes de começar. As seções "⚠️ Detalhes críticos" contêm as armadilhas conhecidas — não pule.

## 1. Visão geral

Editor de vídeo desktop **local, offline, de página única**, estilo CapCut simplificado, para uso pessoal do usuário. Fluxo típico do usuário:

1. Abre o programa, arrasta 1 a 5 vídeos (1080p, geralmente MP4 de celular/downloads).
2. Corta início/fim dos clipes, junta os clipes com **desvanecimento lento (crossfade)**.
3. Coloca **imagens PNG por cima do vídeo** (placas, balões de fala, prints de reportagens) — às vezes 3 ou 4 camadas simultâneas — posicionando e redimensionando cada uma com o mouse no preview, com animação **fade-in / fade-out / ambos**.
4. Antes de exportar, ajusta **brilho e contraste do vídeo inteiro** (ajuste global, não por clipe).
5. Exporta em 1080p com encoder da GPU NVIDIA (RTX 4060 Ti no desktop, RTX 4050 no notebook), em formato pronto para subir no YouTube.

Ele **não usa**: texto/legendas, efeitos, keyframes, chroma key, velocidade variável, múltiplas transições. Não adicionar nada disso. O valor do programa está em ser simples, bonito e rápido.

Referência visual de resultado final (vídeo editado pelo usuário no CapCut): https://www.youtube.com/watch?v=gBB4idvPVSM — vídeo corrido com placas/balões aparecendo por cima.

**Nome do app:** Allgo Movie Maker. Idioma da UI: **português (pt-BR)**.

## 2. Stack técnica

| Camada | Escolha | Justificativa |
|---|---|---|
| Shell desktop | **Electron** (última LTS) | Acesso a arquivos, spawn de processos (FFmpeg), `<video>` do Chromium decodifica H.264/HEVC com aceleração de hardware — preview fluido de graça. |
| UI | **React 18 + TypeScript + Vite** | Produtividade e HMR. |
| Estado | **Zustand** (com middleware para undo/redo) | Simples, sem boilerplate; snapshot do estado = arquivo de projeto. |
| Estilo | CSS moderno (CSS vars, flex/grid). Sem Tailwind se preferir, mas manter design system consistente (§7) | Página única, poucos componentes. |
| Mídia (probe, thumbnails, export) | **FFmpeg + FFprobe estáticos** (build win64 gyan.dev ou BtbN), embarcados em `resources/bin/` | Toda a renderização final é um único comando FFmpeg com `filter_complex`. |
| Encoder | `hevc_nvenc` (padrão) / `h264_nvenc` / `av1_nvenc` (opcional, RTX 40xx) com fallback `libx264` | Ver §9. |

**Preview NÃO usa FFmpeg** — é composto em tempo real no renderer com elementos `<video>`/`<img>` sobrepostos + CSS (ver §8). FFmpeg só entra para probe, thumbnails e export. Isso mantém o preview instantâneo e o código simples.

### Processos Electron

- **Main process:** janela, diálogos de arquivo, spawn/kill de FFmpeg/FFprobe, leitura/escrita de projeto e autosave, parse de progresso do export.
- **Renderer:** toda a UI, timeline, preview.
- **IPC (contextBridge, `preload.ts`):** API tipada mínima:
  - `probeFile(path) → MediaInfo`
  - `generateThumbnails(path, count, height) → string[] (paths de jpg em cache)`
  - `export(projectJson, outputPath) → stream de progresso (eventos) + cancel`
  - `saveProject / openProject / dialogs`
  - `detectEncoders() → { hevc_nvenc: bool, h264_nvenc: bool, av1_nvenc: bool }`
- Cache de thumbnails em `app.getPath('userData')/cache/<hash-do-arquivo>/`.

## 3. Funcionalidades — MVP (obrigatório)

### 3.1 Importação e Media Bin
- Drag & drop de arquivos na janela + botão "Importar".
- Vídeos (mp4, mov, mkv, webm) e imagens (png, jpg, webp). PNG com alpha é o caso principal das placas.
- Ao importar, rodar ffprobe (duração, resolução, fps, codec, canais de áudio) e gerar thumbnail.
- Painel lateral compacto com as mídias importadas (thumbnail + nome + duração). Arrastar do bin para a timeline.

### 3.2 Timeline (o coração do app)
- Formato tipo CapCut: régua de tempo em cima, playhead vermelho, trilhas horizontais.
- **1 trilha de vídeo principal** (embaixo) + **trilhas de imagem overlay** (em cima, criadas dinamicamente conforme necessário — suportar pelo menos 6). Opcional: 1 trilha de áudio para música de fundo (ver extras §4).
- Na trilha de vídeo os clipes são **sequenciais e magnéticos** (sem buracos — remover um clipe puxa os seguintes, como no CapCut). Reordenar por drag & drop.
- Clipes de vídeo mostram **filmstrip de thumbnails** dentro do bloco; clipes de imagem mostram a própria imagem.
- **Trim:** arrastar as bordas esquerda/direita do clipe (altera in/out point, nunca o arquivo).
- **Split:** botão/tecla `S` divide o clipe no playhead.
- **Zoom da timeline:** slider + `Ctrl+scroll`, de "projeto inteiro visível" até ~10 px por frame.
- **Snapping:** bordas de clipes, playhead e marcações grudam entre si (tolerância ~8 px), com toggle para desligar.
- Clique na régua ou arrastar o playhead = seek. Clique em clipe = seleciona (mostra propriedades). `Del` **ou `D`** remove o item selecionado (clipe de vídeo, figura ou áudio) — o atalho `D` só vale quando o foco não está em um campo de texto.
- Imagens overlay: duração livre (arrastar bordas), posição livre no tempo (podem ter buracos entre si), padrão inicial 5 s.

### 3.3 Transição: desvanecimento (crossfade)
- Única transição do app. Aplicada **entre dois clipes adjacentes** da trilha de vídeo: um pequeno ícone/manípulo na junção entre clipes; clicar adiciona/remove o crossfade.
- Duração configurável no painel de propriedades (padrão **1,0 s**, faixa 0,2–3,0 s, limitada pela duração dos clipes vizinhos).
- Crossfade **sobrepõe** os clipes (duração total diminui pela duração da transição) — igual ao CapCut. A timeline deve desenhar a região de sobreposição de forma clara (bloco losango/hachura na junção).
- Também oferecer **fade from black** no primeiro clipe e **fade to black** no último (checkbox nas propriedades do clipe) — é barato e o usuário provavelmente usa.

### 3.4 Imagens overlay (placas)
- Arrastar imagem do bin para a área de overlay da timeline (ou soltar direto no preview no tempo atual).
- **Posicionar e redimensionar direto no preview:** clipe de imagem selecionado mostra caixa com 4 alças de canto (redimensionar proporcional) + arrastar para mover. Sem rotação (não é usado). Guias de alinhamento simples: linhas quando cruza o centro horizontal/vertical (com snap).
- **Redimensionar com o scroll:** com uma figura selecionada, girar a roda do mouse **sobre o preview** aumenta/diminui a escala dela (passo ~3% por tick, `Shift` = passo fino de 1%), mantendo o centro fixo. Não confundir com o `Ctrl+scroll` de zoom da timeline — o scroll de escala só atua quando o cursor está sobre o preview e há figura selecionada.
- **Copiar/colar figura (`Ctrl+C` / `Ctrl+V`):** com um clipe de imagem selecionado na timeline, `Ctrl+C` copia e `Ctrl+V` cola uma cópia **com tudo**: mesma imagem, posição, escala, opacidade, duração e animações de entrada/saída. A cópia entra começando no playhead, na mesma trilha se houver espaço livre; se colidir com outro clipe, colocar na primeira trilha acima com espaço (criando trilha nova se preciso). A cópia colada já nasce selecionada, pronta pra arrastar.
- Propriedades do clipe de imagem: **animação = Nenhuma / Fade-in / Fade-out / Ambos**, com duração do fade (padrão 0,5 s, faixa 0,1–2,0 s), e **opacidade** geral (0–100%, padrão 100).
- Ordem das trilhas = ordem de empilhamento (trilha mais alta na timeline renderiza por cima).

### 3.5 Preview
- Área central, proporção 16:9, fundo escuro. Renderiza a composição completa: vídeo + crossfades + overlays com fades + ajuste de cor.
- Controles: play/pause (`Espaço`), timecode `MM:SS.d / MM:SS.d`, frame anterior/próximo (`←`/`→`), ir ao início.
- O preview deve refletir **tudo** que o export vai gerar (WYSIWYG). Ver §8.
- **Modo prévia de mídia:** clicar em um item do media bin toca **aquele arquivo sozinho** na tela central (vídeo com áudio; imagem exibida estática), com os mesmos controles de play/pause/seek — serve pra conferir o material antes de arrastar pra timeline. Uma faixa discreta no topo do preview indica o modo ("Prévia: nome-do-arquivo" + botão ✕ "Voltar ao projeto"). Clicar na timeline, no playhead ou dar play no projeto sai automaticamente do modo prévia e volta à composição. Implementação: usar um terceiro elemento `<video>` dedicado (não mexer nos decks A/B do projeto).

### 3.6 Ajuste global de cor
- Painel "Ajustes" (aplicado ao vídeo inteiro, nunca por clipe): **Brilho** (−100…+100), **Contraste** (−100…+100), **Saturação** (−100…+100) — saturação é de graça no mesmo filtro, incluir. Botão "Restaurar".
- **Cada slider tem uma caixinha numérica ao lado** (input editável, não só mostrador): digitar um valor atualiza o slider e o preview na hora (aplicar no Enter/blur; aceitar negativo; clampar em −100…+100; setas ↑/↓ na caixinha somam ±1). Slider e caixinha ficam sempre sincronizados. Usar o mesmo padrão slider+caixinha nos demais controles numéricos do app (volume, opacidade, durações de fade/transição).
- Preview em tempo real via CSS filter no contêiner do preview; export via filtro `eq` (mapeamento em §9.4).

### 3.7 Exportação
- Botão "Exportar" destacado → modal com: nome/pasta do arquivo, resolução (fixo 1920×1080), fps (auto = fps do primeiro clipe, opções 30/60), qualidade (Alta/Média — mapeia para CQ), codec (HEVC padrão / H.264 / AV1 se disponível), e resumo (duração, tamanho estimado).
- **Nome sugerido por padrão:** `BEA 23-07-2026` (prefixo fixo "BEA" + data de hoje em `dd-mm-aaaa` com hífens — formato válido como nome de arquivo no Windows; nunca usar barras). Se já existir arquivo com esse nome na pasta, sufixar ` (2)`, ` (3)`… O mesmo nome padrão vale para salvar o projeto (`BEA 23-07-2026.allgo`). O usuário pode obviamente trocar o nome antes de confirmar.
- Barra de progresso real (parse do stderr do FFmpeg), tempo restante estimado, botão cancelar (kill do processo + apagar arquivo parcial), notificação ao concluir com botão "Abrir pasta".
- A UI fica utilizável mas bloqueada para edição durante o export (overlay no editor).

### 3.8 Projeto
- Formato `.allgo` (JSON, §6). Salvar/abrir; **autosave** a cada 30 s e antes de exportar (em `userData/autosave/`); ao abrir o app, oferecer restaurar sessão anterior se existir.
- Guardar caminhos absolutos das mídias; se um arquivo não existir ao abrir, mostrar item em vermelho com botão "Relocalizar".

## 4. Extras (implementar — são simples e valem a pena)

1. **Undo/Redo** (`Ctrl+Z`/`Ctrl+Y`) — histórico de snapshots do estado da timeline (estado é JSON pequeno; guardar até 100 passos). Além dos atalhos, **botões visíveis ↩ Desfazer / ↪ Refazer na barra superior** (desabilitados quando não há o que desfazer/refazer, com tooltip) — é a rede de segurança para quando o usuário apaga um vídeo da timeline sem querer.
2. **Áudio básico por clipe de vídeo:** slider de volume (0–200%) e mute. O crossfade de vídeo já faz crossfade do áudio automaticamente (acrossfade no export).
3. **Trilha de música de fundo** (1 trilha de áudio opcional): arrastar mp3/wav/m4a, trim, volume, fade-in/out. Muito comum em vídeo de YouTube.
4. **Capturar frame** (`Ctrl+Shift+S`): salva PNG do frame atual do preview em resolução 1080p — útil pra thumbnail do YouTube.
5. **Atalhos:** `Espaço` play/pause, `S` split, `Del`/`D` apagar, `Ctrl+C`/`Ctrl+V` copiar/colar figura, `←/→` frame a frame, `Shift+←/→` pula 1 s, `Home/End`, `Ctrl+S` salvar, `Ctrl+Z`/`Ctrl+Y` desfazer/refazer, `Ctrl+E` exportar, `+/-` zoom timeline.
6. **Projetos recentes** na tela inicial (abrir direto).
7. **Waveform** simplificado nos clipes de vídeo/áudio da timeline (gerar via ffmpeg `showwavespic` ou decodificar picos com WebAudio) — ajuda muito a cortar no lugar certo.

**Não implementar** (fora de escopo, resistir à tentação): texto/títulos, outras transições, keyframes, filtros/LUTs, rotação, velocidade, multicam, proxy, plugins.

## 5. Layout da interface

```
┌──────────────────────────────────────────────────────────────┐
│ [logo] Allgo Movie Maker      [Abrir] [Salvar]   [Exportar]  │  barra superior, 48px
├───────────┬──────────────────────────────┬───────────────────┤
│           │                              │                   │
│  MEDIA    │         PREVIEW 16:9         │   PROPRIEDADES /  │
│  BIN      │      (fundo #0e0e12)         │   AJUSTES         │
│ (220px)   │                              │    (280px)        │
│           │  ⏮  ◀  ▶/⏸  ▶  00:12.3/03:45 │                   │
├───────────┴──────────────────────────────┴───────────────────┤
│  🔍──────  régua de tempo                            [snap]  │
│  [ovl 3]      ▭▭▭                                            │
│  [ovl 2]   ▭▭▭▭▭      ▭▭▭▭                                   │
│  [ovl 1] ▭▭▭▭▭▭▭▭  ▭▭▭▭▭▭▭▭▭                                 │
│  [vídeo] ████████████◆██████████████◆███████████████         │  ◆ = crossfade
│  [áudio] ♪♪♪♪♪♪♪♪♪♪♪♪♪♪♪♪♪♪♪♪♪♪♪♪♪                           │
└──────────────────────────────────────────────────────────────┘  timeline ~35% da altura
```

- Painel de propriedades é contextual: nada selecionado → mostra "Ajustes" globais (brilho/contraste/saturação); clipe de vídeo selecionado → volume, fades preto; imagem selecionada → animação, duração do fade, opacidade; junção selecionada → duração do crossfade.
- **Tema escuro** (editores de vídeo são escuros por bom motivo). Design limpo: cantos levemente arredondados, uma cor de acento (ex.: violeta/azul elétrico), tipografia Inter/system-ui, ícones Lucide. Animações sutis (hover, seleção). Deve parecer um produto, não um protótipo.

## 6. Modelo de dados (arquivo de projeto e estado)

```ts
interface Project {
  version: 1;
  name: string;
  fps: number;                 // fps do projeto (definido pelo 1º clipe importado; tudo é normalizado a ele)
  width: 1920; height: 1080;
  adjust: { brightness: number; contrast: number; saturation: number }; // -100..100, 0 = neutro
  media: MediaItem[];          // biblioteca
  videoTrack: VideoClip[];     // ordenado, sequencial, sem buracos
  overlayTracks: ImageClip[][];// índice 0 = trilha mais baixa
  musicTrack?: AudioClip[];
}

interface MediaItem {
  id: string; path: string; kind: 'video' | 'image' | 'audio';
  duration?: number;           // s (vídeo/áudio)
  width?: number; height?: number; fps?: number; hasAudio?: boolean;
}

interface VideoClip {
  id: string; mediaId: string;
  inPoint: number; outPoint: number;   // s, no arquivo de origem
  volume: number; muted: boolean;
  fadeFromBlack?: number;              // s, só faz sentido no 1º clipe
  fadeToBlack?: number;                // s, só no último
  transitionAfter?: { duration: number };  // crossfade com o próximo clipe
}

interface ImageClip {
  id: string; mediaId: string;
  start: number; duration: number;     // s, na linha do tempo FINAL (pós-crossfades)
  // posição normalizada (0..1 relativo ao quadro 1920x1080) => independe do tamanho do preview
  x: number; y: number;                // centro da imagem
  scale: number;                       // 1 = largura natural da imagem em px sobre 1920
  opacity: number;                     // 0..1
  fadeIn: number; fadeOut: number;     // s (0 = sem)
}
```

⚠️ **Decisão importante — linha do tempo final:** como crossfades sobrepõem clipes, a duração total ≠ soma dos clipes. Definir uma função única `computeLayout(project)` que devolve, para cada clipe de vídeo, `{timelineStart, timelineEnd}` já descontando as sobreposições, e a duração total. **Timeline (desenho), preview e export usam exclusivamente essa função** — é a única fonte de verdade de tempo. Overlays e música já são posicionados em tempo final, então não são afetados por edições de trim? — São: deixar overlays fixos no tempo final (comportamento CapCut); se o usuário encurtar o vídeo, overlays que ficarem além do fim são clampados na UI com aviso visual.

## 7. Design system (resumo)

- Paleta: fundo `#111114` / superfícies `#1a1a20` / bordas `#2a2a33` / texto `#e8e8ee` / texto secundário `#9a9aa8` / acento `#7c5cff` (hover `#9678ff`) / perigo `#ff5c5c`.
- Timeline: trilha de vídeo altura 64 px, overlays 36 px, régua 28 px. Clipe selecionado = borda 2 px acento + leve glow. Playhead: linha 2 px `#ff4444` com cabeça triangular.
- Tudo com `user-select: none`, cursores corretos (`ew-resize` nas bordas de trim, `grab/grabbing` ao mover).

## 8. Motor de preview (tempo real, sem FFmpeg)

### Composição
Contêiner do preview (div 16:9) com camadas absolutas, de baixo pra cima:
1. `<video>` **A** e `<video>` **B** — dois elementos ("decks") alternados para reprodução contínua entre clipes e crossfade (durante o crossfade, B toca por cima de A com opacity animada; fora dele, só um deck visível). Em cortes secos, pré-carregar/pré-seekar o próximo clipe no deck ocioso ~1 s antes para trocar sem engasgo.
2. `<img>` por overlay ativo, com `transform: translate(...) scale(...)` e `opacity` calculada por frame (fades).
3. CSS `filter: brightness() contrast() saturate()` **no contêiner** (ajuste global).
4. Overlay de seleção (alças de redimensionar) por cima de tudo, fora do contêiner filtrado.

### Relógio
- `requestAnimationFrame` como loop. Quando tocando, o **currentTime do deck ativo é o relógio mestre**: `timelineTime = clip.timelineStart + (video.currentTime - clip.inPoint)`. A cada frame: atualizar playhead, opacidades de overlays/crossfade, e disparar transição de decks quando `timelineTime` cruza fronteiras (usar a `computeLayout` do §6).
- Seek: mapear tempo final → (clipe, tempo no arquivo), `video.currentTime = ...`, pausado usa `video.requestVideoFrameCallback` para redesenhar overlays no frame exato.
- Volume/mute por clipe aplicado no elemento de vídeo; música de fundo em `<audio>` sincronizado com correção de drift (> 80 ms → re-seek).

⚠️ **Detalhes críticos do preview**
- `video.preload = 'auto'`; manter os dois decks sempre com `src` carregado dos clipes atual/próximo.
- Vídeos de celular podem ter rotação nos metadados — o Chromium já aplica; mas o **export** precisa aplicar também (autorotate do FFmpeg é padrão, não desligar).
- Arquivos com fps variável (gravações de tela/WhatsApp): preview ok; export normaliza com `fps=` (§9).
- Não usar canvas + drawImage por frame — CSS compositing dá 60 fps de graça e a GPU decodifica.

## 9. Motor de exportação (FFmpeg)

### 9.1 Estratégia
Export = **um único comando FFmpeg** com `filter_complex` construído a partir do `Project` + `computeLayout`. Escrever um módulo `buildExportCommand(project, output, options): string[]` **puro e testável** (unit tests comparando o grafo gerado — é a parte com mais chance de bug).

### 9.2 Grafo de vídeo
Para cada clipe de vídeo `i` (input `i`), buscar o trecho diretamente na entrada
e limitar a leitura à duração usada (`-ss IN -t (OUT-IN) -i arquivo`). Isso é
importante quando vários clipes vêm do mesmo arquivo grande: evita decodificar
desde o início a fonte inteira para cada `trim`.

Depois, normalizar o trecho já recortado:
```
[i:v] trim=start=0:end=(OUT-IN), setpts=PTS-STARTPTS,
      scale=1920:1080:force_original_aspect_ratio=decrease,
      pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black,
      fps=FPS, setsar=1, format=yuv420p [vi]
```
Encadear com xfade (tempos vêm de `computeLayout`):
```
[v0][v1] xfade=transition=fade:duration=D1:offset=OFF1 [x1];
[x1][v2] xfade=transition=fade:duration=D2:offset=OFF2 [x2]; ...
```
⚠️ `offset` do xfade é o tempo (na saída acumulada) em que a transição **começa** = `timelineStart` do clipe seguinte. xfade exige mesmos fps/resolução/SAR/formato em ambos os lados — por isso a normalização acima é obrigatória em todo clipe, mesmo que "já esteja em 1080p".
Junções **sem** crossfade: usar `xfade` não funciona com duration 0 — concatenar por `concat` é misturar abordagens; solução simples e robusta: **tratar corte seco como crossfade de 1 frame** (`duration=1/FPS`) — visualmente idêntico e mantém o grafo uniforme. Fade from/to black: `fade=t=in:st=0:d=X` no primeiro clipe / `fade=t=out:st=(dur-X):d=X` aplicado ao stream final.

### 9.3 Overlays de imagem
Cada imagem é um input com `-loop 1 -t <duration>` e:
```
[k:v] format=rgba,
      scale=W:-1,                                  // W = scale * 1920 (largura alvo em px)
      fade=t=in:st=0:d=FIN:alpha=1,                // fades em tempo LOCAL do stream…
      fade=t=out:st=DUR-FOUT:d=FOUT:alpha=1,
      colorchannelmixer=aa=OPACITY,                // opacidade geral (se < 1)
      setpts=PTS-STARTPTS+START/TB [ovk]           // …e SÓ DEPOIS desloca para o tempo final
[prev][ovk] overlay=x=X:y=Y:enable='between(t,START,END)' [next]
```
⚠️ Ordem importa: `fade` com `st` local (0-based) **antes** do `setpts` de deslocamento, senão os tempos do fade quebram. `X,Y` em px do canto superior esquerdo (converter do centro normalizado do modelo). Empilhar overlays na ordem das trilhas (trilha 0 primeiro). Ao final da cadeia:
```
[vfinal] eq=brightness=B:contrast=C:saturation=S [vout]
```

### 9.4 Mapeamento dos sliders (−100…+100 → filtros)
- Brilho: `eq brightness = v/200` (→ −0,5…+0,5); preview CSS `brightness(1 + v/200)`.
- Contraste: `eq contrast = 1 + v/100` (→ 0…2); preview CSS `contrast(1 + v/100)`.
- Saturação: `eq saturation = 1 + v/100` (→ 0…2); preview CSS `saturate(1 + v/100)`.
⚠️ CSS e `eq` não são matematicamente idênticos (curvas diferentes) — com esses mapeamentos ficam próximos o suficiente para ajustes moderados; documentar no código. Validar visualmente exportando um frame de teste.
> **Atualizado (2026-11):** o `eq` foi abandonado — medido, o contraste divergia até 50/255 do preview (ele só age na luma). O export agora replica o CSS em RGB (`lutrgb` + matriz do `saturate()`); ver `colorFilterChain`.

### 9.5 Áudio
- Por clipe: `[i:a] atrim=…, asetpts=PTS-STARTPTS, volume=V [ai]` (clipe sem áudio ou mutado → `anullsrc` do mesmo comprimento).
- Junções: `acrossfade=d=D` espelhando cada xfade (corte seco = `acrossfade` de 1/FPS ou `concat` de áudio — usar acrossfade curto para manter simetria).
- Música de fundo: buscar `IN` com `-ss`, limitar com `-t (OUT-IN)`, depois `atrim=start=0:end=(OUT-IN)`, `adelay`, `afade`, `volume` e `amix=inputs=2:duration=first` com o áudio principal.
- Saída: `aresample=48000`, AAC 192 kbps estéreo.

### 9.6 Encoding (saída para YouTube, 1080p)
```
-c:v hevc_nvenc -preset p5 -tune hq -rc vbr -cq 23 -b:v 0 -maxrate 40M -bufsize 80M
     -spatial-aq 1 -temporal-aq 1 -b_ref_mode middle -pix_fmt yuv420p -tag:v hvc1
-c:a aac -b:a 192k -ar 48000
-movflags +faststart   // mp4
```
- Qualidade "Alta" = cq 21, "Média" = cq 25. H.264: `h264_nvenc`, mesmos moldes, cq ~19/23. AV1 (`av1_nvenc`, só RTX 40xx): cq ~28, melhor compressão, YouTube aceita.
- **Detecção:** no primeiro run, testar cada encoder com um encode de 1 frame (`-f lavfi -i nullsrc … -frames:v 1 -f null -`); guardar resultado. Sem NVENC → fallback `libx264 -preset medium -crf 20` com aviso discreto.
- O encode usa NVENC na GPU. No export com `filter_complex` (escala, xfade e overlays), manter a decodificação em software evita conflitos de transferência entre frames acelerados e esses filtros; `-hwaccel auto` fica reservado para fluxos simples que não misturam filtros software.

### 9.7 Progresso
- Usar `-progress pipe:1 -nostats`: parsear `out_time_us` → `% = out_time / duraçãoTotal`. Estimar restante por média móvel da velocidade. Cancelar = `process.kill()` + deletar parcial. Capturar stderr completo para log de erro (mostrar em "detalhes" se falhar).

### 9.8 Limite prático
⚠️ `filter_complex` com muitos inputs fica grande — passar via `-filter_complex_script arquivo.txt` (evita limite de linha de comando do Windows). Testar cenário: 6 clipes + 12 overlays + música.

## 10. Fases de implementação (ordem obrigatória)

1. **Esqueleto:** Electron + Vite + React + IPC tipado; FFmpeg embarcado; probe + thumbnails; media bin com drag & drop; layout geral com design system.
2. **Timeline + preview de 1 clipe:** régua, zoom, playhead, seek, play/pause com relógio rAF; trim e split; filmstrip.
3. **Multi-clipe:** `computeLayout`, magnetismo/reordenação, troca de decks em cortes secos, crossfade (UI da junção + preview com 2 decks).
4. **Overlays:** trilhas de imagem, drag do bin, manipulação no preview (mover/redimensionar com alças e guias), fades, opacidade.
5. **Ajustes globais + áudio:** painel brilho/contraste/saturação (CSS), volume/mute por clipe, trilha de música.
6. **Export:** `buildExportCommand` com unit tests, modal, progresso, cancelamento, detecção de encoders, notificação.
7. **Robustez e polish:** projeto salvar/abrir/autosave/restaurar, relocalizar mídia, undo/redo, atalhos, waveform, captura de frame, projetos recentes, estados vazios bonitos, empty-state inicial ("arraste vídeos aqui").

## 11. Critérios de aceite (testar manualmente antes de entregar)

1. Importar 3 MP4s 1080p de origens diferentes (celular vertical incluído — deve entrar com barras, sem esticar), montar com 2 crossfades de 1 s, cortar início/fim de cada um.
2. Adicionar 4 PNGs com alpha em 3 trilhas, sobrepostos no tempo, cada um com fade-in+out, posicionados/redimensionados pelo mouse.
3. Ajustar brilho +15, contraste +10, saturação +5.
4. Preview toca do início ao fim sem travar, crossfades e fades visíveis, WYSIWYG.
5. Exportar HEVC NVENC: barra de progresso avança, GPU em uso (conferir no Task Manager), arquivo final abre no player e **bate com o preview** (cortes, tempos das placas, posições, cor). Duração final = duração mostrada na timeline (± 1 frame).
6. Fechar o app sem salvar → reabrir → oferece restaurar e restaura tudo.
7. Ctrl+Z reverte as últimas 10 ações de edição corretamente.
8. Corte seco (junção sem transição) não produz frame preto nem flash.
9. Export cancelado não deixa processo órfão nem arquivo corrompido visível.
10. Máquina sem NVIDIA: export funciona via libx264.
11. Figura selecionada: scroll sobre o preview redimensiona suavemente; `Ctrl+C`/`Ctrl+V` duplica com posição, escala, duração e fades idênticos.
12. `D` apaga o item selecionado (e não dispara enquanto se digita em um campo); botão ↩ Desfazer na barra superior recupera um vídeo apagado da timeline.
13. Clicar num vídeo do media bin toca a prévia dele na tela central com áudio; clicar na timeline volta ao projeto.
14. Modal de exportar e de salvar projeto abrem com o nome `BEA <data de hoje>` já preenchido.
15. Digitar `-37` na caixinha de brilho aplica exatamente −37 e o slider acompanha.

## 12. Estrutura de pastas sugerida

```
allgo-movie-maker/
├─ electron/           # main.ts, preload.ts, ipc/, ffmpeg/ (probe, thumbs, export, detect)
├─ src/
│  ├─ components/      # MediaBin, Preview, Timeline, PropertiesPanel, ExportModal, TopBar
│  ├─ engine/          # computeLayout.ts, previewClock.ts, buildExportCommand.ts (+ tests)
│  ├─ store/           # project.ts (zustand + undo), ui.ts
│  └─ styles/
├─ resources/bin/      # ffmpeg.exe, ffprobe.exe
└─ tests/              # unit tests do buildExportCommand e computeLayout
```

Empacotamento: `electron-builder`, target `nsis` (instalador) + `portable`. Ícone próprio. Sem auto-update, sem telemetria, 100% offline.
