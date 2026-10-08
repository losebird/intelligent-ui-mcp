/** Minimal safe Markdown → HTML (no raw HTML passthrough). */
export function renderMarkdownToHtml(src: string): string {
  const escaped = src
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  const lines = escaped.split(/\r?\n/);
  const out: string[] = [];
  let inCode = false;
  let inTable = false;
  let tableBuf: string[] = [];

  const flushTable = () => {
    if (!tableBuf.length) return;
    const rows = tableBuf.filter((r) => !/^\s*\|?\s*[-:]+/.test(r));
    out.push("<table>");
    rows.forEach((row, i) => {
      const cells = row
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((c) => c.trim());
      const tag = i === 0 ? "th" : "td";
      out.push(
        "<tr>" + cells.map((c) => `<${tag}>${inline(c)}</${tag}>`).join("") + "</tr>",
      );
    });
    out.push("</table>");
    tableBuf = [];
    inTable = false;
  };

  const inline = (s: string) =>
    s
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>");

  for (const line of lines) {
    if (line.startsWith("```")) {
      if (inCode) {
        out.push("</code></pre>");
        inCode = false;
      } else {
        flushTable();
        out.push("<pre><code>");
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      out.push(line + "\n");
      continue;
    }
    if (line.trim().startsWith("|")) {
      inTable = true;
      tableBuf.push(line);
      continue;
    } else if (inTable) {
      flushTable();
    }
    if (/^### /.test(line)) out.push(`<h3>${inline(line.slice(4))}</h3>`);
    else if (/^## /.test(line)) out.push(`<h2>${inline(line.slice(3))}</h2>`);
    else if (/^# /.test(line)) out.push(`<h1>${inline(line.slice(2))}</h1>`);
    else if (/^[-*] /.test(line)) out.push(`<li>${inline(line.slice(2))}</li>`);
    else if (!line.trim()) out.push("<br/>");
    else out.push(`<p>${inline(line)}</p>`);
  }
  flushTable();
  if (inCode) out.push("</code></pre>");
  return out.join("");
}
