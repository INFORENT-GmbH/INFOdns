import ReactSelect, { type StylesConfig } from 'react-select'

export interface SelectOption {
  value: string
  label: string
}

interface Props {
  value: string
  onChange: (value: string) => void
  options: SelectOption[]
  placeholder?: string
  disabled?: boolean
  /** 'default' — standard form field (bordered); 'ghost' — transparent, blends into text */
  variant?: 'default' | 'ghost'
  style?: React.CSSProperties
}

// Defined outside the component so references are stable across renders.
// react-select bails out of re-rendering only when styles reference is unchanged.
const sharedStyles = {
  menuPortal: (base: object) => ({ ...base, zIndex: 9999 }),
}

const defaultStyles: StylesConfig<SelectOption, false> = {
  ...sharedStyles,
  control: (base, state) => ({
    ...base,
    minHeight: 30,
    fontSize: 'inherit',
    fontFamily: 'inherit',
    border: `1px solid ${state.isFocused ? '#2563eb' : '#e5e7eb'}`,
    boxShadow: state.isFocused ? '0 0 0 2px #bfdbfe' : 'none',
    '&:hover': { borderColor: '#d1d5db' },
    cursor: 'pointer',
    borderRadius: 6,
  }),
  menu: base => ({
    ...base,
    zIndex: 9999,
    fontSize: 'inherit',
    fontFamily: 'inherit',
    borderRadius: 8,
    boxShadow: '0 4px 16px rgba(0,0,0,.1), 0 1px 4px rgba(0,0,0,.06)',
    border: '1px solid #e5e7eb',
  }),
  option: (base, state) => ({
    ...base,
    fontSize: '.8125rem',
    cursor: 'pointer',
    background: state.isSelected ? '#f0fdf4' : state.isFocused ? '#eff6ff' : 'transparent',
    color: state.isSelected ? '#166534' : state.isFocused ? '#1d4ed8' : '#111827',
    fontWeight: state.isSelected ? 600 : 400,
    '&:active': { background: '#eff6ff' },
  }),
  singleValue: base => ({ ...base, color: '#111827', fontFamily: 'inherit' }),
  input: base => ({ ...base, fontFamily: 'inherit', margin: 0, padding: 0 }),
  placeholder: base => ({ ...base, color: '#9ca3af' }),
  indicatorSeparator: () => ({ display: 'none' }),
  dropdownIndicator: base => ({ ...base, padding: '0 6px', color: '#9ca3af' }),
  valueContainer: base => ({ ...base, padding: '0 8px', flexWrap: 'nowrap' }),
}

const ghostStyles: StylesConfig<SelectOption, false> = {
  ...sharedStyles,
  control: (base, state) => ({
    ...base,
    minHeight: 30,
    fontSize: 'inherit',
    fontFamily: 'inherit',
    background: 'transparent',
    border: `1px solid ${state.isFocused ? '#2563eb' : '#d1d5db'}`,
    boxShadow: state.isFocused ? '0 0 0 2px #bfdbfe' : 'none',
    '&:hover': { borderColor: '#9ca3af' },
    cursor: 'pointer',
    borderRadius: 4,
  }),
  menu: base => ({
    ...base,
    zIndex: 9999,
    fontSize: 'inherit',
    fontFamily: 'inherit',
    borderRadius: 8,
    boxShadow: '0 4px 16px rgba(0,0,0,.1), 0 1px 4px rgba(0,0,0,.06)',
    border: '1px solid #e5e7eb',
    minWidth: 180,
  }),
  option: (base, state) => ({
    ...base,
    fontSize: '.8125rem',
    cursor: 'pointer',
    background: state.isSelected ? '#f0fdf4' : state.isFocused ? '#eff6ff' : 'transparent',
    color: state.isSelected ? '#166534' : state.isFocused ? '#1d4ed8' : '#111827',
    fontWeight: state.isSelected ? 600 : 400,
    '&:active': { background: '#eff6ff' },
  }),
  singleValue: base => ({ ...base, color: 'inherit', fontFamily: 'inherit', fontWeight: 600 }),
  input: base => ({ ...base, fontFamily: 'inherit', margin: 0, padding: 0 }),
  placeholder: base => ({ ...base, color: '#9ca3af', fontWeight: 400 }),
  indicatorSeparator: () => ({ display: 'none' }),
  dropdownIndicator: base => ({ ...base, padding: '0 4px', color: '#9ca3af' }),
  valueContainer: base => ({ ...base, padding: '0 2px', flexWrap: 'nowrap' }),
}

export default function Select({
  value, onChange, options, placeholder = '—', disabled,
  variant = 'default', style,
}: Props) {
  const current = options.find(o => o.value === value) ?? null

  return (
    <div style={{ display: 'inline-block', minWidth: variant === 'ghost' ? 160 : undefined, ...style }}>
      <ReactSelect<SelectOption, false>
        value={current}
        onChange={opt => onChange(opt?.value ?? '')}
        options={options}
        placeholder={placeholder}
        isDisabled={disabled}
        isSearchable
        styles={variant === 'ghost' ? ghostStyles : defaultStyles}
        menuPortalTarget={document.body}
        menuPosition="fixed"
      />
    </div>
  )
}
