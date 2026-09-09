import './ScrollHint.css'

export interface ScrollHintProps {
  direction: 'up' | 'down'
  label: string
}

// A persistent (never scrolls away) strip telling the user a scrollable
// list continues in a given direction, with a bouncing chevron so the
// affordance reads at a glance rather than requiring the label text to
// be read. Render it outside the scrollable container, immediately above
// it for 'up' and below it for 'down' — see StartJoinPage.tsx.
export function ScrollHint({ direction, label }: ScrollHintProps) {
  return (
    <div className="ds-scroll-hint" aria-hidden="true">
      <svg
        className={`ds-scroll-hint__chevron ds-scroll-hint__chevron--${direction}`}
        width="14"
        height="14"
        viewBox="0 0 16 16"
        fill="none"
      >
        <path
          d={direction === 'up' ? 'M4 10l4-4 4 4' : 'M4 6l4 4 4-4'}
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span>{label}</span>
    </div>
  )
}
