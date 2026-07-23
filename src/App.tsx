import { useCallback, useEffect, useRef, useState } from 'react'
import type { Project } from '@shared/types'
import { clock } from '@engine/clock'
import { importPaths } from '@engine/media'
import { captureRegistry } from '@engine/capture'
import { emptyProject, useProject } from '@store/project'
import { useUi } from '@store/ui'
import { TopBar } from '@components/TopBar'
import { MediaBin } from '@components/MediaBin'
import { Preview } from '@components/Preview'
import { PropertiesPanel } from '@components/PropertiesPanel'
import { Timeline } from '@components/Timeline'
import { ExportModal } from '@components/ExportModal'
import { Welcome } from '@components/Welcome'
import { Toasts } from '@components/Toasts'

const AUTOSAVE_INTERVAL = 30_000

export default function App() {
  const project = useProject((s) => s.project)
  const dirty = useProject((s) => s.dirty)
  const filePath = useProject((s) => s.filePath)
  const toast = useUi((s) => s.toast)
  const setShowExportModal = useUi((s) => s.setShowExportModal)
  const exporting = useUi((s) => s.exportState.jobId !== null)
  const [dropping, setDropping] = useState(false)
  const [busy, setBusy] = useState(false)

  const isEmpty = project.media.length === 0 && project.videoTrack.length === 0

  /* ------------------------------------------------------------------ */
  /* Importação                                                          */
  /* ------------------------------------------------------------------ */

  const importFiles = useCallback(
    async (paths: string[]) => {
      if (!paths.length) return
      setBusy(true)
      try {
        const { items, errors } = await importPaths(paths)
        if (items.length) useProject.getState().addMedia(items)
        for (const message of errors) toast(message, 'error')
        if (items.length) toast(`${items.length} arquivo(s) importado(s).`, 'success')
      } finally {
        setBusy(false)
      }
    },
    [toast]
  )

  const pickFiles = useCallback(async () => {
    const paths = await window.allgo.openMediaDialog()
    await importFiles(paths)
  }, [importFiles])

  /* ------------------------------------------------------------------ */
  /* Projeto: abrir / salvar                                             */
  /* ------------------------------------------------------------------ */

  const checkMissingMedia = useCallback(
    async (loaded: Project) => {
      const paths = loaded.media.map((m) => m.path)
      if (!paths.length) return
      const exists = await window.allgo.pathsExist(paths)
      const missing = loaded.media.filter((m) => !exists[m.path])
      if (!missing.length) return
      useProject.getState().update((p) => {
        for (const item of p.media) item.missing = !exists[item.path]
      })
      toast(
        `${missing.length} arquivo(s) de mídia não foram encontrados. Use "Relocalizar" no painel de mídia.`,
        'error'
      )
    },
    [toast]
  )

  const openPath = useCallback(
    async (path: string) => {
      try {
        const loaded = await window.allgo.readProject(path)
        useProject.getState().load(loaded, path)
        clock.setPlaying(false)
        clock.setTime(0)
        await checkMissingMedia(loaded)
      } catch (err) {
        toast(`Não foi possível abrir o projeto: ${(err as Error).message}`, 'error')
      }
    },
    [checkMissingMedia, toast]
  )

  const openProject = useCallback(async () => {
    const path = await window.allgo.openProjectDialog()
    if (path) await openPath(path)
  }, [openPath])

  const saveProject = useCallback(
    async (forceDialog = false) => {
      const state = useProject.getState()
      let path = forceDialog ? null : state.filePath
      if (!path) {
        path = await window.allgo.saveProjectDialog(state.project.name || 'projeto')
        if (!path) return
      }
      const name = (path.split(/[\\/]/).pop() ?? 'projeto').replace(/\.allgo$/i, '')
      state.update((p) => {
        p.name = name
      })
      await window.allgo.writeProject(path, useProject.getState().project)
      useProject.getState().markSaved(path)
      toast('Projeto salvo.', 'success')
    },
    [toast]
  )

  /* ------------------------------------------------------------------ */
  /* Autosave e restauração de sessão                                    */
  /* ------------------------------------------------------------------ */

  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty

  useEffect(() => {
    const id = setInterval(() => {
      if (!dirtyRef.current) return
      const current = useProject.getState().project
      if (!current.media.length && !current.videoTrack.length) return
      void window.allgo.autosave(current)
    }, AUTOSAVE_INTERVAL)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    let canceled = false
    window.allgo
      .latestAutosave()
      .then((info) => {
        if (canceled || !info) return
        const state = useProject.getState()
        if (state.project.media.length || state.project.videoTrack.length) return
        toast(`Sessão anterior encontrada ("${info.name}").`, 'info', {
          label: 'Restaurar',
          run: async () => {
            const restored = await window.allgo.readAutosave(info.path)
            useProject.getState().load(restored, null)
            await checkMissingMedia(restored)
          }
        })
      })
      .catch(() => undefined)
    return () => {
      canceled = true
    }
  }, [checkMissingMedia, toast])

  /* ------------------------------------------------------------------ */
  /* Detecção de FFmpeg e encoders                                       */
  /* ------------------------------------------------------------------ */

  useEffect(() => {
    window.allgo
      .ffmpegAvailable()
      .then((ok) => {
        useUi.getState().setFfmpegOk(ok)
        if (!ok) {
          toast('FFmpeg não encontrado. Rode "npm run setup" para baixar os binários.', 'error')
          return
        }
        return window.allgo.detectEncoders().then((encoders) => useUi.getState().setEncoders(encoders))
      })
      .catch(() => undefined)
  }, [toast])

  /* ------------------------------------------------------------------ */
  /* Drag & drop de arquivos na janela                                   */
  /* ------------------------------------------------------------------ */

  useEffect(() => {
    const hasFiles = (event: DragEvent) => Boolean(event.dataTransfer?.types.includes('Files'))

    const onDragOver = (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      setDropping(true)
    }
    const onDragLeave = (event: DragEvent) => {
      if (event.relatedTarget === null) setDropping(false)
    }
    const onDrop = (event: DragEvent) => {
      if (!hasFiles(event)) return
      event.preventDefault()
      setDropping(false)
      const files = Array.from(event.dataTransfer?.files ?? [])
      const paths = files.map((file) => window.allgo.pathForFile(file)).filter(Boolean)
      void importFiles(paths)
    }

    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [importFiles])

  /* ------------------------------------------------------------------ */
  /* Atalhos                                                             */
  /* ------------------------------------------------------------------ */

  const captureFrame = useCallback(async () => {
    const dataUrl = captureRegistry.capture?.()
    if (!dataUrl) {
      toast('Não foi possível capturar o frame.', 'error')
      return
    }
    const path = await window.allgo.savePngDialog(`${project.name || 'frame'}-frame`)
    if (!path) return
    await window.allgo.writePng(path, dataUrl)
    toast('Frame salvo.', 'success', {
      label: 'Abrir pasta',
      run: () => void window.allgo.showInFolder(path)
    })
  }, [project.name, toast])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
      if (exporting) return

      const ui = useUi.getState()
      const store = useProject.getState()
      const fps = store.project.fps || 30
      const ctrl = event.ctrlKey || event.metaKey

      if (ctrl && event.shiftKey && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void captureFrame()
        return
      }
      if (ctrl) {
        switch (event.key.toLowerCase()) {
          case 's':
            event.preventDefault()
            void saveProject()
            return
          case 'e':
            event.preventDefault()
            setShowExportModal(true)
            return
          case 'o':
            event.preventDefault()
            void openProject()
            return
          case 'z':
            event.preventDefault()
            if (event.shiftKey) store.redo()
            else store.undo()
            return
          case 'y':
            event.preventDefault()
            store.redo()
            return
          default:
            return
        }
      }

      switch (event.key) {
        case ' ':
          event.preventDefault()
          clock.setPlaying(!clock.playing)
          break
        case 's':
        case 'S':
          event.preventDefault()
          store.splitAt(clock.time)
          break
        case 'Delete':
        case 'Backspace': {
          const selection = ui.selection
          if (selection.type === 'video' || selection.type === 'image' || selection.type === 'audio') {
            event.preventDefault()
            store.removeClip(selection.id)
            ui.select({ type: 'none' })
          }
          break
        }
        case 'ArrowLeft':
          event.preventDefault()
          clock.setPlaying(false)
          clock.setTime(clock.time - (event.shiftKey ? 1 : 1 / fps))
          break
        case 'ArrowRight':
          event.preventDefault()
          clock.setPlaying(false)
          clock.setTime(clock.time + (event.shiftKey ? 1 : 1 / fps))
          break
        case 'Home':
          event.preventDefault()
          clock.setTime(0)
          break
        case 'End':
          event.preventDefault()
          clock.setTime(clock.duration)
          break
        case '+':
        case '=':
          event.preventDefault()
          ui.setZoom(ui.zoom * 1.25)
          break
        case '-':
        case '_':
          event.preventDefault()
          ui.setZoom(ui.zoom / 1.25)
          break
        default:
          break
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [captureFrame, exporting, openProject, saveProject, setShowExportModal])

  /* ------------------------------------------------------------------ */
  /* Aviso ao fechar com alterações não salvas                           */
  /* ------------------------------------------------------------------ */

  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return
      // O autosave já rodou; isso é só a rede de segurança final.
      void window.allgo.autosave(useProject.getState().project)
      event.preventDefault()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  return (
    <div className="app">
      <TopBar
        onOpen={() => void openProject()}
        onSave={() => void saveProject()}
        onExport={() => setShowExportModal(true)}
      />

      <div className="workspace">
        <MediaBin onImport={() => void pickFiles()} />
        <div className="center">
          <Preview />
        </div>
        <PropertiesPanel />
      </div>

      <Timeline />

      {isEmpty && (
        <Welcome
          onImport={() => void pickFiles()}
          onOpen={() => void openProject()}
          onOpenPath={(path) => void openPath(path)}
        />
      )}

      {dropping && <div className="drop-overlay">Solte os arquivos para importar</div>}
      {busy && <div className="drop-overlay">Analisando mídia…</div>}
      {exporting && <div className="export-blocker" />}

      <ExportModal />
      <Toasts />
    </div>
  )
}
