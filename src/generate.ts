import OpenAI from "openai";
import type { BusinessCaseJob } from "./db";

const client = new OpenAI({
  maxRetries: 0,
  timeout: 10 * 60 * 1000, // 10 minutes — shell tool generations are long-running
});

export interface GenerateResult {
  buffer: Buffer;
  fileName: string;
  fileSize: number;
}

const SYSTEM_PROMPT = `You are an expert business consultant and presentation designer. Use the slides skill to generate a professional business case PowerPoint presentation.

## Instructions

Use the slides skill to build the deck. Save the output to /mnt/data/business-case.pptx

## Slide Structure (3 required)

1. **Title & Executive Summary**

2. **Problem, Solution & Financial Impact**

3. **Roadmap, Risks & Recommendation**

## Completeness Contract

Treat the task as incomplete until ALL 3 slides are generated. Verify each one is present before finishing.`;

function buildUserPrompt(job: BusinessCaseJob): string {
  return `Generate a professional business case presentation for the following:

${job.description}

Do one brief web search to ground the deck in real data, then create all 3 required slides.`;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

export async function generateBusinessCase(
  job: BusinessCaseJob
): Promise<GenerateResult> {
  console.log(`[generate] job=${job.id} starting GPT-5.4 shell tool call`);

  const response = await client.responses.create({
    model: "gpt-5.4",
    reasoning: { effort: "medium" },
    max_output_tokens: 32768,
    tool_choice: "required",
    instructions: SYSTEM_PROMPT,
    tools: [
      {
        type: "shell" as const,
        environment: {
          type: "container_auto" as const,
          skills: [
            {
              type: "skill_reference" as const,
              skill_id: "slides",
              version: "latest",
            },
          ],
        },
      },
      {
        type: "web_search_preview" as const,
        search_context_size: "low" as const,
      },
    ],
    input: [
      {
        type: "message" as const,
        role: "user" as const,
        content: [{ type: "input_text" as const, text: buildUserPrompt(job) }],
      },
    ],
  });

  // Extract container ID from shell_call output items
  let containerId: string | null = null;
  for (const item of response.output) {
    if (
      item.type === "shell_call" &&
      item.environment?.type === "container_reference"
    ) {
      containerId = item.environment.container_id;
      break;
    }
  }

  if (!containerId) {
    throw new Error("No container ID found in GPT-5.4 response");
  }

  console.log(`[generate] job=${job.id} container=${containerId}, downloading PPTX`);

  // List files in the container and find the .pptx
  const files = await client.containers.files.list(containerId);
  let pptxFile: { id: string; path: string } | undefined;
  for await (const f of files) {
    if (f.path?.endsWith(".pptx")) {
      pptxFile = f;
      break;
    }
  }

  if (!pptxFile) {
    throw new Error("No .pptx file found in container");
  }

  // Download the file content
  const contentResponse = await client.containers.files.content.retrieve(
    pptxFile.id,
    { container_id: containerId }
  );
  const buffer = Buffer.from(await contentResponse.arrayBuffer());

  const slug = slugify(job.description);
  const fileName = `business-case-${slug}-${job.id}.pptx`;

  console.log(`[generate] job=${job.id} PPTX downloaded (${buffer.length} bytes)`);

  return {
    buffer,
    fileName,
    fileSize: buffer.length,
  };
}
