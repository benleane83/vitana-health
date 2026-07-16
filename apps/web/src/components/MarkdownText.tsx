import type { ReactNode } from "react";

const blockStart = /^(#{1,6})\s+|^\s*[-+*]\s+|^\s*\d+\.\s+/;
const inlineToken = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;

function renderInline(text: string): ReactNode[] {
  return text.split(inlineToken).filter(Boolean).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("*") && part.endsWith("*")) {
      return <em key={index}>{part.slice(1, -1)}</em>;
    }
    if (part.startsWith("`") && part.endsWith("`")) {
      return <code key={index}>{part.slice(1, -1)}</code>;
    }
    return part;
  });
}

export function MarkdownText({ children }: { children: string }) {
  const lines = children.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];

  for (let index = 0; index < lines.length;) {
    const line = lines[index].trimEnd();
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      const content = renderInline(heading[2]);
      const level = heading[1].length;
      blocks.push(level <= 2 ? <h4 key={index}>{content}</h4> : <h5 key={index}>{content}</h5>);
      index += 1;
      continue;
    }

    const unordered = /^\s*[-+*]\s+(.+)$/.exec(line);
    if (unordered) {
      const items: ReactNode[] = [];
      while (index < lines.length) {
        const item = /^\s*[-+*]\s+(.+)$/.exec(lines[index]);
        if (!item) break;
        items.push(<li key={index}>{renderInline(item[1].trim())}</li>);
        index += 1;
      }
      blocks.push(<ul key={`ul-${index}`}>{items}</ul>);
      continue;
    }

    const ordered = /^\s*\d+\.\s+(.+)$/.exec(line);
    if (ordered) {
      const items: ReactNode[] = [];
      while (index < lines.length) {
        const item = /^\s*\d+\.\s+(.+)$/.exec(lines[index]);
        if (!item) break;
        items.push(<li key={index}>{renderInline(item[1].trim())}</li>);
        index += 1;
      }
      blocks.push(<ol key={`ol-${index}`}>{items}</ol>);
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length && lines[index].trim() && !blockStart.test(lines[index])) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    blocks.push(<p key={`p-${index}`}>{renderInline(paragraph.join(" "))}</p>);
  }

  return <div className="markdown-text">{blocks}</div>;
}
