"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

/**
 * Renders one assistant text block as Markdown with GFM (tables, task
 * lists, strikethrough). Styled to match the chat bubble density.
 * Deliberately opinionated — no custom rehype plugins, no HTML
 * passthrough — so the surface is tight and safe.
 */
export function AssistantMarkdown({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "text-sm leading-relaxed text-foreground/90",
        // Nested styling scoped to descendants — Tailwind's `prose`
        // would be heavier than we want in a chat bubble.
        "[&_strong]:font-semibold [&_em]:italic",
        "[&_p]:my-2 first:[&_p]:mt-0 last:[&_p]:mb-0",
        "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5",
        "[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5",
        "[&_li]:my-0.5",
        "[&_a]:text-lamp [&_a]:underline [&_a]:underline-offset-2",
        "[&_h1]:mt-3 [&_h1]:mb-1 [&_h1]:font-display [&_h1]:text-base [&_h1]:font-semibold",
        "[&_h2]:mt-3 [&_h2]:mb-1 [&_h2]:font-display [&_h2]:text-sm [&_h2]:font-semibold",
        "[&_h3]:mt-2 [&_h3]:mb-1 [&_h3]:text-sm [&_h3]:font-semibold",
        "[&_code]:rounded [&_code]:bg-muted/60 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[12px]",
        "[&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted/40 [&_pre]:p-3 [&_pre]:font-mono [&_pre]:text-[11px] [&_pre]:leading-snug",
        "[&_pre_code]:bg-transparent [&_pre_code]:p-0",
        "[&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-lamp/50 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
        "[&_hr]:my-3 [&_hr]:border-border/60",
        // Table styling — GFM pipe tables become <table>.
        "[&_table]:my-3 [&_table]:w-full [&_table]:border-collapse [&_table]:text-[12px]",
        "[&_thead]:border-b [&_thead]:border-border/70",
        "[&_th]:py-1.5 [&_th]:pr-3 [&_th]:text-left [&_th]:font-semibold [&_th]:text-muted-foreground",
        "[&_td]:py-1 [&_td]:pr-3 [&_td]:align-top",
        "[&_tbody_tr]:border-b [&_tbody_tr]:border-border/40 last:[&_tbody_tr]:border-b-0",
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        // Deny raw HTML — everything comes from the model as
        // markdown-only text, and we don't want an accidental XSS
        // surface if the model echoes something back.
        skipHtml
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
