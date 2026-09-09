import type { TableHTMLAttributes } from 'react'
import './Table.css'

export interface TableProps extends TableHTMLAttributes<HTMLTableElement> {
  /** Alternates row background for readability. */
  striped?: boolean
  /** Adds borders around every cell. */
  bordered?: boolean
}

export function Table({ striped = false, bordered = false, className, ...props }: TableProps) {
  return (
    <div className="ds-table-wrap">
      <table
        className={['ds-table', striped && 'ds-table--striped', bordered && 'ds-table--bordered', className]
          .filter(Boolean)
          .join(' ')}
        {...props}
      />
    </div>
  )
}
