import type { DateValue } from 'react-aria-components'
import {
  Calendar as RACCalendar,
  CalendarGrid,
  CalendarGridHeader,
  CalendarHeaderCell,
  CalendarGridBody,
  CalendarCell,
  Button,
  Heading,
  type CalendarProps as RACCalendarProps,
} from 'react-aria-components'
import './Calendar.css'

export interface CalendarProps<T extends DateValue> extends Omit<RACCalendarProps<T>, 'className'> {
  className?: string
}

export function Calendar<T extends DateValue>({ className, ...props }: CalendarProps<T>) {
  return (
    <RACCalendar className={['ds-calendar', className].filter(Boolean).join(' ')} {...props}>
      <header className="ds-calendar__header">
        <Button slot="previous" className="ds-calendar__nav">
          ‹
        </Button>
        <Heading className="ds-calendar__title" />
        <Button slot="next" className="ds-calendar__nav">
          ›
        </Button>
      </header>
      <CalendarGrid className="ds-calendar__grid">
        <CalendarGridHeader>
          {(day) => <CalendarHeaderCell className="ds-calendar__weekday">{day}</CalendarHeaderCell>}
        </CalendarGridHeader>
        <CalendarGridBody>
          {(date) => <CalendarCell date={date} className="ds-calendar__cell" />}
        </CalendarGridBody>
      </CalendarGrid>
    </RACCalendar>
  )
}
