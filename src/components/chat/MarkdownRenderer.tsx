/**
 * Markdown Renderer
 * Lightweight markdown rendering for chat messages
 * Supports: bold, italic, code, links, lists, headers
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
 * Parse markdown to HTML
 */
function parseMarkdown(text: string): string {
  if (!text) return '';

  let html = text;

  // Escape HTML to prevent XSS
  html = escapeHtml(html);

  // Code blocks (```code```) - must be done before inline code
  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    return `<pre class="code-block"><code class="language-${lang}">${code.trim()}</code></pre>`;
  });

  // Inline code (`code`)
  html = html.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');

  // Headers (## Header)
  html = html.replace(/^### (.+)$/gm, '<h4 class="md-h4">$1</h4>');
  html = html.replace(/^## (.+)$/gm, '<h3 class="md-h3">$1</h3>');
  html = html.replace(/^# (.+)$/gm, '<h2 class="md-h2">$1</h2>');

  // Bold (**text** or __text__)
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__([^_]+)__/g, '<strong>$1</strong>');

  // Italic (*text* or _text_)
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  html = html.replace(/_([^_]+)_/g, '<em>$1</em>');

  // Strikethrough (~~text~~)
  html = html.replace(/~~([^~]+)~~/g, '<del>$1</del>');

  // Links [text](url)
  html = html.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer" class="md-link">$1</a>'
  );

  // Unordered lists (- item or * item)
  html = html.replace(/^[\-\*] (.+)$/gm, '<li class="md-li">$1</li>');
  // Wrap consecutive <li> in <ul>
  html = html.replace(/((?:<li class="md-li">.*<\/li>\n?)+)/g, '<ul class="md-ul">$1</ul>');

  // Ordered lists (1. item)
  html = html.replace(/^\d+\. (.+)$/gm, '<li class="md-oli">$1</li>');
  // Wrap consecutive ordered <li> in <ol>
  html = html.replace(/((?:<li class="md-oli">.*<\/li>\n?)+)/g, '<ol class="md-ol">$1</ol>');

  // Horizontal rule (--- or ***)
  html = html.replace(/^(---|\*\*\*)$/gm, '<hr class="md-hr" />');

  // Blockquotes (> text)
  html = html.replace(/^> (.+)$/gm, '<blockquote class="md-quote">$1</blockquote>');
  // Merge consecutive blockquotes
  html = html.replace(/<\/blockquote>\n<blockquote class="md-quote">/g, '<br/>');

  // Line breaks - convert double newlines to paragraphs
  html = html.replace(/\n\n+/g, '</p><p class="md-p">');
  // Single newlines to <br>
  html = html.replace(/\n/g, '<br/>');

  // Wrap in paragraph if not starting with block element
  if (!html.startsWith('<')) {
    html = `<p class="md-p">${html}</p>`;
  }

  // Clean up empty paragraphs
  html = html.replace(/<p class="md-p"><\/p>/g, '');
  html = html.replace(/<p class="md-p">(<(?:ul|ol|h[2-4]|pre|blockquote|hr))/g, '$1');
  html = html.replace(/(<\/(?:ul|ol|h[2-4]|pre|blockquote)>)<\/p>/g, '$1');

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
