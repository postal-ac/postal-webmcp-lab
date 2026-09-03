/**
 * Read a dropped PDF brief in the browser and expose its text to the get_brief
 * tool. pdf.js is imported lazily — it is megabytes of parser that only
 * people who actually drop a file should pay for.
 *
 * Note the isEvalSupported flag: briefs arrive from outside (labels,
 * supervisors), so PDF-embedded scripts must stay inert.
 */
const MAX_BRIEF_CHARS = 4000;
const MAX_PAGES = 5;

export async function extractPdfText(file: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

  // v6 removed the isEvalSupported escape hatch entirely — embedded PDF
  // scripts are inert by construction, which is why the dependency floor is
  // 6.2.108 (GHSA-hq66-cqwq-w95j).
  const loadingTask = pdfjs.getDocument({ data: await file.arrayBuffer() });
  const document = await loadingTask.promise;

  const pages: string[] = [];
  const pageCount = Math.min(document.numPages, MAX_PAGES);
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    pages.push(
      content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim(),
    );
  }
  await loadingTask.destroy();
  return pages.join("\n\n").trim();
}

export function buildBriefPrompt(briefText: string): string {
  const trimmed =
    briefText.length > MAX_BRIEF_CHARS
      ? `${briefText.slice(0, MAX_BRIEF_CHARS)}…`
      : briefText;
  return [
    "We received this brief. Fulfil it using the catalogue on this page —",
    "search for matching tracks, build the requested playlist, and follow the",
    "brief's delivery instructions.",
    "",
    "--- BRIEF ---",
    trimmed,
  ].join("\n");
}
