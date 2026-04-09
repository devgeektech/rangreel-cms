"use client";

import dynamic from "next/dynamic";
import { useMemo } from "react";
import { cn } from "@/lib/utils";
import "react-quill/dist/quill.snow.css";

const ReactQuill = dynamic(
  () => import("react-quill").then((mod) => mod.default),
  {
    ssr: false,
    loading: () => (
      <div
        className="min-h-[120px] animate-pulse rounded-lg border border-input bg-muted/40"
        aria-hidden
      />
    ),
  }
);

const defaultModules = {
  toolbar: [
    [{ header: [1, 2, 3, false] }],
    ["bold", "italic", "underline", "strike"],
    [{ list: "ordered" }, { list: "bullet" }],
    [{ indent: "-1" }, { indent: "+1" }],
    ["link"],
    ["blockquote", "code-block"],
    ["clean"],
  ],
};

const defaultFormats = [
  "header",
  "bold",
  "italic",
  "underline",
  "strike",
  "list",
  "bullet",
  "indent",
  "link",
  "blockquote",
  "code-block",
];

/**
 * HTML rich text using React Quill (popular, stores HTML strings).
 */
export function HtmlRichTextField({
  id,
  label,
  value,
  onChange,
  placeholder,
  disabled,
  className,
  minHeight = 120,
}) {
  const modules = useMemo(() => defaultModules, []);

  return (
    <div className={cn("space-y-1.5", className)}>
      {label ? (
        <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
          {label}
        </label>
      ) : null}
      <div
        id={id}
        className={cn(
          "rich-text-quill overflow-hidden rounded-lg border border-input bg-background shadow-xs",
          "[&_.ql-toolbar.ql-snow]:rounded-t-lg [&_.ql-toolbar.ql-snow]:border-border",
          "[&_.ql-container.ql-snow]:rounded-b-lg [&_.ql-container.ql-snow]:border-border",
          "dark:[&_.ql-toolbar.ql-snow]:border-border dark:[&_.ql-toolbar.ql-snow]:bg-muted/40",
          "dark:[&_.ql-container.ql-snow]:border-border dark:[&_.ql-container.ql-snow]:bg-background",
          "dark:[&_.ql-editor.ql-blank::before]:text-muted-foreground/70",
          "[&_.ql-editor]:min-h-[var(--rq-min)] [&_.ql-container]:min-h-[var(--rq-min)]",
          disabled && "pointer-events-none opacity-60"
        )}
        style={{ ["--rq-min"]: `${minHeight}px` }}
      >
        <ReactQuill
          theme="snow"
          value={value || ""}
          onChange={(html) => onChange?.(html)}
          modules={modules}
          formats={defaultFormats}
          readOnly={disabled}
          placeholder={placeholder}
          className="[&_.ql-editor]:text-sm [&_.ql-editor]:leading-relaxed"
        />
      </div>
    </div>
  );
}
