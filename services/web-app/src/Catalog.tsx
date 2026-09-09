import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import './Catalog.css'
import { Button } from './components/Button'
import { Card } from './components/Card'
import { Badge } from './components/Badge'
import { Alert } from './components/Alert'
import { Avatar } from './components/Avatar'
import { TextField } from './components/TextField'
import { Textarea } from './components/Textarea'
import { IconButton } from './components/IconButton'
import { Checkbox } from './components/Checkbox'
import { RadioGroup, Radio } from './components/RadioGroup'
import { Switch } from './components/Switch'
import { Select, SelectItem } from './components/Select'
import { Modal, DialogTrigger } from './components/Modal'
import { ThemeToggle } from './ThemeToggle'
import { Tooltip, TooltipTrigger } from './components/Tooltip'
import { addToast } from './components/Toast'
import { Tabs, TabList, Tab, TabPanel } from './components/Tabs'
import { Accordion, AccordionItem } from './components/Accordion'
import { Menu, MenuItem } from './components/Menu'
import { Calendar } from './components/Calendar'
import { DatePicker } from './components/DatePicker'
import { TimePicker } from './components/TimePicker'
import { ColorPicker } from './components/ColorPicker'
import { useDocumentTitle } from './useDocumentTitle'
import { CodeEditor } from './components/CodeEditor'
import { Container } from './components/Container'
import { Row } from './components/Row'
import { Col } from './components/Col'
import { Heading } from './components/Heading'
import { Text } from './components/Text'
import { Blockquote } from './components/Blockquote'
import { List } from './components/List'
import { Table } from './components/Table'
import { Figure } from './components/Figure'
import { Section } from './components/Section'
import { Navbar } from './components/Navbar'
import { Hero } from './components/Hero'
import { Feature } from './components/Feature'
import { Testimonial } from './components/Testimonial'
import { Stat } from './components/Stat'
import { CTASection } from './components/CTASection'
import { PricingCard } from './components/PricingCard'
import { Footer, FooterColumn } from './components/Footer'

interface PropRow {
  name: string
  type: string
  default?: string
  description: string
}

interface CatalogEntry {
  name: string
  group: string
  description: string
  render: () => ReactNode
  props: PropRow[]
  /** Heading above the props table — defaults to "Props"; utility pages use "Classes". */
  propsHeading?: string
  code: string
}

function PropsTable({ rows }: { rows: PropRow[] }) {
  return (
    <div className="cat-table-wrap">
      <table className="cat-table">
        <thead>
          <tr>
            <th>Prop</th>
            <th>Type</th>
            <th>Default</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.name}>
              <td>
                <code>{row.name}</code>
              </td>
              <td className="cat-table__type">{row.type}</td>
              <td className="cat-table__default">{row.default ?? '—'}</td>
              <td>{row.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function CodeBlock({ code }: { code: string }) {
  return (
    <pre className="cat-code">
      <code>{code.trim()}</code>
    </pre>
  )
}

const entries: CatalogEntry[] = [
  {
    name: 'Button',
    group: 'Actions',
    description: 'Primary interactive control. `urgent` is reserved for crisis/report/destructive actions only.',
    render: () => (
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Button variant="safe">Join session</Button>
        <Button variant="secondary">Learn more</Button>
        <Button variant="ghost">Skip for now</Button>
        <Button variant="urgent">Report</Button>
      </div>
    ),
    props: [
      { name: 'variant', type: "'safe' | 'secondary' | 'ghost' | 'urgent'", default: "'safe'", description: 'Visual style + semantic intent.' },
      { name: 'children', type: 'ReactNode', description: 'Button label.' },
      { name: '...rest', type: 'ButtonHTMLAttributes', description: 'Native button props (onClick, disabled, type, etc).' },
    ],
    code: `<Button variant="safe">Join session</Button>`,
  },
  {
    name: 'IconButton',
    group: 'Actions',
    description: 'Icon-only control for compact actions (theme toggle, leave session). Always requires a `label` for a11y.',
    render: () => (
      <div style={{ display: 'flex', gap: 12 }}>
        <IconButton icon="☾" label="Toggle theme" />
        <IconButton icon="✕" label="Leave session" variant="urgent" />
      </div>
    ),
    props: [
      { name: 'icon', type: 'ReactNode', description: 'Icon content (emoji, svg, etc).' },
      { name: 'label', type: 'string', description: 'Accessible name — also shown as a tooltip title.' },
      { name: 'variant', type: "'default' | 'urgent'", default: "'default'", description: 'Visual style.' },
    ],
    code: `<IconButton icon="✕" label="Leave session" variant="urgent" />`,
  },
  {
    name: 'Card',
    group: 'Data display',
    description: 'Raised surface container for grouping related content.',
    render: () => (
      <Card>
        <div style={{ fontWeight: 600 }}>Weekly circle</div>
        <p style={{ margin: 0, color: 'var(--text-secondary)' }}>Tuesdays, 7pm — 6 users</p>
      </Card>
    ),
    props: [
      { name: 'padded', type: 'boolean', default: 'true', description: 'Adds internal padding + vertical gap.' },
      { name: 'children', type: 'ReactNode', description: 'Card content.' },
    ],
    code: `<Card>\n  <div>Weekly circle</div>\n</Card>`,
  },
  {
    name: 'Avatar',
    group: 'Data display',
    description: 'User identity. `anonymous` is the default for peer users unless a real display name is explicit product intent.',
    render: () => (
      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <Avatar label="Jordan Lee" size="sm" />
        <Avatar label="Jordan Lee" size="md" />
        <Avatar label="Jordan Lee" size="lg" />
        <Avatar label="Anonymous" anonymous />
      </div>
    ),
    props: [
      { name: 'label', type: 'string', description: 'Full name (used for initials) or accessible label.' },
      { name: 'anonymous', type: 'boolean', default: 'false', description: 'Shows a neutral "?" instead of initials.' },
      { name: 'size', type: "'sm' | 'md' | 'lg'", default: "'md'", description: 'Diameter.' },
    ],
    code: `<Avatar label="Anonymous" anonymous />`,
  },
  {
    name: 'Badge',
    group: 'Feedback',
    description: 'Small status pill.',
    render: () => (
      <div style={{ display: 'flex', gap: 12 }}>
        <Badge variant="neutral">Away</Badge>
        <Badge variant="safe">Online</Badge>
        <Badge variant="info">New</Badge>
        <Badge variant="urgent">Reported</Badge>
      </div>
    ),
    props: [{ name: 'variant', type: "'neutral' | 'safe' | 'info' | 'urgent'", default: "'neutral'", description: 'Status color.' }],
    code: `<Badge variant="safe">Online</Badge>`,
  },
  {
    name: 'Alert',
    group: 'Feedback',
    description: 'Inline banner for moderation notices and crisis messaging.',
    render: () => (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Alert variant="safe">You're in a moderated space.</Alert>
        <Alert variant="urgent">If you're in crisis, leave this session and contact emergency services.</Alert>
      </div>
    ),
    props: [
      { name: 'variant', type: "'info' | 'safe' | 'urgent'", default: "'info'", description: 'Tone — urgent is reserved for crisis/safety messaging.' },
      { name: 'icon', type: 'ReactNode', description: 'Optional leading icon.' },
    ],
    code: `<Alert variant="urgent">If you're in crisis, leave this session.</Alert>`,
  },
  {
    name: 'Toast',
    group: 'Feedback',
    description: 'Transient notification queue. Mount `<ToastRegionRoot />` once at the app root, then call `addToast()` anywhere.',
    render: () => (
      <div style={{ display: 'flex', gap: 12 }}>
        <Button variant="secondary" onClick={() => addToast('Saved', { variant: 'safe' })}>
          Show safe toast
        </Button>
        <Button variant="secondary" onClick={() => addToast('Someone reported this message', { variant: 'urgent' })}>
          Show urgent toast
        </Button>
      </div>
    ),
    props: [
      { name: 'addToast(title, opts?)', type: 'function', description: 'Queues a toast. `opts.variant`: info/safe/urgent. `opts.timeout`: ms (default 5000).' },
      { name: '<ToastRegionRoot />', type: 'component', description: 'Renders the queue — mount once, at the app root.' },
    ],
    code: `// once, at the app root:\n<ToastRegionRoot />\n\n// anywhere:\naddToast('Saved', { variant: 'safe' })`,
  },
  {
    name: 'Tooltip',
    group: 'Feedback',
    description: 'Hover/focus hint. Wrap the trigger and tooltip in `TooltipTrigger`.',
    render: () => (
      <TooltipTrigger>
        <IconButton icon="?" label="What is this?" />
        <Tooltip>Only visible to this circle</Tooltip>
      </TooltipTrigger>
    ),
    props: [{ name: 'children', type: 'ReactNode', description: 'Tooltip text.' }],
    code: `<TooltipTrigger>\n  <IconButton icon="?" label="Info" />\n  <Tooltip>Only visible to this circle</Tooltip>\n</TooltipTrigger>`,
  },
  {
    name: 'TextField',
    group: 'Forms',
    description: 'Single-line text input with label + optional hint.',
    render: () => <TextField label="Share something" hint="Only visible to this circle" placeholder="Type here..." />,
    props: [
      { name: 'label', type: 'string', description: 'Field label.' },
      { name: 'hint', type: 'string', description: 'Helper text below the input.' },
    ],
    code: `<TextField label="Share something" hint="Only visible to this circle" />`,
  },
  {
    name: 'Textarea',
    group: 'Forms',
    description: 'Multi-line text input, same pattern as TextField.',
    render: () => <Textarea label="Tell us more" hint="Optional" placeholder="Type here..." />,
    props: [
      { name: 'label', type: 'string', description: 'Field label.' },
      { name: 'hint', type: 'string', description: 'Helper text below the textarea.' },
      { name: 'rows', type: 'number', default: '4', description: 'Visible row count.' },
    ],
    code: `<Textarea label="Tell us more" rows={4} />`,
  },
  {
    name: 'Checkbox',
    group: 'Forms',
    description: 'Boolean control, supports indeterminate.',
    render: () => <Checkbox defaultSelected>I understand the guidelines</Checkbox>,
    props: [
      { name: 'isSelected / defaultSelected', type: 'boolean', description: 'Controlled / uncontrolled checked state.' },
      { name: 'isIndeterminate', type: 'boolean', description: 'Dash state.' },
      { name: 'isDisabled', type: 'boolean', description: 'Disables the control.' },
    ],
    code: `<Checkbox defaultSelected>I understand the guidelines</Checkbox>`,
  },
  {
    name: 'RadioGroup',
    group: 'Forms',
    description: 'Single-choice control group.',
    render: () => (
      <RadioGroup label="Who can see your name?" defaultValue="anonymous">
        <Radio value="anonymous">Nobody — stay anonymous</Radio>
        <Radio value="facilitator">Just the facilitator</Radio>
        <Radio value="circle">Everyone in this circle</Radio>
      </RadioGroup>
    ),
    props: [
      { name: 'label', type: 'string', description: 'Group label.' },
      { name: 'value / defaultValue', type: 'string', description: 'Controlled / uncontrolled selection.' },
    ],
    code: `<RadioGroup label="Visibility" defaultValue="anonymous">\n  <Radio value="anonymous">Stay anonymous</Radio>\n</RadioGroup>`,
  },
  {
    name: 'Switch',
    group: 'Forms',
    description: 'Boolean toggle, typically for settings.',
    render: () => <Switch defaultSelected>Notify me about replies</Switch>,
    props: [{ name: 'isSelected / defaultSelected', type: 'boolean', description: 'Controlled / uncontrolled state.' }],
    code: `<Switch defaultSelected>Notify me about replies</Switch>`,
  },
  {
    name: 'Select',
    group: 'Forms',
    description: 'Dropdown single-select.',
    render: () => (
      <div style={{ width: 220 }}>
        <Select label="Preferred language" placeholder="Choose one">
          <SelectItem id="da">Dansk</SelectItem>
          <SelectItem id="en">English</SelectItem>
        </Select>
      </div>
    ),
    props: [
      { name: 'label', type: 'string', description: 'Field label.' },
      { name: 'placeholder', type: 'string', description: 'Shown when nothing is selected.' },
      { name: 'items', type: 'Iterable<T>', description: 'Optional dynamic collection (pairs with a render-function child).' },
    ],
    code: `<Select label="Language" placeholder="Choose one">\n  <SelectItem id="da">Dansk</SelectItem>\n  <SelectItem id="en">English</SelectItem>\n</Select>`,
  },
  {
    name: 'Calendar',
    group: 'Forms',
    description: 'Standalone date grid.',
    render: () => <Calendar aria-label="Appointment date" />,
    props: [
      { name: 'value / defaultValue', type: 'CalendarDate', description: 'Controlled / uncontrolled selected date (from @internationalized/date).' },
      { name: 'minValue / maxValue', type: 'CalendarDate', description: 'Selectable range bounds.' },
    ],
    code: `<Calendar aria-label="Appointment date" />`,
  },
  {
    name: 'DatePicker',
    group: 'Forms',
    description: 'Text input with segmented date entry + calendar popover.',
    render: () => <DatePicker label="Session date" />,
    props: [
      { name: 'label', type: 'string', description: 'Field label.' },
      { name: 'value / defaultValue', type: 'CalendarDate', description: 'Controlled / uncontrolled selected date.' },
    ],
    code: `<DatePicker label="Session date" />`,
  },
  {
    name: 'TimePicker',
    group: 'Forms',
    description: 'Segmented time entry (hour / minute / AM-PM).',
    render: () => <TimePicker label="Session time" />,
    props: [
      { name: 'label', type: 'string', description: 'Field label.' },
      { name: 'value / defaultValue', type: 'Time', description: 'Controlled / uncontrolled selected time (from @internationalized/date).' },
    ],
    code: `<TimePicker label="Session time" />`,
  },
  {
    name: 'ColorPicker',
    group: 'Forms',
    description: 'Swatch trigger opening a saturation/brightness area, hue slider, and hex field.',
    render: () => <ColorPicker label="Accent color" defaultValue="#468679" />,
    props: [
      { name: 'label', type: 'string', description: 'Trigger label shown next to the swatch.' },
      { name: 'value / defaultValue', type: 'string | Color', description: 'Controlled / uncontrolled color.' },
    ],
    code: `<ColorPicker label="Accent color" defaultValue="#468679" />`,
  },
  {
    name: 'CodeEditor',
    group: 'Advanced',
    description: 'Full VS Code editing engine (Monaco), self-hosted — no CDN requests. Ships as a separate package entry (`mincirklen-design-system/code-editor`) so its weight never lands on apps that only use the rest of the system.',
    render: () => (
      <CodeEditor
        height={220}
        defaultLanguage="typescript"
        defaultValue={"function greet(name: string) {\n  return `Hello, ${name}`\n}\n"}
        options={{ minimap: { enabled: false }, fontSize: 13 }}
      />
    ),
    props: [
      { name: 'defaultLanguage / language', type: 'string', description: "'typescript' | 'javascript' | 'json' | 'css' | 'html' | ..." },
      { name: 'defaultValue / value', type: 'string', description: 'Controlled / uncontrolled source text.' },
      { name: 'onChange', type: '(value, event) => void', description: 'Called on every edit.' },
      { name: 'height', type: 'number | string', default: '320', description: 'Editor height.' },
      { name: 'options', type: 'monaco.editor.IStandaloneEditorConstructionOptions', description: 'Any Monaco editor option (minimap, fontSize, wordWrap, ...).' },
    ],
    code: `import { CodeEditor } from 'mincirklen-design-system/code-editor'\nimport 'mincirklen-design-system/code-editor.css'\n\n<CodeEditor defaultLanguage="typescript" defaultValue="const x = 1" />`,
  },
  {
    name: 'Modal',
    group: 'Overlays',
    description: 'Blocking dialog. Wrap trigger + modal in `DialogTrigger`.',
    render: () => (
      <DialogTrigger>
        <Button variant="urgent">Leave session</Button>
        <Modal title="Leave this session?">
          {(close) => (
            <>
              <p style={{ margin: 0, color: 'var(--text-secondary)' }}>
                You can rejoin at any time before it ends.
              </p>
              <div style={{ display: 'flex', gap: 12 }}>
                <Button variant="urgent" onClick={close}>
                  Leave
                </Button>
                <Button variant="secondary" onClick={close}>
                  Stay
                </Button>
              </div>
            </>
          )}
        </Modal>
      </DialogTrigger>
    ),
    props: [
      { name: 'title', type: 'string', description: 'Heading text.' },
      { name: 'children', type: 'ReactNode | ((close) => ReactNode)', description: 'Body content — function form gets a `close()` callback.' },
      { name: 'isDismissable', type: 'boolean', default: 'true', description: 'Whether clicking the backdrop / Escape closes it.' },
    ],
    code: `<DialogTrigger>\n  <Button variant="urgent">Leave session</Button>\n  <Modal title="Leave this session?">\n    {(close) => <Button onClick={close}>Leave</Button>}\n  </Modal>\n</DialogTrigger>`,
  },
  {
    name: 'Tabs',
    group: 'Navigation',
    description: 'Switches between panels.',
    render: () => (
      <Tabs defaultSelectedKey="about">
        <TabList aria-label="Circle info">
          <Tab id="about">About</Tab>
          <Tab id="guidelines">Guidelines</Tab>
        </TabList>
        <TabPanel id="about">A weekly peer-support circle for new parents.</TabPanel>
        <TabPanel id="guidelines">Be kind. Stay anonymous if you want. No advice-giving unless asked.</TabPanel>
      </Tabs>
    ),
    props: [{ name: 'defaultSelectedKey / selectedKey', type: 'Key', description: 'Uncontrolled / controlled active tab.' }],
    code: `<Tabs defaultSelectedKey="about">\n  <TabList aria-label="Circle info">\n    <Tab id="about">About</Tab>\n  </TabList>\n  <TabPanel id="about">...</TabPanel>\n</Tabs>`,
  },
  {
    name: 'Accordion',
    group: 'Navigation',
    description: 'Expand/collapse groups of content (FAQ-style).',
    render: () => (
      <Accordion defaultExpandedKeys={['safety']}>
        <AccordionItem id="safety" title="How is my safety protected?">
          A trained facilitator moderates every session, and you can leave or report at any time.
        </AccordionItem>
        <AccordionItem id="privacy" title="Is this anonymous?">
          Yes, by default — you choose what to share.
        </AccordionItem>
      </Accordion>
    ),
    props: [
      { name: 'defaultExpandedKeys / expandedKeys', type: 'Iterable<Key>', description: 'Uncontrolled / controlled expanded items (on `Accordion`).' },
      { name: 'title', type: 'string', description: 'Trigger text (on `AccordionItem`).' },
    ],
    code: `<Accordion defaultExpandedKeys={['safety']}>\n  <AccordionItem id="safety" title="How is my safety protected?">...</AccordionItem>\n</Accordion>`,
  },
  {
    name: 'Menu',
    group: 'Navigation',
    description: 'Trigger-activated action list.',
    render: () => (
      <Menu label="Actions ⌄" onAction={() => {}}>
        <MenuItem id="mute">Mute notifications</MenuItem>
        <MenuItem id="leave">Leave circle</MenuItem>
        <MenuItem id="report">Report a user</MenuItem>
      </Menu>
    ),
    props: [
      { name: 'label', type: 'ReactNode', description: 'Trigger button content.' },
      { name: 'onAction', type: '(key: Key) => void', description: 'Called when an item is selected.' },
    ],
    code: `<Menu label="Actions ⌄" onAction={(key) => {}}>\n  <MenuItem id="leave">Leave circle</MenuItem>\n</Menu>`,
  },
  {
    name: 'ThemeProvider',
    group: 'Foundation',
    description: 'Wrap the app root. Sets data-theme, follows system preference until the user picks explicitly, then persists the choice.',
    render: () => (
      <p style={{ margin: 0, color: 'var(--text-secondary)', fontSize: 'var(--font-size-sm)' }}>
        No standalone preview — see the theme toggle in the top-right of this page.
      </p>
    ),
    props: [{ name: 'children', type: 'ReactNode', description: 'App content.' }],
    code: `<ThemeProvider>\n  <App />\n</ThemeProvider>`,
  },
  {
    name: 'Container',
    group: 'Layout',
    description: 'Centers content with a responsive max-width (1140px) and consistent side padding. Pass `fluid` to span the full viewport width instead.',
    render: () => (
      <div style={{ background: 'var(--surface-sunken)', padding: 'var(--space-3)', borderRadius: 8 }}>
        <Container
          style={{
            background: 'var(--surface-raised)',
            border: '1px dashed var(--border-strong)',
            borderRadius: 8,
            padding: 'var(--space-4)',
          }}
        >
          <Text variant="small">Container — max-width 1140px, centered, responsive padding.</Text>
        </Container>
      </div>
    ),
    props: [{ name: 'fluid', type: 'boolean', default: 'false', description: 'Removes the max-width — spans full width.' }],
    code: `<Container>\n  <p>Page content</p>\n</Container>`,
  },
  {
    name: 'Grid (Row / Col)',
    group: 'Layout',
    description: '12-column responsive grid. Columns default to equal width; pass `span`/`md`/`lg` to size them per breakpoint (md ≥768px, lg ≥1024px).',
    render: () => {
      const swatch: CSSProperties = {
        background: 'var(--accent-safe-surface)',
        color: 'var(--accent-safe)',
        borderRadius: 8,
        padding: 'var(--space-3)',
        textAlign: 'center',
        fontSize: 'var(--font-size-xs)',
      }
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Row gap={2}>
            <Col><div style={swatch}>auto</div></Col>
            <Col><div style={swatch}>auto</div></Col>
            <Col><div style={swatch}>auto</div></Col>
          </Row>
          <Row gap={2}>
            <Col span={4}><div style={swatch}>span 4</div></Col>
            <Col span={4}><div style={swatch}>span 4</div></Col>
            <Col span={4}><div style={swatch}>span 4</div></Col>
          </Row>
          <Row gap={2}>
            <Col span={12} md={6}><div style={swatch}>span 12, md 6</div></Col>
            <Col span={12} md={6}><div style={swatch}>span 12, md 6</div></Col>
          </Row>
        </div>
      )
    },
    props: [
      { name: 'Row.gap', type: '1-8', default: '4', description: 'Gap between columns, on the spacing scale.' },
      { name: 'Col.span', type: 'number (1-12)', description: 'Column width from the base viewport up. Omit for an equal-width auto column.' },
      { name: 'Col.md / Col.lg', type: 'number (1-12)', description: 'Override the span from the md (768px) / lg (1024px) breakpoint up.' },
    ],
    code: `<Row>\n  <Col span={12} md={6}>Half width from tablet up</Col>\n  <Col span={12} md={6}>Half width from tablet up</Col>\n</Row>`,
  },
  {
    name: 'Typography',
    group: 'Content',
    description: 'Heading levels 1–6 and body text variants (lead, body, muted, small).',
    render: () => (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Heading level={1}>Heading 1</Heading>
        <Heading level={2}>Heading 2</Heading>
        <Heading level={3}>Heading 3</Heading>
        <Heading level={4}>Heading 4</Heading>
        <Heading level={5}>Heading 5</Heading>
        <Heading level={6}>Heading 6</Heading>
        <Text variant="lead">
          A lead paragraph — slightly larger, for the opening line of a section.
        </Text>
        <Text variant="body">Body text is the default for everything else.</Text>
        <Text variant="muted">Muted text, for secondary/supporting information.</Text>
        <Text variant="small">Small text, for fine print.</Text>
      </div>
    ),
    props: [
      { name: 'Heading.level', type: '1 | 2 | 3 | 4 | 5 | 6', default: '1', description: 'Controls both the rendered tag and the size.' },
      { name: 'Text.variant', type: "'body' | 'lead' | 'muted' | 'small'", default: "'body'", description: 'Size + color treatment.' },
      { name: 'Text.as', type: 'ElementType', default: "'p'", description: 'Element to render (e.g. "span" for inline use).' },
    ],
    code: `<Heading level={1}>Weekly circle</Heading>\n<Text variant="lead">A space to be heard, without judgment.</Text>`,
  },
  {
    name: 'Blockquote',
    group: 'Content',
    description: 'An accent-bordered quotation, for testimonials or pull-quotes.',
    render: () => (
      <Blockquote>"It helped just knowing someone else understood what I was going through."</Blockquote>
    ),
    props: [{ name: 'children', type: 'ReactNode', description: 'Quoted content.' }],
    code: `<Blockquote>"It helped just knowing someone else understood."</Blockquote>`,
  },
  {
    name: 'Lists',
    group: 'Content',
    description: 'Ordered, unordered, and unstyled lists.',
    render: () => (
      <div style={{ display: 'flex', gap: 32 }}>
        <List>
          <li>Be kind</li>
          <li>Stay anonymous if you want</li>
          <li>No advice-giving unless asked</li>
        </List>
        <List ordered>
          <li>Join the session</li>
          <li>Introduce yourself (or not)</li>
          <li>Listen and share</li>
        </List>
      </div>
    ),
    props: [
      { name: 'ordered', type: 'boolean', default: 'false', description: 'Renders an <ol> instead of <ul>.' },
      { name: 'unstyled', type: 'boolean', default: 'false', description: 'Removes markers and left padding.' },
    ],
    code: `<List ordered>\n  <li>Join the session</li>\n  <li>Introduce yourself</li>\n</List>`,
  },
  {
    name: 'Tables',
    group: 'Content',
    description: 'For tabular data — schedules, user lists, and the like.',
    render: () => (
      <Table striped>
        <thead>
          <tr>
            <th>Circle</th>
            <th>Day</th>
            <th>Users</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>New parents</td>
            <td>Tuesdays</td>
            <td>6</td>
          </tr>
          <tr>
            <td>Grief support</td>
            <td>Thursdays</td>
            <td>8</td>
          </tr>
        </tbody>
      </Table>
    ),
    props: [
      { name: 'striped', type: 'boolean', default: 'false', description: 'Alternates row background for readability.' },
      { name: 'bordered', type: 'boolean', default: 'false', description: 'Adds borders around every cell.' },
    ],
    code: `<Table striped>\n  <thead><tr><th>Circle</th></tr></thead>\n  <tbody><tr><td>New parents</td></tr></tbody>\n</Table>`,
  },
  {
    name: 'Figures',
    group: 'Content',
    description: 'An image (or image-like content) with an optional caption.',
    render: () => (
      <Figure caption="Weekly circle, meeting in the community room.">
        <div
          style={{
            width: '100%',
            height: 140,
            background: 'var(--surface-sunken)',
            borderRadius: 8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--text-secondary)',
            fontSize: 'var(--font-size-xs)',
          }}
        >
          (image placeholder)
        </div>
      </Figure>
    ),
    props: [{ name: 'caption', type: 'ReactNode', description: 'Caption shown below the content.' }],
    code: `<Figure caption="Weekly circle meetup">\n  <img src="/circle.jpg" alt="" />\n</Figure>`,
  },
  {
    name: 'Spacing',
    group: 'Utilities',
    description: 'Margin, padding, and gap utilities on the 0–8 spacing scale, with directional variants (t/b/s/e/x/y).',
    render: () => (
      <div className="ds-d-flex ds-gap-3">
        <div className="ds-p-1" style={{ background: 'var(--accent-safe-surface)', borderRadius: 6 }}>
          p-1
        </div>
        <div className="ds-p-3" style={{ background: 'var(--accent-safe-surface)', borderRadius: 6 }}>
          p-3
        </div>
        <div className="ds-p-6" style={{ background: 'var(--accent-safe-surface)', borderRadius: 6 }}>
          p-6
        </div>
      </div>
    ),
    propsHeading: 'Classes',
    props: [
      { name: 'ds-m-{0-8}', type: 'margin', description: 'All-sides margin, on the spacing scale.' },
      { name: 'ds-mt-* / mb- / ms- / me-', type: 'margin', description: 'Top / bottom / start (left) / end (right) margin.' },
      { name: 'ds-mx-* / my-*', type: 'margin', description: 'Horizontal / vertical margin.' },
      { name: 'ds-m-auto / mx-auto', type: 'margin', description: 'Auto margin — the mx-auto centering idiom.' },
      { name: 'ds-p-{0-8} / pt- / pb- / ps- / pe- / px- / py-', type: 'padding', description: 'Same directional set, for padding.' },
      { name: 'ds-gap-{0-8}', type: 'gap', description: 'Flex/grid gap, on the spacing scale.' },
    ],
    code: `<div className="ds-d-flex ds-gap-3">\n  <div className="ds-p-3">Card</div>\n</div>`,
  },
  {
    name: 'Flex & Display',
    group: 'Utilities',
    description: 'Display type, flex direction/wrap, and alignment utilities.',
    render: () => (
      <div className="ds-d-flex ds-justify-between ds-items-center ds-gap-2" style={{ background: 'var(--surface-sunken)', padding: 12, borderRadius: 8 }}>
        <div style={{ background: 'var(--accent-info-surface)', padding: 8, borderRadius: 6 }}>start</div>
        <div style={{ background: 'var(--accent-info-surface)', padding: 8, borderRadius: 6 }}>center</div>
        <div style={{ background: 'var(--accent-info-surface)', padding: 8, borderRadius: 6 }}>end</div>
      </div>
    ),
    propsHeading: 'Classes',
    props: [
      { name: 'ds-d-{none,block,inline,inline-block,flex,inline-flex,grid}', type: 'display', description: 'Sets the CSS display value.' },
      { name: 'ds-flex-{row,row-reverse,column,column-reverse}', type: 'flex-direction', description: 'Main-axis direction of flex children.' },
      { name: 'ds-flex-{wrap,nowrap}', type: 'flex-wrap', description: 'Whether flex items wrap onto multiple lines.' },
      { name: 'ds-justify-{start,end,center,between,around,evenly}', type: 'justify-content', description: 'Distributes items along the main axis.' },
      { name: 'ds-items-* / ds-self-*', type: 'align-items / align-self', description: 'start, end, center, baseline, stretch.' },
    ],
    code: `<div className="ds-d-flex ds-justify-between ds-items-center">...</div>`,
  },
  {
    name: 'Colors',
    group: 'Utilities',
    description: 'Background and text color utilities — always mapped to a semantic token, never a raw hex value.',
    render: () => (
      <div className="ds-d-flex ds-gap-2" style={{ flexWrap: 'wrap' }}>
        {['bg-safe', 'bg-info', 'bg-urgent', 'bg-sunken'].map((cls) => (
          <div
            key={cls}
            className={`ds-${cls}`}
            style={{ width: 72, height: 48, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: 'var(--text-on-accent)' }}
          >
            {cls}
          </div>
        ))}
      </div>
    ),
    propsHeading: 'Classes',
    props: [
      { name: 'ds-bg-{app,raised,sunken}', type: 'background-color', description: 'Neutral surface backgrounds.' },
      { name: 'ds-bg-{safe,safe-surface,info,info-surface,urgent,urgent-surface}', type: 'background-color', description: 'Semantic backgrounds.' },
      { name: 'ds-text-{primary,secondary,on-accent}', type: 'color', description: 'Neutral text colors.' },
      { name: 'ds-text-{safe,info,urgent}', type: 'color', description: 'Semantic text colors.' },
    ],
    code: `<span className="ds-bg-urgent-surface ds-text-urgent">Reported</span>`,
  },
  {
    name: 'Borders & Shadows',
    group: 'Utilities',
    description: 'Border, radius, and elevation utilities.',
    render: () => (
      <div className="ds-d-flex ds-gap-3">
        <div className="ds-border ds-rounded-md" style={{ padding: 12 }}>
          border + rounded
        </div>
        <div className="ds-shadow-md ds-rounded-lg" style={{ padding: 12, background: 'var(--surface-raised)' }}>
          shadow-md
        </div>
      </div>
    ),
    propsHeading: 'Classes',
    props: [
      { name: 'ds-border / ds-border-strong / ds-border-0', type: 'border', description: '1px solid border in the subtle or strong token, or none.' },
      { name: 'ds-rounded-{0,sm,md,lg,full}', type: 'border-radius', description: 'Corner radius, on the radius scale.' },
      { name: 'ds-shadow-{none,sm,md,lg}', type: 'box-shadow', description: 'Elevation shadow, on the shadow scale.' },
    ],
    code: `<div className="ds-border ds-rounded-md ds-shadow-sm">Card-like box</div>`,
  },
  {
    name: 'Section',
    group: 'Marketing',
    description: 'Vertical-rhythm wrapper for a page section — background tone, padding scale, and an optional centered Container. Every other marketing block below is built on top of it.',
    render: () => (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Section tone="sunken" spacing="md" style={{ borderRadius: 8 }}>
          <Text variant="small">tone="sunken" spacing="md"</Text>
        </Section>
        <Section tone="raised" spacing="md" style={{ borderRadius: 8, border: '1px solid var(--border-subtle)' }}>
          <Text variant="small">tone="raised" spacing="md"</Text>
        </Section>
      </div>
    ),
    props: [
      { name: 'tone', type: "'app' | 'raised' | 'sunken'", default: "'app'", description: 'Background surface.' },
      { name: 'spacing', type: "'md' | 'lg' | 'xl'", default: "'lg'", description: 'Vertical padding scale.' },
      { name: 'container', type: 'boolean', default: 'true', description: 'Wrap children in a centered Container.' },
    ],
    code: `<Section tone="sunken" spacing="lg">\n  <Heading level={2}>Why circles help</Heading>\n</Section>`,
  },
  {
    name: 'Navbar',
    group: 'Marketing',
    description: 'Site header — logo left, links/actions right. For a mobile menu, compose the Menu component into the links area.',
    render: () => (
      <Navbar logo="MinCirklen">
        <Text variant="small" as="span">About</Text>
        <Button variant="safe">Join now</Button>
      </Navbar>
    ),
    props: [
      { name: 'logo', type: 'ReactNode', description: 'Left-aligned logo/wordmark.' },
      { name: 'children', type: 'ReactNode', description: 'Right-aligned links and actions.' },
      { name: 'sticky', type: 'boolean', default: 'false', description: 'Pins the navbar to the top of the viewport.' },
    ],
    code: `<Navbar logo="MinCirklen">\n  <Text as="span">Circles</Text>\n  <Button variant="safe">Join now</Button>\n</Navbar>`,
  },
  {
    name: 'Hero',
    group: 'Marketing',
    description: 'Large opening section for a landing page — centered or left-aligned, with an optional media slot that switches to a split two-column layout.',
    render: () => (
      <Hero>
        <Badge variant="safe">Now open</Badge>
        <Heading level={1}>A space to be heard, without judgment</Heading>
        <Text variant="lead">Anonymous, moderated peer-support circles — join one in minutes.</Text>
        <div style={{ display: 'flex', gap: 12 }}>
          <Button variant="safe">Join a circle</Button>
          <Button variant="secondary">Learn more</Button>
        </div>
      </Hero>
    ),
    props: [
      { name: 'align', type: "'center' | 'left'", default: "'center'", description: 'Text alignment when no media is given.' },
      { name: 'media', type: 'ReactNode', description: 'Optional image — switches to a split layout.' },
      { name: 'tone', type: "'app' | 'raised' | 'sunken'", default: "'app'", description: 'Background surface.' },
    ],
    code: `<Hero>\n  <Heading level={1}>A space to be heard</Heading>\n  <Button variant="safe">Join a circle</Button>\n</Hero>`,
  },
  {
    name: 'Feature',
    group: 'Marketing',
    description: 'Icon + title + description block. Arrange several inside a Row/Col grid for a features showcase.',
    render: () => (
      <Row>
        <Col span={4}>
          <Feature icon="🛡" title="Moderated">
            A trained facilitator is present in every session.
          </Feature>
        </Col>
        <Col span={4}>
          <Feature icon="🤝" title="Anonymous by default">
            Share as much or as little as you want.
          </Feature>
        </Col>
        <Col span={4}>
          <Feature icon="🕊" title="No pressure">
            Listen-only is always welcome — no advice required.
          </Feature>
        </Col>
      </Row>
    ),
    props: [
      { name: 'icon', type: 'ReactNode', description: 'Icon or emoji.' },
      { name: 'title', type: 'string', description: 'Feature name.' },
      { name: 'children', type: 'ReactNode', description: 'Short description.' },
    ],
    code: `<Feature icon="🛡" title="Moderated">\n  A trained facilitator is present in every session.\n</Feature>`,
  },
  {
    name: 'Testimonial',
    group: 'Marketing',
    description: 'A quote card with attribution — anonymous by default, matching how users are represented elsewhere in the product.',
    render: () => (
      <Testimonial
        quote="It helped just knowing someone else understood what I was going through."
        name="Anonymous"
        role="Weekly circle user"
        anonymous
      />
    ),
    props: [
      { name: 'quote', type: 'ReactNode', description: 'The testimonial text.' },
      { name: 'name', type: 'string', description: 'Attributed name.' },
      { name: 'role', type: 'string', description: 'Optional role/context line.' },
      { name: 'anonymous', type: 'boolean', default: 'false', description: 'Shows "Anonymous" + a neutral avatar instead of the name.' },
    ],
    code: `<Testimonial quote="It helped just knowing..." name="Anonymous" anonymous />`,
  },
  {
    name: 'Stat',
    group: 'Marketing',
    description: 'A large number + label, for a metrics/social-proof row.',
    render: () => (
      <Row>
        <Col span={4}><Stat value="1,200+" label="Circles hosted" /></Col>
        <Col span={4}><Stat value="98%" label="Would recommend" /></Col>
        <Col span={4}><Stat value="24/7" label="Moderated access" /></Col>
      </Row>
    ),
    props: [
      { name: 'value', type: 'ReactNode', description: 'The headline number.' },
      { name: 'label', type: 'ReactNode', description: 'Caption below the number.' },
    ],
    code: `<Stat value="1,200+" label="Circles hosted" />`,
  },
  {
    name: 'CTASection',
    group: 'Marketing',
    description: 'Bold accent-colored banner for a closing call-to-action. Use Button variant="secondary" or "ghost" for the actions — "safe" would blend into the background.',
    render: () => (
      <CTASection title="Ready to join a circle?" actions={<Button variant="secondary">Get started</Button>}>
        It only takes a minute, and you can stay anonymous the whole way.
      </CTASection>
    ),
    props: [
      { name: 'title', type: 'ReactNode', description: 'Banner heading.' },
      { name: 'children', type: 'ReactNode', description: 'Supporting text.' },
      { name: 'actions', type: 'ReactNode', description: 'Buttons — prefer "secondary"/"ghost" variants here.' },
    ],
    code: `<CTASection title="Ready to join a circle?" actions={<Button variant="secondary">Get started</Button>}>\n  It only takes a minute.\n</CTASection>`,
  },
  {
    name: 'PricingCard',
    group: 'Marketing',
    description: 'A plan card with a feature checklist and CTA. Set highlighted on the recommended plan.',
    render: () => (
      <Row>
        <Col span={6}>
          <PricingCard
            name="Community"
            price="Free"
            features={['Join unlimited circles', 'Anonymous by default']}
            cta={<Button variant="secondary">Get started</Button>}
          />
        </Col>
        <Col span={6}>
          <PricingCard
            name="Facilitator"
            price="$29"
            period="mo"
            features={['Everything in Community', 'Host your own circles', 'Priority moderation support']}
            cta={<Button variant="safe">Start hosting</Button>}
            highlighted
          />
        </Col>
      </Row>
    ),
    props: [
      { name: 'name', type: 'string', description: 'Plan name.' },
      { name: 'price', type: 'ReactNode', description: 'Price display.' },
      { name: 'period', type: 'string', description: 'Billing period suffix, e.g. "mo".' },
      { name: 'features', type: 'string[]', description: 'Checklist of included features.' },
      { name: 'cta', type: 'ReactNode', description: 'Call-to-action button.' },
      { name: 'highlighted', type: 'boolean', default: 'false', description: 'Emphasizes the recommended plan.' },
    ],
    code: `<PricingCard name="Facilitator" price="$29" period="mo" features={['Host circles']} cta={<Button>Start</Button>} highlighted />`,
  },
  {
    name: 'Footer',
    group: 'Marketing',
    description: 'Site footer — link columns (via FooterColumn) plus a bottom copyright bar.',
    render: () => (
      <Footer bottom="© 2026 Selkomark. All rights reserved.">
        <FooterColumn title="Product">
          <a href="#">Circles</a>
          <a href="#">Pricing</a>
        </FooterColumn>
        <FooterColumn title="Company">
          <a href="#">About</a>
          <a href="#">Safety</a>
        </FooterColumn>
      </Footer>
    ),
    props: [
      { name: 'children', type: 'ReactNode', description: 'FooterColumn elements.' },
      { name: 'bottom', type: 'ReactNode', description: 'Copyright / legal line.' },
      { name: 'FooterColumn.title', type: 'string', description: 'Column heading.' },
    ],
    code: `<Footer bottom="© 2026 Selkomark.">\n  <FooterColumn title="Product">\n    <a href="/circles">Circles</a>\n  </FooterColumn>\n</Footer>`,
  },
]

const groupOrder = [
  'Layout',
  'Content',
  'Marketing',
  'Actions',
  'Forms',
  'Feedback',
  'Overlays',
  'Navigation',
  'Data display',
  'Advanced',
  'Utilities',
  'Foundation',
]

const slugify = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')

export function Catalog() {
  useDocumentTitle('Components — MinCirklen')

  const [query, setQuery] = useState('')
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [selected, setSelected] = useState(() => {
    const fromHash = entries.find((e) => slugify(e.name) === window.location.hash.slice(1))
    return fromHash?.name ?? entries[0].name
  })

  useEffect(() => {
    const onHashChange = () => {
      const fromHash = entries.find((e) => slugify(e.name) === window.location.hash.slice(1))
      if (fromHash) setSelected(fromHash.name)
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  const select = (name: string) => {
    setSelected(name)
    setMobileNavOpen(false)
    history.replaceState(null, '', `#${slugify(name)}`)
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return entries
    return entries.filter(
      (e) => e.name.toLowerCase().includes(q) || e.description.toLowerCase().includes(q),
    )
  }, [query])

  const active = entries.find((e) => e.name === selected) ?? filtered[0]

  return (
    <div className="cat-shell">
      <div className="cat-topbar">
        <span className="cat-topbar__brand">Components</span>
        <ThemeToggle />
      </div>
      <div className="cat-layout">
      <div className="cat-mobile-nav-wrap">
        <button
          type="button"
          className="cat-mobile-toggle"
          onClick={() => setMobileNavOpen((v) => !v)}
          aria-expanded={mobileNavOpen}
          aria-controls="cat-nav"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M2 4h12M2 8h12M2 12h12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          {active?.name ?? 'Menu'}
        </button>

        {mobileNavOpen && <div className="cat-mobile-backdrop" onClick={() => setMobileNavOpen(false)} />}

        <aside id="cat-nav" className={['cat-nav', mobileNavOpen && 'cat-nav--open'].filter(Boolean).join(' ')}>
          <input
            className="cat-search"
            placeholder="Search components..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {groupOrder.map((group) => {
            const items = filtered.filter((e) => e.group === group)
            if (items.length === 0) return null
            return (
              <div key={group} className="cat-nav__group">
                <div className="cat-nav__group-label">{group}</div>
                {items.map((item) => (
                  <button
                    key={item.name}
                    className={['cat-nav__item', item.name === active?.name && 'cat-nav__item--active']
                      .filter(Boolean)
                      .join(' ')}
                    onClick={() => select(item.name)}
                  >
                    {item.name}
                  </button>
                ))}
              </div>
            )
          })}
        </aside>
      </div>
      <main className="cat-detail">
        {active ? (
          <>
            <h2 className="cat-detail__title">{active.name}</h2>
            <p className="cat-detail__description">{active.description}</p>
            <div className="cat-preview">{active.render()}</div>
            <h3 className="cat-detail__subheading">{active.propsHeading ?? 'Props'}</h3>
            <PropsTable rows={active.props} />
            <h3 className="cat-detail__subheading">Usage</h3>
            <CodeBlock code={active.code} />
          </>
        ) : (
          <p>No components match "{query}".</p>
        )}
      </main>
      </div>
    </div>
  )
}
