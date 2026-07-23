import { AudioLines, FileVideo, Image as ImageIcon, Plus, RefreshCw, X } from 'lucide-react'
import type { MediaItem } from '@shared/types'
import { formatShort } from '@engine/clock'
import { mediaUrl } from '@engine/media'
import { useProject } from '@store/project'
import { useUi } from '@store/ui'

const DRAG_MIME = 'application/x-allgo-media'

export function MediaBin({ onImport }: { onImport: () => void }) {
  const media = useProject((s) => s.project.media)
  const toast = useUi((s) => s.toast)

  const relocate = async (item: MediaItem) => {
    const path = await window.allgo.relocateDialog(item.name)
    if (!path) return
    useProject.getState().relocateMedia(item.id, path)
    toast(`"${item.name}" relocalizado.`, 'success')
  }

  return (
    <aside className="panel left-panel">
      <div className="panel-header">
        <span>Mídia</span>
        <button className="icon-btn" title="Importar arquivos" onClick={onImport}>
          <Plus size={15} />
        </button>
      </div>
      <div className="panel-body">
        {media.length === 0 ? (
          <div className="empty-state">
            <FileVideo className="big" size={30} strokeWidth={1.2} />
            Arraste vídeos, PNGs e músicas para a janela — ou clique no <b>+</b>.
          </div>
        ) : (
          <div className="media-list">
            {media.map((item) => (
              <div
                key={item.id}
                className={`media-item${item.missing ? ' missing' : ''}`}
                draggable={!item.missing}
                onDragStart={(e) => {
                  e.dataTransfer.setData(DRAG_MIME, item.id)
                  e.dataTransfer.effectAllowed = 'copy'
                }}
                onDoubleClick={() => addToTimeline(item)}
                title={item.path}
              >
                {item.thumbnail && !item.missing ? (
                  <img className="thumb" src={mediaUrl(item.thumbnail)} alt="" draggable={false} />
                ) : (
                  <div className="thumb">{iconFor(item)}</div>
                )}
                <div className="meta">
                  <div className="name">{item.name}</div>
                  <div className="sub">
                    {item.missing ? (
                      <span style={{ color: 'var(--danger)' }}>arquivo não encontrado</span>
                    ) : (
                      <>
                        {item.duration ? <span>{formatShort(item.duration)}</span> : null}
                        {item.width ? <span>{item.width}×{item.height}</span> : null}
                      </>
                    )}
                  </div>
                </div>
                {item.missing ? (
                  <button className="icon-btn" title="Relocalizar" onClick={() => relocate(item)}>
                    <RefreshCw size={14} />
                  </button>
                ) : (
                  <button
                    className="icon-btn remove"
                    title="Remover da biblioteca"
                    onClick={() => useProject.getState().removeMedia(item.id)}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </aside>
  )
}

function iconFor(item: MediaItem) {
  if (item.kind === 'image') return <ImageIcon size={16} />
  if (item.kind === 'audio') return <AudioLines size={16} />
  return <FileVideo size={16} />
}

/** Duplo clique manda a mídia direto para o fim da trilha certa. */
function addToTimeline(item: MediaItem): void {
  const store = useProject.getState()
  const select = useUi.getState().select
  if (item.kind === 'video') {
    const id = store.appendVideoClip(item.id)
    if (id) select({ type: 'video', id })
  } else if (item.kind === 'image') {
    const id = store.addImageClip(item.id, 0, 0)
    if (id) select({ type: 'image', id })
  } else {
    const id = store.addAudioClip(item.id, 0)
    if (id) select({ type: 'audio', id })
  }
}
