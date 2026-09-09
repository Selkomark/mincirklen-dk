import { type HTMLAttributes } from 'react'
import './Avatar.css'

export interface AvatarProps extends HTMLAttributes<HTMLDivElement> {
  label: string
  anonymous?: boolean
  size?: 'sm' | 'md' | 'lg'
}

function getInitials(label: string) {
  return label
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('')
}

export function Avatar({ label, anonymous = false, size = 'md', className, ...props }: AvatarProps) {
  return (
    <div
      className={['ds-avatar', `ds-avatar--${size}`, anonymous && 'ds-avatar--anonymous', className]
        .filter(Boolean)
        .join(' ')}
      aria-label={anonymous ? 'Anonymous user' : label}
      role="img"
      {...props}
    >
      {anonymous ? '?' : getInitials(label)}
    </div>
  )
}
