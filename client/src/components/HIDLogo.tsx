import React from 'react'

interface Props { size?: 'sm' | 'md' | 'lg'; showText?: boolean }
const S = { sm:{img:30,name:15,sub:7.5,gap:9}, md:{img:38,name:19,sub:8.5,gap:11}, lg:{img:52,name:26,sub:10,gap:14} }

export function HIDLogo({ size='md', showText=true }: Props) {
  const s = S[size]
  return (
    <div style={{ display:'flex', alignItems:'center', gap:s.gap, flexShrink:0 }}>
      <img src="/hid-logo.png" alt="HID" style={{ width:s.img, height:'auto', display:'block' }}/>
      {showText && (
        <div style={{ display:'flex', flexDirection:'column', lineHeight:1 }}>
          <span style={{ fontSize:s.name, fontWeight:800, color:'#111827', letterSpacing:'-.5px' }}>HID</span>
          <span style={{ fontSize:s.sub, fontWeight:700, color:'#9ca3af', letterSpacing:'.6px', marginTop:3, textTransform:'uppercase' as const }}>
            Health Identity Directory
          </span>
        </div>
      )}
    </div>
  )
}
