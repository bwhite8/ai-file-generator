import Anthropic from "@anthropic-ai/sdk";
import type { AnthropicBeta } from "@anthropic-ai/sdk/resources/beta/beta";
import type { BusinessCaseJob } from "./db";

const client = new Anthropic({ maxRetries: 0 });
console.log(`[generate] Anthropic SDK initialized (maxRetries=0)`);

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
    if ((block as any).type === "bash_code_execution_tool_result") {
      const resultContent = (block as any).content;
      if (resultContent?.type === "bash_code_execution_result" && Array.isArray(resultContent.content)) {
        for (const item of resultContent.content) {
          if (item.type === "bash_code_execution_output" && item.filename?.endsWith(".pptx")) {
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

  const tools = [
    { type: "web_search_20260209", name: "web_search" },
  ] as any;

  const systemMessage = [
    {
      type: "text" as const,
      text: SYSTEM_PROMPT,
      cache_control: { type: "ephemeral" as const },
    },
  ];

  const userMessage = [
    {
      type: "text" as const,
      text: buildUserPrompt(job),
      cache_control: { type: "ephemeral" as const },
    },
  ];

  console.log(`[generate] job=${job.id} sending initial API call`);
  const startTime = Date.now();
  let apiCallCount = 1;

  let response = await client.beta.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 16384,
    stream: false,
    betas: BETAS,
    container,
    tools,
    system: systemMessage,
    messages: [{ role: "user" as const, content: userMessage }],
  });

  console.log(`[generate] job=${job.id} call #${apiCallCount} returned | stop_reason=${response.stop_reason} | usage: input=${response.usage.input_tokens} output=${response.usage.output_tokens} | elapsed=${Date.now() - startTime}ms`);

  let containerId = response.container?.id;
  console.log(`[generate] job=${job.id} containerId=${containerId}`);
  let attempts = 0;

  while (response.stop_reason === "pause_turn" && attempts < 10) {
    attempts++;
    apiCallCount++;
    const loopStart = Date.now();
    console.log(`[generate] job=${job.id} pause_turn loop attempt=${attempts} | sending call #${apiCallCount} | content blocks=${response.content.length}`);
    response = await client.beta.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 16384,
      stream: false,
      betas: BETAS,
      container: containerId ? { id: containerId } : container,
      tools,
      system: systemMessage,
      messages: [
        { role: "user" as const, content: userMessage },
        { role: "assistant" as const, content: response.content },
        { role: "user" as const, content: "Continue." },
      ],
    });
    containerId = response.container?.id ?? containerId;
    console.log(`[generate] job=${job.id} call #${apiCallCount} returned | stop_reason=${response.stop_reason} | usage: input=${response.usage.input_tokens} output=${response.usage.output_tokens} | elapsed=${Date.now() - loopStart}ms`);
  }

  console.log(`[generate] job=${job.id} loop finished | total API calls=${apiCallCount} | total elapsed=${Date.now() - startTime}ms | final stop_reason=${response.stop_reason}`);

  // Log response structure for debugging
  console.log(`[generate] job=${job.id} response content blocks (${response.content.length}):`);
  for (let i = 0; i < response.content.length; i++) {
    const block = response.content[i] as any;
    const summary: Record<string, unknown> = { type: block.type };
    if (block.content?.type) summary.contentType = block.content.type;
    if (block.content?.content && Array.isArray(block.content.content)) {
      summary.innerItems = block.content.content.map((item: any) => ({
        type: item.type,
        filename: item.filename,
        file_id: item.file_id,
      }));
    }
    console.log(`[generate]   block[${i}]: ${JSON.stringify(summary)}`);
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
