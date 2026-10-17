/** Round icon button with a caption underneath, for the Musical.ly-style side rail. */
export default function RailButton({ icon, label, active = false, disabled = false, onClick }) {
  return (
    <button className={`rail-btn ${active ? 'on' : ''}`} onClick={onClick} disabled={disabled} aria-pressed={active}>
      <span className="rail-icon">{icon}</span>
      <span className="rail-label">{label}</span>
    </button>
  )
}
