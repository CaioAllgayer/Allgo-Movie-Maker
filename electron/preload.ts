import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import type { AllgoApi, ExportProgress, ExportResult, Project } from '@shared/types'

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_e: IpcRendererEvent, payload: T) => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: AllgoApi = {
  probeFile: (path) => ipcRenderer.invoke('media:probe', path),
  generateThumbnails: (path, count, height) => ipcRenderer.invoke('media:thumbnails', path, count, height),
  generateWaveform: (path, width, height) => ipcRenderer.invoke('media:waveform', path, width, height),

  detectEncoders: () => ipcRenderer.invoke('ffmpeg:encoders'),
  ffmpegAvailable: () => ipcRenderer.invoke('ffmpeg:available'),

  startExport: (project, outputPath, options) =>
    ipcRenderer.invoke('export:start', project, outputPath, options),
  cancelExport: (jobId) => ipcRenderer.invoke('export:cancel', jobId),
  onExportProgress: (cb) => subscribe<ExportProgress>('export:progress', cb),
  onExportDone: (cb) => subscribe<ExportResult>('export:done', cb),

  openMediaDialog: () => ipcRenderer.invoke('dialog:openMedia'),
  openProjectDialog: () => ipcRenderer.invoke('dialog:openProject'),
  saveProjectDialog: (defaultName) => ipcRenderer.invoke('dialog:saveProject', defaultName),
  saveVideoDialog: (defaultName) => ipcRenderer.invoke('dialog:saveVideo', defaultName),
  savePngDialog: (defaultName) => ipcRenderer.invoke('dialog:savePng', defaultName),
  relocateDialog: (name) => ipcRenderer.invoke('dialog:relocate', name),

  readProject: (path) => ipcRenderer.invoke('project:read', path),
  writeProject: (path, project: Project) => ipcRenderer.invoke('project:write', path, project),
  writePng: (path, dataUrl) => ipcRenderer.invoke('fs:writePng', path, dataUrl),

  autosave: (project) => ipcRenderer.invoke('project:autosave', project),
  latestAutosave: () => ipcRenderer.invoke('project:latestAutosave'),
  readAutosave: (path) => ipcRenderer.invoke('project:readAutosave', path),
  clearAutosave: () => ipcRenderer.invoke('project:clearAutosave'),

  recentProjects: () => ipcRenderer.invoke('project:recent'),
  showInFolder: (path) => ipcRenderer.invoke('shell:showInFolder', path),
  // `File.path` foi removido no Electron 32; webUtils é o substituto oficial.
  pathForFile: (file) => webUtils.getPathForFile(file),
  pathsExist: (paths) => ipcRenderer.invoke('fs:pathsExist', paths),

  onMenu: (cb) => subscribe<string>('menu:action', cb)
}

contextBridge.exposeInMainWorld('allgo', api)
