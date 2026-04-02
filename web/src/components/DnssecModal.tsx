import { useState, useEffect } from 'react'
import { useI18n } from '../i18n/I18nContext'

const MONO = "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"

const ALGO_NAMES: Record<string, string> = {
  '5': 'RSASHA1', '8': 'RSASHA256', '10': 'RSASHA512',
  '13': 'ECDSA256', '14': 'ECDSA384', '15': 'Ed25519', '16': 'Ed448',
}

async function computeDsLine(fqdn: string, flags: string, protocol: string, algorithm: string, keyBase64: string): Promise<string> {
  const name = fqdn.replace(/\.$/, '').toLowerCase()
  const wireBytes: number[] = []
  for (const label of name.split('.')) {
    wireBytes.push(label.length)
    for (const ch of label) wireBytes.push(ch.charCodeAt(0))
  }
  wireBytes.push(0)

  const flagsNum = parseInt(flags, 10)
  const keyBytes = Uint8Array.from(atob(keyBase64), c => c.charCodeAt(0))
  const rdata = new Uint8Array(4 + keyBytes.length)
  rdata[0] = (flagsNum >> 8) & 0xff; rdata[1] = flagsNum & 0xff
  rdata[2] = parseInt(protocol, 10); rdata[3] = parseInt(algorithm, 10)
  rdata.set(keyBytes, 4)

  let ac = 0
  for (let i = 0; i < rdata.length; i++) ac += (i % 2 === 0) ? (rdata[i] << 8) : rdata[i]
  ac += (ac >> 16) & 0xffff
  const keytag = ac & 0xffff

  const nameArr = new Uint8Array(wireBytes)
  const input = new Uint8Array(nameArr.length + rdata.length)
  input.set(nameArr); input.set(rdata, nameArr.length)
  const hashBuf = await window.crypto.subtle.digest('SHA-256', input)
  const digest = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase()

  return `${fqdn}. IN DS ${keytag} ${algorithm} 2 ${digest}`
}

interface Props {
  fqdn: string
  defaultTtl: number
  dnssecDs: string | null
  onDisable: () => void
  disabling: boolean
  onClose: () => void
}

export default function DnssecModal({ fqdn, defaultTtl, dnssecDs, onDisable, disabling, onClose }: Props) {
  const { t } = useI18n()
  const [copied, setCopied] = useState<string | null>(null)
  const [dsLine, setDsLine] = useState<string | null>(null)

  useEffect(() => {
    if (!dnssecDs) { setDsLine(null); return }
    const parts = dnssecDs.split(' ')
    if (parts.length < 4) { setDsLine(null); return }
    const [f, p, a, ...rest] = parts
    computeDsLine(fqdn, f, p, a, rest.join('')).then(setDsLine).catch(() => setDsLine(null))
  }, [dnssecDs, fqdn])

  function copyText(id: string, text: string) {
    navigator.clipboard.writeText(text)
    setCopied(id); setTimeout(() => setCopied(null), 2000)
  }

  const parts = dnssecDs?.split(' ') ?? []
  const [dFlags, dProto, dAlgo] = parts
  const dKey = parts.slice(3).join('')
  const algoLabel = ALGO_NAMES[dAlgo] ? `${ALGO_NAMES[dAlgo]} (${dAlgo})` : dAlgo
  const dnskeyRr = dnssecDs ? `${fqdn}. ${defaultTtl} IN DNSKEY ${dFlags} ${dProto} ${dAlgo} ${dKey}` : null

  const copyRowStyle: React.CSSProperties = { display: 'flex', alignItems: 'baseline', gap: '.75rem' }
  function copyValueStyle(id: string): React.CSSProperties {
    return {
      fontFamily: MONO, fontSize: '.8125rem', color: '#111827', wordBreak: 'break-all', flex: 1,
      background: copied === id ? '#bbf7d0' : '#f3f4f6', borderRadius: 4, padding: '4px 8px', lineHeight: 1.6,
      transition: 'background .2s',
    }
  }
  const copyBtnStyle: React.CSSProperties = {
    flexShrink: 0, fontSize: '.8125rem', padding: '3px 10px', borderRadius: 4,
    border: '1px solid #d1d5db', background: '#fff', color: '#374151', cursor: 'pointer', fontWeight: 500,
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: '1rem' }}
      onClick={onClose}>
      <div style={{ background: '#fff', borderRadius: 8, padding: '1.5rem', width: 680, maxWidth: '100%', boxShadow: '0 8px 32px rgba(0,0,0,.18)', display: 'flex', flexDirection: 'column', gap: '1.25rem', animation: 'modal-in 0.12s ease' }}
        onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0, fontSize: '1.125rem', fontWeight: 700, color: '#111827' }}>{t('dnssec_title', fqdn)}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '1.25rem', cursor: 'pointer', color: '#6b7280', lineHeight: 1 }}>×</button>
        </div>

        {dnssecDs ? (
          <>
            <div>
              <div style={{ display: 'grid', gridTemplateColumns: 'auto auto auto 1fr', gap: '.2rem 1.5rem', alignItems: 'baseline', fontSize: '.8125rem' }}>
                <span style={{ color: '#6b7280', fontWeight: 500 }}>Flags</span>
                <span style={{ color: '#6b7280', fontWeight: 500 }}>Proto</span>
                <span style={{ color: '#6b7280', fontWeight: 500 }}>Algorithm</span>
                <span style={{ color: '#6b7280', fontWeight: 500 }}>Public Key</span>
                <span style={{ fontFamily: MONO }}>{dFlags}</span>
                <span style={{ fontFamily: MONO }}>{dProto}</span>
                <span style={{ fontFamily: MONO }}>{algoLabel}</span>
                <span style={{ fontFamily: MONO, wordBreak: 'break-all' }}>{dKey}</span>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '.6rem' }}>
              <div style={copyRowStyle}>
                <span style={{ color: '#6b7280', fontWeight: 500, fontSize: '.8125rem', flexShrink: 0, minWidth: 88 }}>DNSKEY RR</span>
                <span style={copyValueStyle('dnskey')}>{dnskeyRr}</span>
                <button style={copyBtnStyle} onClick={() => copyText('dnskey', dnskeyRr!)}>
                  {copied === 'dnskey' ? t('dnssec_copied') : t('dnssec_copy')}
                </button>
              </div>
              <div style={copyRowStyle}>
                <span style={{ color: '#6b7280', fontWeight: 500, fontSize: '.8125rem', flexShrink: 0, minWidth: 88 }}>DS Record</span>
                <span style={copyValueStyle('ds')}>{dsLine ?? t('dnssec_computing')}</span>
                <button style={copyBtnStyle} disabled={!dsLine} onClick={() => dsLine && copyText('ds', dsLine)}>
                  {copied === 'ds' ? t('dnssec_copied') : t('dnssec_copy')}
                </button>
              </div>
            </div>
          </>
        ) : (
          <p style={{ margin: 0, fontSize: '.8125rem', color: '#6b7280' }}>
            {t('dnssec_signing')}
          </p>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '.5rem', paddingTop: '.25rem', borderTop: '1px solid #e5e7eb' }}>
          <button onClick={onDisable} disabled={disabling} style={{ padding: '6px 16px', borderRadius: 5, border: '1px solid #fca5a5', background: '#fff', color: '#dc2626', cursor: 'pointer', fontSize: '.875rem', fontWeight: 500 }}>
            {disabling ? '…' : t('dnssec_disable')}
          </button>
          <button onClick={onClose} style={{ padding: '6px 16px', borderRadius: 5, border: '1px solid #d1d5db', background: '#fff', color: '#374151', cursor: 'pointer', fontSize: '.875rem', fontWeight: 500 }}>
            {t('close')}
          </button>
        </div>
      </div>
    </div>
  )
}
