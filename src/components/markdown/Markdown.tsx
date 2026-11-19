import ReactMarkdown, { type Components } from 'react-markdown'
import remarkBreaks from 'remark-breaks'
import remarkGfm from 'remark-gfm'
import './markdown.css'

// GFM (tables, ~~strike~~, task lists, autolinks) + single newlines become line breaks, as people type in a textarea.
const plugins = [remarkGfm, remarkBreaks]

// Only http(s), mailto, tel and in-page links. Raw HTML is never rendered, and images are dropped:
// a CV must not load remote content (it would also leak that the CV was opened).
const urlTransform = (url: string) => (/^(https?:|mailto:|tel:|#)/i.test(url) ? url : '')

const components: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
  img: () => null,
}

const INLINE = ['strong', 'em', 'del', 'a', 'code', 'br']

/** Markdown → React. `inline` keeps only inline formatting (bold, italic, strike, links, code) and no paragraph wrapper. */
export function Md({ source, inline }: { source: string; inline?: boolean }) {
  return inline ? (
    <ReactMarkdown remarkPlugins={plugins} urlTransform={urlTransform} components={components} allowedElements={INLINE} unwrapDisallowed>
      {source}
    </ReactMarkdown>
  ) : (
    <ReactMarkdown remarkPlugins={plugins} urlTransform={urlTransform} components={components}>
      {source}
    </ReactMarkdown>
  )
}
