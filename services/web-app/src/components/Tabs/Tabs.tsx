import {
  Tabs as RACTabs,
  TabList as RACTabList,
  Tab as RACTab,
  TabPanel as RACTabPanel,
  type TabsProps,
  type TabListProps,
  type TabProps,
  type TabPanelProps,
} from 'react-aria-components'
import './Tabs.css'

export function Tabs({ className, ...props }: TabsProps) {
  return <RACTabs className={['ds-tabs', className].filter(Boolean).join(' ')} {...props} />
}

export function TabList<T extends object>({ className, ...props }: TabListProps<T>) {
  return <RACTabList className={['ds-tabs__list', className].filter(Boolean).join(' ')} {...props} />
}

export function Tab({ className, ...props }: TabProps) {
  return <RACTab className={['ds-tabs__tab', className].filter(Boolean).join(' ')} {...props} />
}

export function TabPanel({ className, ...props }: TabPanelProps) {
  return <RACTabPanel className={['ds-tabs__panel', className].filter(Boolean).join(' ')} {...props} />
}
