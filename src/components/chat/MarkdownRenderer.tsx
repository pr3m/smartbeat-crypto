/**
 * Markdown Renderer
 * Lightweight markdown rendering for chat messages
 * Supports: bold, italic, code, links, lists, headers, blockquotes, hr
 */

'use client';

import { useMemo } from 'react';

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

export function MarkdownRenderer({ content, className = '' }: MarkdownRendererProps) {
  const rendered = useMemo(() => {
    return parseMarkdown(content);
  }, [content]);

  return (
    <div
      className={`markdown-content ${className}`}
      dangerouslySetInnerHTML={{ __html: rendered }}
    />
  );
}

/**
 * Parse markdown to HTML.
 * Uses a block-level approach: split into blocks first, then apply inline formatting.
 */
function parseMarkdown(text: string): string {
  if (!text) return '';

  // Normalize line endings
  let input = text.replace(/\r\n/g, '\n');

  // Split into blocks by double newlines (but preserve list continuity)
  // First, collapse blank lines between consecutive list items so they stay grouped
  input = input.replace(/^([ \t]*[-*] .+)\n\n+(?=[ \t]*[-*] )/gm, '$1\n');
  input = input.replace(/^([ \t]*\d+\. .+)\n\n+(?=[ \t]*\d+\. )/gm, '$1\n');

  // Split into blocks by double newlines
  const blocks = input.split(/\n{2,}/);
  const htmlBlocks: string[] = [];

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    // Code block
    if (trimmed.startsWith('```')) {
      const match = trimmed.match(/^```(\w*)\n?([\s\S]*?)```$/);
      if (match) {
        const code = escapeHtml(match[2].trim());
        htmlBlocks.push(`<pre class="code-block"><code class="language-${match[1]}">${code}</code></pre>`);
      } else {
        htmlBlocks.push(`<p class="md-p">${formatInline(trimmed)}</p>`);
      }
      continue;
    }

    // Horizontal rule
    if (/^(---|\*\*\*|___)$/.test(trimmed)) {
      htmlBlocks.push('<hr class="md-hr" />');
      continue;
    }

    // Header
    const headerMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (headerMatch) {
      const level = headerMatch[1].length + 1; // h2, h3, h4, h5
      const tag = `h${Math.min(level, 5)}`;
      htmlBlocks.push(`<${tag} class="md-${tag}">${formatInline(headerMatch[2])}</${tag}>`);
      continue;
    }

    // Unordered list block (lines starting with - or *)
    if (/^[\t ]*[-*] /m.test(trimmed)) {
      const items = trimmed.split('\n');
      let listHtml = '<ul class="md-ul">';
      for (const item of items) {
        const liMatch = item.match(/^[\t ]*[-*] (.+)$/);
        if (liMatch) {
          listHtml += `<li class="md-li">${formatInline(liMatch[1])}</li>`;
        }
      }
      listHtml += '</ul>';
      htmlBlocks.push(listHtml);
      continue;
    }

    // Ordered list block (lines starting with 1. 2. etc)
    if (/^[\t ]*\d+\. /m.test(trimmed)) {
      const items = trimmed.split('\n');
      let listHtml = '<ol class="md-ol">';
      for (const item of items) {
        const liMatch = item.match(/^[\t ]*\d+\. (.+)$/);
        if (liMatch) {
          listHtml += `<li class="md-oli">${formatInline(liMatch[1])}</li>`;
        }
      }
      listHtml += '</ol>';
      htmlBlocks.push(listHtml);
      continue;
    }

    // Blockquote
    if (trimmed.startsWith('> ') || trimmed.startsWith('>')) {
      const lines = trimmed.split('\n').map(l => l.replace(/^>\s?/, ''));
      htmlBlocks.push(`<blockquote class="md-quote">${formatInline(lines.join('<br/>'))}</blockquote>`);
      continue;
    }

    // Regular paragraph - convert single newlines to <br/>
    const lines = trimmed.split('\n').map(l => formatInline(l)).join('<br/>');
    htmlBlocks.push(`<p class="md-p">${lines}</p>`);
  }

  return htmlBlocks.join('');
}

/**
 * Apply inline formatting (bold, italic, code, links, etc.)
 */
function formatInline(text: string): string {
  let html = escapeHtml(text);

  // Inline code (`code`) - do first to protect contents
  html = html.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');

  // Bold (**text** or __text__)
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');

  // Italic (*text* or _text_) - be careful not to match inside words with underscores
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  html = html.replace(/(?<!\w)_([^_]+)_(?!\w)/g, '<em>$1</em>');

  // Strikethrough (~~text~~)
  html = html.replace(/~~([^~]+)~~/g, '<del>$1</del>');

  // Links [text](url)
  html = html.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer" class="md-link">$1</a>'
  );

  return html;
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
  };
  return text.replace(/[&<>]/g, (char) => map[char] || char);
}
