import type { ListItem, Root, RootContent } from 'mdast'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { unified } from 'unified'

const parser = unified().use(remarkParse).use(remarkGfm)
const cache = new Map<string, Block[]>()

export interface Block {
  /** Markdown source of this block. */
  src: string
  /** A list item that is followed by another item of the same list: the layout spaces these tightly. */
  tight: boolean
}

/**
 * Splits Markdown into top-level blocks, each as its own source string, so a layout can place them on pages one at a time.
 * A list becomes one block per item (an ordered item keeps its number: "3. x" renders as an <ol start=3>), so a long list can
 * flow across a page break. Raw HTML blocks are dropped: they are never rendered.
 */
export function splitBlocks(source: string): Block[] {
  if (!source.trim()) return []
  const hit = cache.get(source)
  if (hit) return hit

  const tree = parser.parse(source) as Root
  const slice = (n: RootContent | ListItem) => source.slice(n.position!.start.offset!, n.position!.end.offset!)
  const defs = tree.children.filter((n) => n.type === 'definition').map(slice) // `[ref]: url` lines, kept with every block
  const out: Block[] = []
  for (const node of tree.children) {
    if (node.type === 'definition' || node.type === 'html') continue
    if (node.type === 'list') node.children.forEach((item, i) => out.push({ src: slice(item), tight: i < node.children.length - 1 }))
    else out.push({ src: slice(node), tight: false })
  }
  const blocks = defs.length ? out.map((b) => ({ ...b, src: `${b.src}\n\n${defs.join('\n')}` })) : out

  if (cache.size > 300) cache.clear()
  cache.set(source, blocks)
  return blocks
}
