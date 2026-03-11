import OpenAI from "openai";
import type { BusinessCaseJob } from "./db";

const client = new OpenAI({
  maxRetries: 0,
  timeout: 15 * 60 * 1000, // 15 minutes — shell tool generations with image gen are long-running
});

export interface GenerateResult {
  buffer: Buffer;
  fileName: string;
  fileSize: number;
}

const SYSTEM_PROMPT = `You are an expert business consultant and presentation designer. Use the slides skill to generate an executive business case PowerPoint presentation.

## Instructions

Use the slides skill to build the deck. You MUST use PptxGenJS (not python-pptx) with the helpers from the pptxgenjs_helpers directory. Adhere to all guidelines in SKILL.md. Save the output to /mnt/data/business-case.pptx

## Slide Structure (5 required)

1. Title & Executive Summary
2. Problem Statement & Current Pain Points
3. Proposed Solution & Operating Model
4. Financial Impact & ROI Analysis
5. Roadmap, Risks & Recommendation

## Visuals

Generate 1-2 images to use as hero visuals in the deck. Use them for title slides or as panel accents — never as full-slide backgrounds that would cause overlap warnings.

## Layout Quality Rules

- For decorative or background visuals, use slide.background or place the image FIRST and keep all other elements in non-overlapping regions (e.g. left panel text, right panel image).
- Do NOT layer text or shapes on top of addImage elements — this triggers overlap warnings.
- NEVER remove or disable warnIfSlideHasOverlaps or warnIfSlideElementsOutOfBounds. If overlaps are detected, you MUST rewrite the layout to eliminate them. Taking shortcuts like disabling the checker is not acceptable.
- After generating all slides, run render_slides.py and create_montage.py to produce a visual preview, then run slides_test.py to verify no overflow.
- If any severe overlap or out-of-bounds errors remain, fix them before saving the final file.

## Completeness Contract

Treat the task as incomplete until ALL 5 slides are generated and pass overlap/bounds validation. Verify each slide is present before finishing. All slides must be professional, visually appealing, and boardroom-ready.`;

function buildUserPrompt(job: BusinessCaseJob): string {
  return `Generate a professional business case presentation for the following:

${job.description}

Do one brief web search to ground the deck in real data, then create all 5 required slides.`;
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
    reasoning: { effort: "high" },
    max_output_tokens: 65536,
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
      {
        type: "image_generation" as const,
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
