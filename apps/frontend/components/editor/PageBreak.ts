import { Node, mergeAttributes } from "@tiptap/core";

export interface PageBreakOptions {
  HTMLAttributes: Record<string, unknown>;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    pageBreak: {
      insertPageBreak: (page?: number) => ReturnType;
    };
  }
}

export const PageBreak = Node.create<PageBreakOptions>({
  name: "pageBreak",

  group: "block",

  atom: true,

  draggable: true,

  addOptions() {
    return {
      HTMLAttributes: {},
    };
  },

  addAttributes() {
    return {
      page: {
        default: 1,
        parseHTML: (el) => {
          const val = el.getAttribute("data-page");
          return val ? parseInt(val, 10) : 1;
        },
        renderHTML: (attrs) => {
          return { "data-page": String(attrs.page) };
        },
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-page-break]' }];
  },

  renderHTML({ HTMLAttributes }) {
    const page = (HTMLAttributes as any).page || 1;
    return [
      "div",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        "data-page-break": "",
        "data-page": String(page),
        class: "docx-page-break",
      }),
      ["span", { class: "page-number" }, `Page ${page}`],
    ];
  },

  addCommands() {
    return {
      insertPageBreak:
        (page?: number) =>
        ({ chain }) => {
          return chain().insertContent({ type: this.name, attrs: { page: page || 1 } }).run();
        },
    };
  },
});
