import { Clapperboard, FolderOpen, Redo2, Save, Undo2, Upload } from 'lucide-react'
import { useProject } from '@store/project'
import { useUi } from '@store/ui'

export function TopBar({
  onOpen,
  onSave,
  onExport
}: {
  onOpen: () => void
  onSave: () => void
  onExport: () => void
}) {
  const name = useProject((s) => s.project.name)
  const width = useProject((s) => s.project.width)
  const height = useProject((s) => s.project.height)
  const edit = useProject((s) => s.edit)
  const dirty = useProject((s) => s.dirty)
  const hasClips = useProject((s) => s.project.videoTrack.length > 0)
  const past = useProject((s) => s.past.length)
  const future = useProject((s) => s.future.length)
  const undo = useProject((s) => s.undo)
  const redo = useProject((s) => s.redo)
  const exporting = useUi((s) => s.exportState.jobId !== null)

  return (
    <header className="topbar">
      <div className="logo">
        <span className="mark">
          <Clapperboard size={15} />
        </span>
        Allgo Movie Maker
      </div>
      <span className="project-name">{name}</span>
      {dirty && <span className="dot-dirty" title="Alterações não salvas" />}

      <label className="project-format" title="O formato do projeto define o quadro da prévia e da exportação">
        <span>Formato</span>
        <select
          aria-label="Formato do projeto"
          value={`${width}x${height}`}
          disabled={exporting}
          onChange={(event) => {
            const [nextWidth, nextHeight] = event.target.value.split('x').map(Number)
            if (nextWidth === width && nextHeight === height) return
            edit((project) => {
              project.width = nextWidth
              project.height = nextHeight
            })
          }}
        >
          {!(width === 1920 && height === 1080) && !(width === 1080 && height === 1920) && (
            <option value={`${width}x${height}`}>{width}×{height}</option>
          )}
          <option value="1920x1080">Horizontal · 16:9</option>
          <option value="1080x1920">Reels · 9:16</option>
        </select>
      </label>

      <div className="spacer" />

      <button className="icon-btn" title="Desfazer (Ctrl+Z)" disabled={!past || exporting} onClick={undo}>
        <Undo2 size={16} />
      </button>
      <button className="icon-btn" title="Refazer (Ctrl+Y)" disabled={!future || exporting} onClick={redo}>
        <Redo2 size={16} />
      </button>

      <button className="btn" onClick={onOpen} disabled={exporting}>
        <FolderOpen size={14} /> Abrir
      </button>
      <button className="btn" onClick={onSave} disabled={exporting}>
        <Save size={14} /> Salvar
      </button>
      <button className="btn primary" onClick={onExport} disabled={!hasClips || exporting}>
        <Upload size={14} /> Exportar
      </button>
    </header>
  )
}
