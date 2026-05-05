import type { CSSProperties } from 'react'

interface Props {
  size?: number
  style?: CSSProperties
  title?: string
}

/**
 * Small pencil icon used to indicate that a field is editable.
 *
 * Convention:
 * - Render only when the user actually has permission to edit the field.
 * - Render only when the field is in display mode (hide while the inline editor is open).
 * - Place to the right of the value with a small gap.
 *
 * The icon is muted by default and uses currentColor, so it inherits color from
 * the surrounding text. Wrap the editable element with the
 * `editable-trigger` class to brighten the icon on hover.
 */
export default function EditPencilIcon({ size = 12, style, title }: Props) {
  return (
    <svg
      className="edit-pencil-icon"
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
      style={{
        flexShrink: 0,
        opacity: 0.45,
        transition: 'opacity .12s ease',
        verticalAlign: 'middle',
        ...style,
      }}
    >
      {title && <title>{title}</title>}
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
    </svg>
  )
}
