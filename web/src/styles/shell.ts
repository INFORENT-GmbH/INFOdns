import type { CSSProperties } from 'react'

export const panel: CSSProperties = {
  background: '#fff',
  border: '1px solid #e2e8f0',
  borderRadius: 6,
  overflow: 'hidden',
}

export const pageBar: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '.75rem',
  marginBottom: '1rem',
  flexWrap: 'wrap',
}

export const pageTitle: CSSProperties = {
  fontSize: '.9375rem',
  fontWeight: 700,
  color: '#1e293b',
  margin: 0,
}

export const filterBar: CSSProperties = {
  display: 'flex',
  gap: '.5rem',
  padding: '.5rem .75rem',
  borderBottom: '1px solid #e2e8f0',
  background: '#f8fafc',
  flexWrap: 'wrap',
  alignItems: 'center',
}

export const th: CSSProperties = {
  padding: '.5rem .75rem',
  fontSize: '.6875rem',
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '.04em',
  color: '#64748b',
  background: '#f8fafc',
  borderBottom: '1px solid #e2e8f0',
  textAlign: 'left',
  whiteSpace: 'nowrap',
}

export const td: CSSProperties = {
  padding: '.4375rem .75rem',
  fontSize: '.8125rem',
  color: '#1e293b',
  borderBottom: '1px solid #f1f5f9',
  verticalAlign: 'middle',
}

export const countBadge: CSSProperties = {
  background: '#e2e8f0',
  color: '#475569',
  borderRadius: 4,
  padding: '1px 7px',
  fontSize: '.75rem',
  fontWeight: 600,
}

export const actionBtn: CSSProperties = {
  background: '#2563eb',
  color: '#fff',
  border: 'none',
  borderRadius: 4,
  padding: '.3125rem .75rem',
  fontSize: '.8125rem',
  fontWeight: 500,
  cursor: 'pointer',
}

export const secondaryBtn: CSSProperties = {
  background: '#fff',
  color: '#374151',
  border: '1px solid #d1d5db',
  borderRadius: 4,
  padding: '.3125rem .75rem',
  fontSize: '.8125rem',
  fontWeight: 500,
  cursor: 'pointer',
}

export const tableWrap: CSSProperties = {
  overflowX: 'auto',
  width: '100%',
}
