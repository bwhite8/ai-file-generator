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

1. Use the slides skill to build the deck. Save the output to /mnt/data/business-case.pptx
2. Run the skill's validation scripts (render, overflow check) before finalizing.

## Slide Structure (3 required)

Each slide is dense and multi-panel. Use the full widescreen canvas — no wasted space.

1. **Title & Executive Summary** — Top half: initiative name, sponsor, and date in a bold title treatment. Bottom half: concise framing of the opportunity and recommendation (3-4 sentences max).

2. **Problem, Solution & Financial Impact** — Multi-panel layout. Left column: the problem/opportunity with supporting evidence. Right column: proposed solution, high-level approach, and key differentiators. Bottom section: a compact financial table showing costs, benefits, ROI, and payback period. Use a native table or chart for the financial data.

3. **Roadmap, Risks & Recommendation** — Top section: a phased implementation timeline visual with milestones. Middle section: a compact risk table (risk, likelihood, mitigation) with 3-4 key risks. Bottom section: success KPIs and a clear call to action.

## Design Requirements

- Widescreen 16:9 layout
- Clean, modern professional design with dense, multi-panel layouts
- Color palette: primary #1B2A4A (dark navy), accent #2D82B7 (blue), highlight #F4A261 (warm orange), text #FFFFFF on dark backgrounds, #1B2A4A on light backgrounds, light background #F5F5F5
- Font: Calibri throughout. Title text 28-36pt, body text 16-20pt, caption text 12-14pt
- Include subtle geometric shapes or accent bars for visual interest
- Consistent header/footer treatment across all slides
- Use native charts/tables for financial data, not just bullet points
- Add slide numbers

## Completeness Contract

Treat the task as incomplete until ALL 3 slides are generated. Verify each one is present before finishing.`;

function buildUserPrompt(job: BusinessCaseJob): string {
  return `Generate a professional business case presentation for the following:

${job.description}

Create all 3 required slides with substantive, realistic content based on the description above. Do 2-3 brief web searches upfront to ground the deck in real data — market sizing, industry trends, competitive landscape, or technical details relevant to the topic. Then build the deck. Each slide should be dense and multi-panel — use the full canvas. The presentation should be ready for executive review.`;
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
    text: { verbosity: "high" },
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
