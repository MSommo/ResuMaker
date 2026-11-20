import { Extension, InputRule } from '@tiptap/core'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table'
import { Placeholder } from '@tiptap/extensions'
import Document from '@tiptap/extension-document'
import HardBreak from '@tiptap/extension-hard-break'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from 'tiptap-markdown'

const markdown = Markdown.configure({
  html: false, // raw HTML is never kept, same as the CV renderer
  tightLists: true,
  bulletListMarker: '-',
  linkify: false,
  breaks: true, // a single line break is kept as typed, as in the CV
  transformPastedText: true, // pasting Markdown text formats it
})

// A line break is written as a plain newline (the CV renderer treats a single newline as a break), not as a trailing backslash.
const LineBreak = HardBreak.extend({
  addStorage() {
    return {
      markdown: {
        serialize(state: any, node: any, parent: any, index: number) {
          for (let i = index + 1; i < parent.childCount; i++)
            if (parent.child(i).type !== node.type) {
              state.write('\n')
              return
            }
        },
        parse: {},
      },
    }
  },
})

// The Markdown serializer only knows "tight" (no blank lines between items) for bullet and numbered lists; give task lists the same.
const TightTaskList = TaskList.extend({
  addAttributes() {
    return { ...this.parent?.(), tight: { default: true, rendered: false } }
  },
})

/** Only these URL schemes survive: the CV renderer drops everything else, so the editor must not offer them either. */
const isAllowedUri = (url: string) => /^(https?:|mailto:|tel:|#)/i.test(url)

/** Typing `[text](https://…)` turns into a link, like the other Markdown shortcuts. */
const MarkdownLink = Extension.create({
  name: 'markdownLinkRule',
  addInputRules() {
    return [
      new InputRule({
        find: /\[([^\]]+)\]\(((?:https?:\/\/|mailto:|tel:)[^\s)]+)\)$/,
        handler: ({ state, range, match }) => {
          const link = state.schema.marks.link
          if (!link) return
          state.tr.replaceWith(range.from, range.to, state.schema.text(match[1], [link.create({ href: match[2] })]))
        },
      }),
    ]
  },
})

/** Multi-line editor (descriptions, free text). Typing Markdown formats as you go: `**bold**`, `- `, `1. `, `## `, `> `, `[ ] `, `---`. */
export const blockExtensions = (placeholder = '') => [
  StarterKit.configure({
    underline: false, // the CV renderer has no underline in Markdown
    hardBreak: false,
    link: { openOnClick: false, autolink: true, isAllowedUri: (url: string) => isAllowedUri(url) },
  }),
  LineBreak,
  TightTaskList,
  TaskItem.configure({ nested: true }),
  Table,
  TableRow,
  TableHeader,
  TableCell,
  Placeholder.configure({ placeholder }),
  MarkdownLink,
  markdown,
]

/** One-line editor (bullets, subheadings): inline formatting only, no line breaks. */
export const inlineExtensions = (placeholder = '') => [
  Document.extend({ content: 'paragraph' }),
  StarterKit.configure({
    document: false,
    heading: false,
    bulletList: false,
    orderedList: false,
    listItem: false,
    listKeymap: false,
    blockquote: false,
    codeBlock: false,
    horizontalRule: false,
    hardBreak: false,
    underline: false,
    link: { openOnClick: false, autolink: true, isAllowedUri: (url: string) => isAllowedUri(url) },
  }),
  Placeholder.configure({ placeholder }),
  MarkdownLink,
  markdown,
]
