import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface Props {
  tip: string
  children?: ReactNode
  className?: string
  style?: React.CSSProperties
}

export default function Tooltip({ tip, children, className, style }: Props) {
  const ref = useRef<HTMLSpanElement>(null)
  const [show, setShow] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 })

  useLayoutEffect(() => {
    if (!show || !ref.current) return
    const r = ref.current.getBoundingClientRect()
    setPos({ top: r.top - 5, left: r.left + r.width / 2 })
  }, [show])

  return (
    <>
      <span
        ref={ref}
        className={className}
        style={style}
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
      >
        {children}
      </span>
      {show && createPortal(
        <div style={{
          position: 'fixed',
          top: pos.top,
          left: pos.left,
          transform: 'translate(-50%, -100%)',
          background: '#0f172a',
          color: '#f8fafc',
          padding: '.25rem .5rem',
          borderRadius: 4,
          fontSize: '.7rem',
          fontWeight: 400,
          border: '1px solid #1e293b',
          maxWidth: 240,
          width: 'max-content',
          whiteSpace: 'normal',
          wordBreak: 'break-word',
          lineHeight: 1.35,
          pointerEvents: 'none',
          zIndex: 9999,
        }}>{tip}</div>,
        document.body,
      )}
    </>
  )
}
