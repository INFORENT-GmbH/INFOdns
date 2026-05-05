import ReactSelect, { type GroupBase, type StylesConfig, type MultiValue } from 'react-select'
import type { CSSProperties } from 'react'

export interface MultiSelectOption {
  value: string
  label: string
}

interface Props {
  values: string[]
  onChange: (values: string[]) => void
  options: ReadonlyArray<MultiSelectOption>
  placeholder?: string
  disabled?: boolean
  style?: CSSProperties
}

const styles: StylesConfig<MultiSelectOption, true, GroupBase<MultiSelectOption>> = {
  menuPortal: (base: object) => ({ ...base, zIndex: 9999 }),
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
  multiValue: base => ({ ...base, background: '#e0e7ff', borderRadius: 4 }),
  multiValueLabel: base => ({ ...base, color: '#3730a3', fontSize: '.75rem', padding: '2px 6px' }),
  multiValueRemove: base => ({
    ...base, color: '#3730a3',
    ':hover': { background: '#c7d2fe', color: '#1e1b4b' },
  }),
  input: base => ({ ...base, fontFamily: 'inherit', margin: 0, padding: 0 }),
  placeholder: base => ({ ...base, color: '#9ca3af' }),
  indicatorSeparator: () => ({ display: 'none' }),
  dropdownIndicator: base => ({ ...base, padding: '0 6px', color: '#9ca3af' }),
  valueContainer: base => ({ ...base, padding: '2px 6px' }),
}

export default function MultiSelect({
  values, onChange, options, placeholder = 'Auswählen…', disabled, style,
}: Props) {
  const selected = options.filter(o => values.includes(o.value))
  return (
    <div style={{ display: 'inline-block', minWidth: 200, ...style }}>
      <ReactSelect<MultiSelectOption, true, GroupBase<MultiSelectOption>>
        isMulti
        value={selected}
        onChange={(opts: MultiValue<MultiSelectOption>) => onChange(opts.map(o => o.value))}
        options={options as MultiSelectOption[]}
        placeholder={placeholder}
        isDisabled={disabled}
        isSearchable
        styles={styles}
        menuPortalTarget={document.body}
        menuPosition="fixed"
        closeMenuOnSelect={false}
      />
    </div>
  )
}
