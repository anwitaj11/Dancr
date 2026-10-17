// Small building blocks for the Dancr look: retro OS windows, stickers,
// polaroids and a scrolling ticker.

export const APP_NAME = 'Dancr'

export function Logo() {
  return (
    <span className="logo">
      <span className="logo-star" aria-hidden="true">✦</span>
      <span>Danc<em>r</em></span>
    </span>
  )
}

/** A retro desktop window with a coloured title bar. */
export function Win({ title, color = 'blue', dots = false, controls = true, extra, className = '', id, children }) {
  return (
    <div id={id} className={`win win-${color} ${className}`}>
      <div className="win-bar">
        {dots && <span className="win-dots" aria-hidden="true"><i /><i /><i /></span>}
        <span className="win-title">{title}</span>
        {extra}
        {controls && <span className="win-ctrl" aria-hidden="true">_ □ ×</span>}
      </div>
      <div className="win-body">{children}</div>
    </div>
  )
}

export function Sticker({ children, color = 'yellow', tilt = -2, className = '' }) {
  return <span className={`sticker sticker-${color} ${className}`} style={{ '--tilt': `${tilt}deg` }}>{children}</span>
}

export function Polaroid({ caption, tilt = 0, badge, active = false, className = '', children, ...rest }) {
  return (
    <div className={`polaroid ${active ? 'active' : ''} ${className}`} style={{ '--tilt': `${tilt}deg` }} {...rest}>
      {badge != null && <span className="polaroid-badge">{badge}</span>}
      <div className="polaroid-photo">{children}</div>
      {caption && <span className="polaroid-caption">{caption}</span>}
    </div>
  )
}

export function Marquee({ text, color = 'yellow' }) {
  const run = Array.from({ length: 6 }, () => `★ ${text} `).join('')
  return (
    <div className={`marquee-band band-${color}`} aria-label={text}>
      <div className="marquee-track" aria-hidden="true"><span>{run}</span><span>{run}</span></div>
    </div>
  )
}

/** Big outlined display headline; `lines` is [[text, colour?], ...]. */
export function Headline({ lines, size = 'xl', as: Tag = 'h1' }) {
  return (
    <Tag className={`headline headline-${size}`}>
      {lines.map(([text, color = 'white', italic], i) => (
        <span key={i} className={`hl hl-${color} ${italic ? 'hl-italic' : ''}`}>{text}</span>
      ))}
    </Tag>
  )
}
