"use client";

import React, { useCallback, useRef } from "react";
import type { Editor } from "@tiptap/react";
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  List,
  ListOrdered,
  Heading1,
  Heading2,
  Heading3,
  Table as TableIcon,
  Undo2,
  Redo2,
  AlignLeft,
  AlignCenter,
  AlignRight,
  AlignJustify,
  RemoveFormatting,
  Highlighter,
  Palette,
} from "lucide-react";

interface ToolbarProps {
  editor: Editor;
}

function TbBtn({
  onClick,
  active,
  children,
  label,
}: {
  onClick: (e: React.MouseEvent) => void;
  active?: boolean;
  children: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onMouseDown={onClick}
      title={label}
      aria-label={label}
      className={
        "flex h-7 min-w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground aria-[pressed=true]:bg-primary/10 aria-[pressed=true]:text-primary"
      }
      aria-pressed={active}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <div className="mx-0.5 h-4 w-px bg-border" />;
}

function ColorPicker({
  label,
  icon,
  value,
  onChange,
}: {
  label: string;
  icon: React.ReactNode;
  value: string;
  onChange: (color: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      inputRef.current?.click();
    },
    [],
  );

  return (
    <>
      <button
        type="button"
        onMouseDown={handleClick}
        title={label}
        aria-label={label}
        className="relative flex h-7 min-w-7 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
      >
        {icon}
        <span
          className="absolute bottom-0.5 left-1/2 h-1 w-3 -translate-x-1/2 rounded-full"
          style={{ backgroundColor: value || "transparent" }}
        />
      </button>
      <input
        ref={inputRef}
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="sr-only"
        tabIndex={-1}
      />
    </>
  );
}

export function DocumentEditorToolbar({ editor }: ToolbarProps) {
  const setColor = useCallback(
    (color: string) => {
      editor.chain().focus().setColor(color).run();
    },
    [editor],
  );

  const setHighlight = useCallback(
    (color: string) => {
      editor.chain().focus().toggleHighlight({ color }).run();
    },
    [editor],
  );

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-border bg-background px-3 py-1.5 font-sans">
      {/* ── Headings ── */}
      <TbBtn
        label="Heading 1"
        onClick={(e) => {
          e.preventDefault();
          editor.chain().focus().toggleHeading({ level: 1 }).run();
        }}
        active={editor.isActive("heading", { level: 1 })}
      >
        <Heading1 className="h-3.5 w-3.5" />
      </TbBtn>
      <TbBtn
        label="Heading 2"
        onClick={(e) => {
          e.preventDefault();
          editor.chain().focus().toggleHeading({ level: 2 }).run();
        }}
        active={editor.isActive("heading", { level: 2 })}
      >
        <Heading2 className="h-3.5 w-3.5" />
      </TbBtn>
      <TbBtn
        label="Heading 3"
        onClick={(e) => {
          e.preventDefault();
          editor.chain().focus().toggleHeading({ level: 3 }).run();
        }}
        active={editor.isActive("heading", { level: 3 })}
      >
        <Heading3 className="h-3.5 w-3.5" />
      </TbBtn>

      <Divider />

      {/* ── Text formatting ── */}
      <TbBtn
        label="Bold"
        onClick={(e) => {
          e.preventDefault();
          editor.chain().focus().toggleBold().run();
        }}
        active={editor.isActive("bold")}
      >
        <Bold className="h-3.5 w-3.5" />
      </TbBtn>
      <TbBtn
        label="Italic"
        onClick={(e) => {
          e.preventDefault();
          editor.chain().focus().toggleItalic().run();
        }}
        active={editor.isActive("italic")}
      >
        <Italic className="h-3.5 w-3.5" />
      </TbBtn>
      <TbBtn
        label="Underline"
        onClick={(e) => {
          e.preventDefault();
          editor.chain().focus().toggleUnderline().run();
        }}
        active={editor.isActive("underline")}
      >
        <Underline className="h-3.5 w-3.5" />
      </TbBtn>
      <TbBtn
        label="Strikethrough"
        onClick={(e) => {
          e.preventDefault();
          editor.chain().focus().toggleStrike().run();
        }}
        active={editor.isActive("strike")}
      >
        <Strikethrough className="h-3.5 w-3.5" />
      </TbBtn>

      <Divider />

      {/* ── Color & Highlight ── */}
      <ColorPicker
        label="Text color"
        icon={<Palette className="h-3.5 w-3.5" />}
        value={editor.getAttributes("textStyle").color || "#000000"}
        onChange={setColor}
      />
      <ColorPicker
        label="Highlight color"
        icon={<Highlighter className="h-3.5 w-3.5" />}
        value={editor.getAttributes("highlight").color || "#ffff00"}
        onChange={setHighlight}
      />

      <TbBtn
        label="Clear formatting"
        onClick={(e) => {
          e.preventDefault();
          editor.chain().focus().clearNodes().unsetAllMarks().run();
        }}
      >
        <RemoveFormatting className="h-3.5 w-3.5" />
      </TbBtn>

      <Divider />

      {/* ── Alignment ── */}
      <TbBtn
        label="Align left"
        onClick={(e) => {
          e.preventDefault();
          editor.chain().focus().setTextAlign("left").run();
        }}
        active={editor.isActive({ textAlign: "left" })}
      >
        <AlignLeft className="h-3.5 w-3.5" />
      </TbBtn>
      <TbBtn
        label="Align center"
        onClick={(e) => {
          e.preventDefault();
          editor.chain().focus().setTextAlign("center").run();
        }}
        active={editor.isActive({ textAlign: "center" })}
      >
        <AlignCenter className="h-3.5 w-3.5" />
      </TbBtn>
      <TbBtn
        label="Align right"
        onClick={(e) => {
          e.preventDefault();
          editor.chain().focus().setTextAlign("right").run();
        }}
        active={editor.isActive({ textAlign: "right" })}
      >
        <AlignRight className="h-3.5 w-3.5" />
      </TbBtn>
      <TbBtn
        label="Justify"
        onClick={(e) => {
          e.preventDefault();
          editor.chain().focus().setTextAlign("justify").run();
        }}
        active={editor.isActive({ textAlign: "justify" })}
      >
        <AlignJustify className="h-3.5 w-3.5" />
      </TbBtn>

      <Divider />

      {/* ── Lists ── */}
      <TbBtn
        label="Bullet list"
        onClick={(e) => {
          e.preventDefault();
          editor.chain().focus().toggleBulletList().run();
        }}
        active={editor.isActive("bulletList")}
      >
        <List className="h-3.5 w-3.5" />
      </TbBtn>
      <TbBtn
        label="Ordered list"
        onClick={(e) => {
          e.preventDefault();
          editor.chain().focus().toggleOrderedList().run();
        }}
        active={editor.isActive("orderedList")}
      >
        <ListOrdered className="h-3.5 w-3.5" />
      </TbBtn>

      <Divider />

      {/* ── Table ── */}
      <TbBtn
        label="Insert table"
        onClick={(e) => {
          e.preventDefault();
          editor
            .chain()
            .focus()
            .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
            .run();
        }}
        active={editor.isActive("table")}
      >
        <TableIcon className="h-3.5 w-3.5" />
      </TbBtn>

      {/* ── Undo / Redo (right-aligned) ── */}
      <div className="ml-auto flex items-center gap-0.5">
        <TbBtn
          label="Undo"
          onClick={(e) => {
            e.preventDefault();
            editor.chain().focus().undo().run();
          }}
        >
          <Undo2 className="h-3.5 w-3.5" />
        </TbBtn>
        <TbBtn
          label="Redo"
          onClick={(e) => {
            e.preventDefault();
            editor.chain().focus().redo().run();
          }}
        >
          <Redo2 className="h-3.5 w-3.5" />
        </TbBtn>
      </div>
    </div>
  );
}
