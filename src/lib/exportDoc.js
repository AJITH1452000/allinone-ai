// Export ONE answer as a document: Markdown (.md), Word (.docx) or PDF (print dialog → "Save as PDF").
import { chatToHtml } from '../components/ShareDialog';

const save = (blob, name) => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
const fileBase = (title) => (title || 'answer').replace(/[^\w\s-]/g, '').trim().slice(0, 40) || 'answer';

export const exportAnswerMarkdown = (text, title) => save(new Blob([text], { type: 'text/markdown' }), `${fileBase(title)}.md`);

// Markdown → Word: headings, bullets/numbered lists, code blocks (monospace), **bold**, `code`, plain paragraphs
export async function exportAnswerDocx(text, title) {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel } = await import('docx');
  const runs = (line) => line.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean).map((part) => (
    part.startsWith('**') ? new TextRun({ text: part.slice(2, -2), bold: true })
      : part.startsWith('`') ? new TextRun({ text: part.slice(1, -1), font: 'Consolas' })
        : new TextRun(part.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)'))));
  const children = [new Paragraph({ text: title || 'Answer', heading: HeadingLevel.TITLE })];
  let inCode = false;
  for (const line of text.replace(/<\/?(artifact|file)[^>]*>/g, '```').split('\n')) {
    if (/^```/.test(line)) { inCode = !inCode; continue; }
    if (inCode) { children.push(new Paragraph({ children: [new TextRun({ text: line || ' ', font: 'Consolas', size: 19 })] })); continue; }
    const h = /^(#{1,3})\s+(.*)/.exec(line);
    if (h) children.push(new Paragraph({ text: h[2], heading: [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3][h[1].length - 1] }));
    else if (/^\s*[-*]\s+/.test(line)) children.push(new Paragraph({ children: runs(line.replace(/^\s*[-*]\s+/, '')), bullet: { level: 0 } }));
    else if (/^\s*\d+\.\s+/.test(line)) children.push(new Paragraph({ children: runs(line.replace(/^\s*\d+\.\s+/, '')), bullet: { level: 0 } }));
    else if (line.trim() && !/^\s*---\s*$/.test(line)) children.push(new Paragraph({ children: runs(line) }));
  }
  save(await Packer.toBlob(new Document({ sections: [{ children }] })), `${fileBase(title)}.docx`);
}

// PDF: the same page as "Download as web page", in a new window → the browser's print dialog (choose "Save as PDF")
export function exportAnswerPdf(text, title, model) {
  const html = chatToHtml({ title: title || 'Answer', messages: [{ role: 'assistant', content: text, model }] })
    .replace('</head>', '<style>@media print { body { margin: 12mm; } pre { white-space: pre-wrap; } a { color: inherit; } }</style></head>');
  const w = window.open('', '_blank');
  if (!w) return alert('Allow pop-ups for this site to save as PDF.');
  w.document.write(html); w.document.close();
  w.onload = () => setTimeout(() => w.print(), 300);
  setTimeout(() => { try { w.print(); } catch {} }, 1200);
}
