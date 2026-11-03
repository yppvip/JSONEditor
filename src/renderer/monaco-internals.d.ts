// Narrow bridge to the pinned Monaco undo service. All normal text edits stay Monaco-owned.
declare module 'monaco-editor/editor/standalone/browser/standaloneServices' {
  export const StandaloneServices: {
    get(identifier: unknown): {
      pushElement(element: {
        type: 0
        resource: import('monaco-editor/editor/editor.api').Uri
        label: string
        code: string
        undo: () => void
        redo: () => void
      }): void
      removeElements(resource: import('monaco-editor/editor/editor.api').Uri): void
    }
  }
}
declare module 'monaco-editor/platform/undoRedo/common/undoRedo' {
  export const IUndoRedoService: unknown
}
declare module 'monaco-editor/editor/contrib/codelens/browser/codeLensCache'
declare module 'monaco-editor/editor/common/services/treeViewsDndService'
declare module 'monaco-editor/editor/contrib/suggest/browser/suggestMemory'
