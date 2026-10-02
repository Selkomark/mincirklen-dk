import { describe, expect, test } from 'bun:test'
import { htmlToText } from './htmlToText'

describe('htmlToText', () => {
  test('turns block tags into line breaks and strips the rest', () => {
    expect(htmlToText('<!doctype html><html><head><title>x</title></head><body><p>One</p><p>Two</p><div>Three</div></body></html>')).toBe('One\n\nTwo\n\nThree')
  })

  test('renders a link as "label (url)", or just the url when the label is the url', () => {
    expect(htmlToText('<p>Read our <a href="https://x/g" style="color:red">guidelines</a>.</p>')).toBe('Read our guidelines (https://x/g).')
    expect(htmlToText('<p>Go:<br/><a href="https://x/?a=1&amp;b=2">https://x/?a=1&amp;b=2</a></p>')).toBe('Go:\nhttps://x/?a=1&b=2')
    expect(htmlToText('<a href="https://x"></a>')).toBe('https://x')
  })

  test('decodes entities, including numeric ones and the apostrophe React emits', () => {
    expect(htmlToText('<p>don&#x27;t &amp; won&#39;t &lt;3 &quot;q&quot; &apos;a&apos;&nbsp;&#8212; &bogus;</p>')).toBe('don\'t & won\'t <3 "q" \'a\' — &bogus;')
    expect(htmlToText('&#xZZ;')).toBe('&#xZZ;')
  })

  test('collapses runs of blank lines and trims line edges', () => {
    expect(htmlToText('<p>  a  </p><br/><br/><br/><p>b</p>')).toBe('a\n\nb')
  })

  test('list items get a dash', () => {
    expect(htmlToText('<ul><li>one</li><li>two</li></ul>')).toBe('- one\n\n- two')
  })

  test('drops style and script blocks', () => {
    expect(htmlToText('<style>p{color:red}</style><script>alert(1)</script><p>ok</p>')).toBe('ok')
  })
})
