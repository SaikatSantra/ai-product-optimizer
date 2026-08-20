import { generateGeminiText } from "./gemini.server";

export type AIRecommendationPriority = "high" | "medium" | "low";

export type AIProductAnalysis = {
  score: number;

  summary: string;

  title: {
    current: string;
    suggested: string;
    reason: string;
  };

  description: {
    current: string;
    suggested: string;
    reason: string;
  };

  seo: {
    title: {
      current: string | null;
      suggested: string;
      reason: string;
    };

    description: {
      current: string | null;
      suggested: string;
      reason: string;
    };
  };

  tags: {
    current: string[];
    suggested: string[];
    reason: string;
  };

  recommendations: {
    priority: AIRecommendationPriority;
    category: string;
    recommendation: string;
  }[];
};

export type AIProductInput = {
  title: string;
  description: string;
  productType: string;
  vendor: string;
  tags: string[];
  seoTitle: string | null;
  seoDescription: string | null;
};

/* -------------------------------------------------------------------------- */
/* Provider types                                                             */
/* -------------------------------------------------------------------------- */

type AIProvider = "gemini" | "openai";

/* -------------------------------------------------------------------------- */
/* Provider detection                                                         */
/* -------------------------------------------------------------------------- */

function getAvailableProvider(): AIProvider {
  const hasGemini = Boolean(process.env.GEMINI_API_KEY?.trim());
  const hasOpenAI = Boolean(process.env.OPENAI_API_KEY?.trim());

  /*
   * Gemini has priority when both keys are configured.
   *
   * This means:
   *
   * Gemini only  -> Gemini
   * OpenAI only  -> OpenAI
   * Both         -> Gemini
   * Neither      -> error
   */

  if (hasGemini) {
    return "gemini";
  }

  if (hasOpenAI) {
    return "openai";
  }

  throw new Error(
    "No AI provider is configured. Add GEMINI_API_KEY or OPENAI_API_KEY.",
  );
}

/* -------------------------------------------------------------------------- */
/* Prompt                                                                     */
/* -------------------------------------------------------------------------- */

function buildProductAnalysisPrompt(product: AIProductInput): string {
  return `
You are an expert Shopify eCommerce, SEO and conversion optimization specialist.

Analyze the following Shopify product.

PRODUCT:

Title:
${product.title}

Description:
${product.description}

Product Type:
${product.productType}

Vendor:
${product.vendor}

Tags:
${product.tags.join(", ")}

SEO Title:
${product.seoTitle ?? ""}

SEO Description:
${product.seoDescription ?? ""}

Your task is to provide an optimized analysis.

Return ONLY valid JSON.

Do not use markdown.
Do not wrap the JSON in \`\`\`.
Do not add explanations outside the JSON.

Use exactly this structure:

{
  "score": 0,
  "summary": "string",

  "title": {
    "current": "string",
    "suggested": "string",
    "reason": "string"
  },

  "description": {
    "current": "string",
    "suggested": "string",
    "reason": "string"
  },

  "seo": {
    "title": {
      "current": "string or null",
      "suggested": "string",
      "reason": "string"
    },
    "description": {
      "current": "string or null",
      "suggested": "string",
      "reason": "string"
    }
  },

  "tags": {
    "current": [],
    "suggested": [],
    "reason": "string"
  },

  "recommendations": [
    {
      "priority": "high",
      "category": "string",
      "recommendation": "string"
    }
  ]
}

Important:

- score must be between 0 and 100.
- title.suggested should be clear, descriptive and useful for Shopify SEO.
- description.suggested should be detailed and conversion-focused.
- SEO title should normally be approximately 50-60 characters.
- SEO description should normally be approximately 140-160 characters.
- Suggested tags should be relevant to the product.
- recommendations priority must be exactly "high", "medium", or "low".
- Keep the recommendations practical.
`;
}

/* -------------------------------------------------------------------------- */
/* JSON cleaning                                                              */
/* -------------------------------------------------------------------------- */

function cleanAIResponse(response: string): string {
  return response
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

/* -------------------------------------------------------------------------- */
/* JSON validation                                                            */
/* -------------------------------------------------------------------------- */

function parseAnalysis(response: string): AIProductAnalysis {
  const cleanedResponse = cleanAIResponse(response);

  let parsed: unknown;

  try {
    parsed = JSON.parse(cleanedResponse);
  } catch (error) {
    console.error("[AI Product Optimizer] Invalid AI JSON:", response);

    throw new Error("AI returned an invalid analysis response.");
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error("AI returned an invalid analysis.");
  }

  const analysis = parsed as AIProductAnalysis;

  if (
    typeof analysis.score !== "number" ||
    typeof analysis.summary !== "string" ||
    !analysis.title ||
    !analysis.description ||
    !analysis.seo ||
    !analysis.tags ||
    !Array.isArray(analysis.recommendations)
  ) {
    throw new Error("AI returned an incomplete product analysis.");
  }

  return analysis;
}

/* -------------------------------------------------------------------------- */
/* OpenAI                                                                     */
/* -------------------------------------------------------------------------- */

async function generateOpenAIText(prompt: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",

    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },

    body: JSON.stringify({
      model: "gpt-4o-mini",

      messages: [
        {
          role: "system",
          content:
            "You are an expert Shopify product optimization and SEO assistant.",
        },

        {
          role: "user",
          content: prompt,
        },
      ],

      temperature: 0.4,
    }),
  });

  const data = (await response.json()) as {
    choices?: {
      message?: {
        content?: string | null;
      };
    }[];

    error?: {
      message?: string;
    };
  };

  if (!response.ok) {
    console.error("[OpenAI] API error:", data.error ?? data);

    throw new Error(
      data.error?.message ||
        `OpenAI request failed with status ${response.status}.`,
    );
  }

  const text = data.choices?.[0]?.message?.content;

  if (!text) {
    throw new Error("OpenAI returned an empty response.");
  }

  return text;
}

/* -------------------------------------------------------------------------- */
/* Main AI service                                                            */
/* -------------------------------------------------------------------------- */

export async function analyzeProductWithAI(
  product: AIProductInput,
): Promise<AIProductAnalysis> {
  const provider = getAvailableProvider();

  console.log(`[AI Product Optimizer] Using AI provider: ${provider}`);

  const prompt = buildProductAnalysisPrompt(product);

  let response: string;

  try {
    if (provider === "gemini") {
      response = (await generateGeminiText(prompt)) ?? "";
    } else {
      response = await generateOpenAIText(prompt);
    }
  } catch (error) {
    console.error(`[AI Product Optimizer] ${provider} analysis failed:`, error);

    throw new Error(
      `${provider === "gemini" ? "Gemini" : "OpenAI"} AI analysis failed: ${
        error instanceof Error ? error.message : "Unknown AI error."
      }`,
    );
  }

  if (!response?.trim()) {
    throw new Error(
      `${provider === "gemini" ? "Gemini" : "OpenAI"} returned an empty response.`,
    );
  }

  return parseAnalysis(response);
}
