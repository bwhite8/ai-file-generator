import Anthropic from "@anthropic-ai/sdk";
import type { AnthropicBeta } from "@anthropic-ai/sdk/resources/beta/beta";
import type { BusinessCaseJob } from "./db";

const client = new Anthropic();

export interface GenerateResult {
  buffer: Buffer;
  fileName: string;
  fileSize: number;
}

const SYSTEM_PROMPT = `You are an expert business consultant and presentation designer. Use the pptx skill to generate an executive business case PowerPoint presentation.

## Instructions

Use the pptx skill to build the deck with python-pptx. Adhere to all guidelines in SKILL.md. Save the output as a .pptx file.

## Slide Structure (5 required)

1. Title & Executive Summary
2. Problem Statement & Current Pain Points
3. Proposed Solution & Operating Model
4. Financial Impact & ROI Analysis
5. Roadmap, Risks & Recommendation

## Completeness Contract

Treat the task as incomplete until ALL 5 slides are generated. Verify each slide is present before finishing. All slides must be professional, visually appealing, and boardroom-ready.`;

function buildUserPrompt(job: BusinessCaseJob): string {
  return `Generate a professional business case presentation for the following:

${job.description}

Do up to three web searches to ground the deck in real data, then create all 5 required slides.`;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

const BETAS: AnthropicBeta[] = [
  "code-execution-2025-08-25",
  "skills-2025-10-02",
  "files-api-2025-04-14",
];

function extractFileId(content: Anthropic.Beta.BetaContentBlock[]): string | null {
  for (const block of content) {
    if (block.type === "code_execution_tool_result") {
      const resultContent = block.content;
      if (resultContent.type === "code_execution_result") {
        for (const item of resultContent.content) {
          if (item.type === "code_execution_output" && item.file_id?.endsWith(".pptx")) {
            return item.file_id;
          }
        }
      }
    }
  }
  return null;
}

export async function generateBusinessCase(
  job: BusinessCaseJob
): Promise<GenerateResult> {
  console.log(`[generate] job=${job.id} starting Claude Sonnet 4.6 code execution call`);

  const container = {
    skills: [
      {
        type: "anthropic" as const,
        skill_id: "pptx",
        version: "latest",
      },
    ],
  };

  // name omitted — the API auto-injects names for built-in tool types
  const tools = [
    { type: "code_execution_20250825" },
    { type: "web_search_20260209" },
  ] as Anthropic.Beta.BetaToolUnion[];

  let response = await client.beta.messages.create({
    model: "claude-sonnet-4-6-20250514",
    max_tokens: 16384,
    stream: false,
    betas: BETAS,
    container,
    tools,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user" as const, content: buildUserPrompt(job) }],
  });
  let containerId = response.container?.id;
  let attempts = 0;

  while (response.stop_reason === "pause_turn" && attempts < 10) {
    attempts++;
    console.log(`[generate] job=${job.id} pause_turn, continuing (attempt ${attempts})`);
    response = await client.beta.messages.create({
      model: "claude-sonnet-4-6-20250514",
      max_tokens: 16384,
      stream: false,
      betas: BETAS,
      container: containerId ? { id: containerId } : container,
      tools,
      system: SYSTEM_PROMPT,
      messages: [
        { role: "user" as const, content: buildUserPrompt(job) },
        { role: "assistant" as const, content: response.content },
        { role: "user" as const, content: "Continue." },
      ],
    });
    containerId = response.container?.id ?? containerId;
  }

  // Extract file ID from code execution results
  const fileId = extractFileId(response.content);

  if (!fileId) {
    throw new Error("No .pptx file found in Claude response");
  }

  console.log(`[generate] job=${job.id} fileId=${fileId}, downloading PPTX`);

  // Download the file via the Files API
  const fileResponse = await client.beta.files.download(fileId, { betas: BETAS });
  const buffer = Buffer.from(await fileResponse.arrayBuffer());

  const slug = slugify(job.description);
  const fileName = `business-case-${slug}-${job.id}.pptx`;

  console.log(`[generate] job=${job.id} PPTX downloaded (${buffer.length} bytes)`);

  return {
    buffer,
    fileName,
    fileSize: buffer.length,
  };
}
