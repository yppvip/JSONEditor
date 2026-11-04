// Original local SVG artwork. No remote font, image, or icon runtime is required.
const paths = {
  json: 'M8 3H6a2 2 0 0 0-2 2v4l-2 3 2 3v4a2 2 0 0 0 2 2h2M16 3h2a2 2 0 0 1 2 2v4l2 3-2 3v4a2 2 0 0 1-2 2h-2M10 12h.01M14 12h.01',
  new: 'M14 2H6a2 2 0 0 0-2 2v16h16V8zM14 2v6h6M8 14h8M12 10v8',
  open: 'M3 19V5h6l2 3h10v3M3 19l3-8h16l-3 8z',
  save: 'M19 21H5a2 2 0 0 1-2-2V3h15l3 3v13a2 2 0 0 1-2 2ZM7 3v6h10V3M7 21v-8h10v8',
  format: 'M8 4h13M8 9h9M8 14h13M8 19h9M3 4h.01M3 9h.01M3 14h.01M3 19h.01',
  check: 'm5 12 4 4L19 6',
  undo: 'M9 5 3 11l6 6M3 11h11a6 6 0 0 1 6 6v2',
  redo: 'm15 5 6 6-6 6M21 11H10a6 6 0 0 0-6 6v2',
  copy: 'M9 9h12v12H9zM15 5V3H3v12h2',
  down: 'm6 9 6 6 6-6',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  settings: 'M4 7h16M4 17h16M8 4v6M16 14v6',
  paste: 'M9 4H5v17h14V4h-4M9 2h6v5H9zM8 12h8M8 16h6',
  history: 'M3 4v6h6M3 10a9 9 0 1 1 1 8M12 7v5l3 2',
  info: 'M12 8h.01M12 12v5M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0',
  swap: 'M3 7h17m-4-4 4 4-4 4M21 17H4m4-4-4 4 4 4',
  split: 'M3 4h18v16H3zM12 4v16',
  collapse: 'm8 9 4-4 4 4M8 15l4 4 4-4',
  expand: 'm8 5 4 4 4-4M8 19l4-4 4 4',
  close: 'm6 6 12 12M18 6 6 18',
  drag: 'M8 5h.01M16 5h.01M8 12h.01M16 12h.01M8 19h.01M16 19h.01',
  automatic: 'm4 19 7-14 7 14M7 13h8M20 4v4M18 6h4',
  string: 'M5 5v6H2V5h6M16 5v6h-3V5h6M4 19h16',
  number: 'm9 3-3 18M18 3l-3 18M3 9h18M2 15h18',
  boolean: 'M4 4h16v16H4zM7 12l3 3 7-7',
  null: 'M19 5 5 19M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  array: 'M8 3H4v18h4M16 3h4v18h-4',
  object: 'M9 3H7v6l-3 3 3 3v6h2M15 3h2v6l3 3-3 3v6h-2',
} as const

export type IconName = keyof typeof paths

export function Icon({ name }: { name: IconName }): React.JSX.Element {
  return (
    <svg
      className="icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {name === 'more' ? (
        <>
          <circle cx="5" cy="12" r="1" />
          <circle cx="12" cy="12" r="1" />
          <circle cx="19" cy="12" r="1" />
        </>
      ) : (
        <path d={paths[name]} />
      )}
    </svg>
  )
}
