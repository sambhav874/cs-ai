"use client";

import React, { useEffect, useRef } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import { TextStyle } from "@tiptap/extension-text-style";
import { Color } from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import TextAlign from "@tiptap/extension-text-align";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import Placeholder from "@tiptap/extension-placeholder";

import { PageBreak } from "./PageBreak";
import { DocumentEditorToolbar } from "./DocumentEditorToolbar";
import { plainTextToHtml, htmlToPlainText } from "./utils";

interface DocumentEditorProps {
  content: string;
  onChange: (plainText: string) => void;
}

export function DocumentEditor({ content, onChange }: DocumentEditorProps) {
  const lastEmittedRef = useRef<string>("");

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        code: false,
        codeBlock: false,
        blockquote: false,
        horizontalRule: false,
      }),
      Underline,
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      TextAlign.configure({
        types: ["heading", "paragraph"],
      }),
      Table.configure({ resizable: true }),
      TableRow,
      TableCell,
      TableHeader,
      PageBreak,
      Placeholder.configure({
        placeholder: "Start editing your document...",
      }),
    ],
    content: "",
    immediatelyRender: false,
    onUpdate: ({ editor }) => {
      const html = editor.getHTML();
      const plainText = htmlToPlainText(html);
      if (plainText !== lastEmittedRef.current) {
        lastEmittedRef.current = plainText;
        onChange(plainText);
      }
    },
    editorProps: {
      attributes: {
        class: "focus:outline-none",
      },
    },
  });

  // Sync external content changes into the editor
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    if (content !== lastEmittedRef.current) {
      lastEmittedRef.current = content;
      const html = plainTextToHtml(content);
      editor.commands.setContent(html);
    }
  }, [content, editor]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      editor?.destroy();
    };
  }, [editor]);

  if (!editor) {
    return null;
  }

  return (
    <div className="tiptap-editor flex flex-col border border-border rounded-md overflow-hidden bg-background">
      <DocumentEditorToolbar editor={editor} />
      <div className="tiptap-pages bg-muted/20 p-4 md:p-8 overflow-y-auto">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
