import type { HTMLAttributes, ReactNode } from 'react'
import { Avatar } from '../Avatar'
import './Testimonial.css'

export interface TestimonialProps extends HTMLAttributes<HTMLDivElement> {
  quote: ReactNode
  name: string
  role?: string
  anonymous?: boolean
}

export function Testimonial({ quote, name, role, anonymous = false, className, ...props }: TestimonialProps) {
  return (
    <div className={['ds-testimonial', className].filter(Boolean).join(' ')} {...props}>
      <p className="ds-testimonial__quote">"{quote}"</p>
      <div className="ds-testimonial__byline">
        <Avatar label={name} anonymous={anonymous} size="sm" />
        <div>
          <div className="ds-testimonial__name">{anonymous ? 'Anonymous' : name}</div>
          {role && <div className="ds-testimonial__role">{role}</div>}
        </div>
      </div>
    </div>
  )
}
