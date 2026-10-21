import { expect, it, mock } from "bun:test";
import JSZip from "jszip";

const mammothBrowserPath: string = "mammoth/mammoth.browser.js";
const mammothBrowser = await import(mammothBrowserPath);
mock.module("mammoth", () => mammothBrowser);
const { extractTextFromFile } = await import("@/lib/extract-text");

it("extracts plain text from a synthetic DOCX using Mammoth's library API", async () => {
  const archive = new JSZip();
  archive.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8"?>
     <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
       <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
       <Default Extension="xml" ContentType="application/xml"/>
       <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
     </Types>`,
  );
  archive.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8"?>
     <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
       <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
     </Relationships>`,
  );
  archive.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8"?>
     <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
       <w:body><w:p><w:r><w:t>Synthetic DOCX extraction works.</w:t></w:r></w:p><w:sectPr/></w:body>
     </w:document>`,
  );

  const contents = await archive.generateAsync({ type: "arraybuffer" });
  const file = new File([contents], "synthetic.docx", {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });

  const extracted = await extractTextFromFile(file);
  expect(extracted).toContain("Synthetic DOCX extraction works.");
});
