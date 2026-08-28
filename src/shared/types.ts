/**
 * Tipos compartilhados entre o processo main (Electron) e o renderer (React).
 * Este arquivo é a fonte de verdade do formato de projeto `.allgo`.
 */

export const PROJECT_VERSION = 1
export const FRAME_W = 1920
export const FRAME_H = 1080

export type MediaKind = 'video' | 'image' | 'audio'

export interface MediaItem {
  id: string
  path: string
  name: string
  kind: MediaKind
  /** segundos (vídeo/áudio) */
  duration?: number
  width?: number
  height?: number
  fps?: number
  hasAudio?: boolean
  /** caminho do jpg de thumbnail no cache */
  thumbnail?: string
  /** marcado quando o arquivo não existe mais no disco */
  missing?: boolean
}

export interface VideoClip {
  id: string
  mediaId: string
  /** segundos, no arquivo de origem */
  inPoint: number
  outPoint: number
  /** 0..2 (0 = mudo, 1 = original, 2 = 200%) */
  volume: number
  muted: boolean
  /** segundos; só faz sentido no 1º clipe */
  fadeFromBlack?: number
  /** segundos; só faz sentido no último clipe */
  fadeToBlack?: number
  /** crossfade com o próximo clipe */
  transitionAfter?: { duration: number }
}

export interface ImageClip {
  id: string
  mediaId: string
  /** segundos na linha do tempo FINAL (pós-crossfades) */
  start: number
  duration: number
  /** centro da imagem, normalizado 0..1 sobre o quadro 1920x1080 */
  x: number
  y: number
  /** multiplicador do tamanho natural da imagem (1 = pixels nativos sobre 1920x1080) */
  scale: number
  /** 0..1 */
  opacity: number
  /** segundos (0 = sem fade) */
  fadeIn: number
  fadeOut: number
}

export interface AudioClip {
  id: string
  mediaId: string
  /** segundos na linha do tempo final */
  start: number
  /** segundos, no arquivo de origem */
  inPoint: number
  outPoint: number
  /** 0..2 */
  volume: number
  fadeIn: number
  fadeOut: number
}

export interface ColorAdjust {
  /** -100..100, 0 = neutro */
  brightness: number
  contrast: number
  saturation: number
}

export interface Project {
  version: typeof PROJECT_VERSION
  name: string
  /** fps do projeto — definido pelo 1º clipe de vídeo importado */
  fps: number
  width: number
  height: number
  adjust: ColorAdjust
  media: MediaItem[]
  /** trilha principal: sequencial, magnética, sem buracos */
  videoTrack: VideoClip[]
  /** índice 0 = trilha mais baixa (renderiza primeiro, fica por baixo) */
  overlayTracks: ImageClip[][]
  musicTrack: AudioClip[]
}

/* ------------------------------------------------------------------ */
/* IPC                                                                 */
/* ------------------------------------------------------------------ */

export interface MediaInfo {
  duration: number
  width: number
  height: number
  fps: number
  hasAudio: boolean
  codec: string
  kind: MediaKind
}

export type EncoderName = 'hevc_nvenc' | 'h264_nvenc' | 'av1_nvenc' | 'libx265' | 'libx264'

export interface EncoderSupport {
  hevc_nvenc: boolean
  h264_nvenc: boolean
  av1_nvenc: boolean
}

export type ExportQuality = 'alta' | 'media'

export interface ExportOptions {
  fps: number
  codec: EncoderName
  quality: ExportQuality
  width: number
  height: number
  hwaccel: boolean
  /** caminho do arquivo de script do filter_complex (preenchido pelo main) */
  filterScriptPath: string
  /**
   * Flag usada para carregar o grafo do arquivo. Builds recentes do FFmpeg
   * (2024+) usam `-/filter_complex`; builds antigas usam `-filter_complex_script`.
   * O main detecta e preenche; default é a sintaxe nova.
   */
  filterComplexFlag?: '-/filter_complex' | '-filter_complex_script'
}

export interface ExportProgress {
  jobId: string
  /** 0..1 */
  progress: number
  /** segundos processados na timeline */
  outTime: number
  /** velocidade relativa (1 = tempo real) */
  speed: number
  /** segundos restantes estimados, null quando desconhecido */
  etaSeconds: number | null
}

export interface ExportResult {
  jobId: string
  ok: boolean
  canceled: boolean
  outputPath: string
  /** stderr completo do ffmpeg, para o painel "detalhes" quando falha */
  log: string
  error?: string
}

export interface RecentProject {
  path: string
  name: string
  openedAt: number
}

export interface AutosaveInfo {
  path: string
  name: string
  savedAt: number
}

/** API exposta pelo preload em `window.allgo` */
export interface AllgoApi {
  probeFile(path: string): Promise<MediaInfo>
  generateThumbnails(path: string, count: number, height: number): Promise<string[]>
  generateWaveform(path: string, width: number, height: number): Promise<string | null>
  detectEncoders(): Promise<EncoderSupport>
  ffmpegAvailable(): Promise<boolean>

  startExport(project: Project, outputPath: string, options: Omit<ExportOptions, 'filterScriptPath'>): Promise<string>
  cancelExport(jobId: string): Promise<void>
  onExportProgress(cb: (p: ExportProgress) => void): () => void
  onExportDone(cb: (r: ExportResult) => void): () => void

  openMediaDialog(): Promise<string[]>
  openProjectDialog(): Promise<string | null>
  saveProjectDialog(defaultName: string): Promise<string | null>
  saveVideoDialog(defaultName: string): Promise<string | null>
  savePngDialog(defaultName: string): Promise<string | null>

  readProject(path: string): Promise<Project>
  writeProject(path: string, project: Project): Promise<void>
  writePng(path: string, dataUrl: string): Promise<void>

  autosave(project: Project): Promise<void>
  latestAutosave(): Promise<AutosaveInfo | null>
  readAutosave(path: string): Promise<Project>
  clearAutosave(): Promise<void>

  recentProjects(): Promise<RecentProject[]>
  showInFolder(path: string): Promise<void>
  /** Caminho absoluto de um File arrastado — `File.path` saiu no Electron 32. */
  pathForFile(file: File): string
  pathsExist(paths: string[]): Promise<Record<string, boolean>>
  relocateDialog(name: string): Promise<string | null>

  onMenu(cb: (action: string) => void): () => void

  /** Clique no X / Alt+F4: o main pede ao renderer para confirmar e depois fechar. */
  onCloseRequested(cb: () => void): () => void
  confirmUnsavedChanges(projectName: string): Promise<'save' | 'discard' | 'cancel'>
  confirmAbortExport(): Promise<boolean>
  /** Libera o close guard e fecha a janela de verdade. */
  allowClose(): Promise<void>
}
