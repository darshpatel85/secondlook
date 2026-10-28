import type { ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const blockComponents: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
};

const inlineComponents: Components = {
  ...blockComponents,
  p: ({ children }) => <>{children}</>,
};

const inlineElements = ["p", "code", "strong", "em", "del", "a"];

export function Markdown({ text, inline = false }: { text: string; inline?: boolean }): ReactNode {
  if (inline) {
    return (
      <ReactMarkdown remarkPlugins={[remarkGfm]} allowedElements={inlineElements} unwrapDisallowed components={inlineComponents}>
        {text}
      </ReactMarkdown>
    );
  }
  return (
    <div className="markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={blockComponents}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
