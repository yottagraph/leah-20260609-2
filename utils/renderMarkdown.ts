/**
 * Minimal, dependency-free Markdown → HTML renderer for agent chat
 * messages. LLM/ADK agents answer in GitHub-flavoured Markdown (tables,
 * bold, lists, headings); rendered verbatim that shows up as raw
 * `|`-delimited source. This renders the common subset to HTML so any
 * surface that displays an agent reply (the built-in chat, or a custom
 * "Ask" panel) shows a real table instead of pipes.
 *
 * SECURITY: the whole input is HTML-escaped FIRST, so agent output can
 * never inject markup — every tag this function emits is one it created
 * itself from a recognised Markdown token. Safe to pass to `v-html`.
 *
 * Supported: fenced + inline code, headings (#..######), bold, italic,
 * links ([text](http…)), unordered/ordered lists, GFM pipe tables,
 * blockquotes, horizontal rules, and paragraphs with soft line breaks.
 */
export function renderMarkdown(src: string): string {
    if (!src) return '';

    // 1. Escape everything up front — all downstream tokens operate on
    //    safe text, and any literal `<`/`>`/`&` renders verbatim.
    const esc = escapeHtml(src);

    // 2. Pull fenced code blocks out so their contents are never treated
    //    as Markdown. Replace with placeholders, restore at the end.
    const codeBlocks: string[] = [];
    const withoutFences = esc.replace(/```[^\n]*\n([\s\S]*?)```/g, (_m, body) => {
        codeBlocks.push(`<pre class="md-pre"><code>${body.replace(/\n$/, '')}</code></pre>`);
        return `\u0000CODE${codeBlocks.length - 1}\u0000`;
    });

    const lines = withoutFences.split('\n');
    const html: string[] = [];
    let i = 0;

    const flushParagraph = (buf: string[]) => {
        if (buf.length === 0) return;
        html.push(`<p>${buf.map(inline).join('<br>')}</p>`);
        buf.length = 0;
    };

    const paragraph: string[] = [];

    while (i < lines.length) {
        const line = lines[i];
        const trimmed = line.trim();

        // Code-block placeholder on its own line.
        if (/^\u0000CODE\d+\u0000$/.test(trimmed)) {
            flushParagraph(paragraph);
            html.push(codeBlocks[Number(trimmed.match(/\d+/)![0])]);
            i++;
            continue;
        }

        // Blank line → paragraph break.
        if (trimmed === '') {
            flushParagraph(paragraph);
            i++;
            continue;
        }

        // Horizontal rule.
        if (/^([-*_])\1{2,}$/.test(trimmed)) {
            flushParagraph(paragraph);
            html.push('<hr>');
            i++;
            continue;
        }

        // Heading.
        const heading = trimmed.match(/^(#{1,6})\s+(.*)$/);
        if (heading) {
            flushParagraph(paragraph);
            const level = heading[1].length;
            html.push(`<h${level} class="md-h">${inline(heading[2])}</h${level}>`);
            i++;
            continue;
        }

        // GFM table: a header row followed by a separator row of dashes.
        if (line.includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
            flushParagraph(paragraph);
            const header = splitRow(line);
            i += 2; // consume header + separator
            const body: string[][] = [];
            while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
                body.push(splitRow(lines[i]));
                i++;
            }
            html.push(renderTable(header, body));
            continue;
        }

        // Blockquote (one or more consecutive `>` lines).
        if (/^>\s?/.test(trimmed)) {
            flushParagraph(paragraph);
            const quote: string[] = [];
            while (i < lines.length && /^>\s?/.test(lines[i].trim())) {
                quote.push(lines[i].trim().replace(/^>\s?/, ''));
                i++;
            }
            html.push(
                `<blockquote class="md-quote">${quote.map(inline).join('<br>')}</blockquote>`
            );
            continue;
        }

        // Lists (unordered or ordered) — collect a contiguous run.
        if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
            flushParagraph(paragraph);
            const ordered = /^\s*\d+\.\s+/.test(line);
            const items: string[] = [];
            while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
                items.push(lines[i].replace(/^\s*([-*+]|\d+\.)\s+/, ''));
                i++;
            }
            const tag = ordered ? 'ol' : 'ul';
            html.push(
                `<${tag} class="md-list">${items.map((t) => `<li>${inline(t)}</li>`).join('')}</${tag}>`
            );
            continue;
        }

        // Otherwise accumulate into the current paragraph.
        paragraph.push(trimmed);
        i++;
    }
    flushParagraph(paragraph);

    return html.join('\n');
}

/** Inline-level formatting: code, links, bold, italic. Operates on escaped text. */
function inline(text: string): string {
    const spans: string[] = [];
    // Protect inline code first so bold/italic don't touch its contents.
    let out = text.replace(/`([^`]+)`/g, (_m, code) => {
        spans.push(`<code class="md-code">${code}</code>`);
        return `\u0001${spans.length - 1}\u0001`;
    });

    // Links: [label](http(s)://…) only — never javascript: etc.
    out = out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, label, url) => {
        return `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    });

    // Bold then italic (bold first so ** isn't eaten by single-* italic).
    out = out
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/__([^_]+)__/g, '<strong>$1</strong>')
        .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
        .replace(/(^|[^_])_([^_]+)_/g, '$1<em>$2</em>');

    // Restore inline code.
    out = out.replace(/\u0001(\d+)\u0001/g, (_m, n) => spans[Number(n)]);
    return out;
}

function isTableSeparator(line: string): boolean {
    const cells = splitRow(line);
    return cells.length > 0 && cells.every((c) => /^:?-{1,}:?$/.test(c.trim()));
}

/** Split a pipe-table row into trimmed cells, dropping the optional edge pipes. */
function splitRow(line: string): string[] {
    let s = line.trim();
    if (s.startsWith('|')) s = s.slice(1);
    if (s.endsWith('|')) s = s.slice(0, -1);
    return s.split('|').map((c) => c.trim());
}

function renderTable(header: string[], body: string[][]): string {
    const ths = header.map((h) => `<th>${inline(h)}</th>`).join('');
    const rows = body
        .map((row) => {
            const tds = header.map((_h, idx) => `<td>${inline(row[idx] ?? '')}</td>`).join('');
            return `<tr>${tds}</tr>`;
        })
        .join('');
    return `<div class="md-table-wrap"><table class="md-table"><thead><tr>${ths}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

function escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
