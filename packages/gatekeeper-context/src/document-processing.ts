import { Buffer } from "node:buffer";

const MAX_EXTRACTED_MARKDOWN_BYTES = 1_700_000;

export type DocumentExtraction = {
  markdown: string;
  extractor: "workers-ai-to-markdown";
};

/** Convert a binary document into bounded Markdown for the agent-facing Context Library. */
export async function extractDocumentToMarkdown(
  ai: Ai,
  filename: string,
  contentType: string,
  base64Body: string,
): Promise<DocumentExtraction> {
  let bytes = Buffer.from(base64Body, "base64");
  let result = await ai.toMarkdown(
    { name: filename, blob: new Blob([bytes], { type: contentType }) },
    {
      conversionOptions: {
        output: { format: "markdown" },
        // This enables the image/OCR path for image-only PDF pages where supported.
        pdf: { images: { convert: true } },
      },
    },
  );
  if (result.format === "error") throw new Error(`Document conversion failed: ${result.error}`);
  let markdown = result.data.trim();
  if (!markdown) throw new Error("Document conversion returned no text.");
  let encoded = new TextEncoder().encode(markdown);
  if (encoded.byteLength > MAX_EXTRACTED_MARKDOWN_BYTES) {
    markdown = new TextDecoder().decode(encoded.slice(0, MAX_EXTRACTED_MARKDOWN_BYTES));
    markdown += "\n\n[Extracted document truncated by the Context Library size limit.]";
  }
  return { markdown, extractor: "workers-ai-to-markdown" };
}
