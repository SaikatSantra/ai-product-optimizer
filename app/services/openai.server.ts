const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";

function getOpenAIKey(): string | null {
  const apiKey = process.env.OPENAI_API_KEY?.trim();

  if (!apiKey || apiKey === "your_openai_api_key") {
    return null;
  }

  return apiKey;
}

export function isOpenAIAvailable(): boolean {
  return getOpenAIKey() !== null;
}

export async function generateOpenAIText(
  prompt: string,
): Promise<string | null> {
  const apiKey = getOpenAIKey();

  if (!apiKey) {
    console.log("[OpenAI] API key not configured. Skipping OpenAI.");
    return null;
  }

  try {
    const response = await fetch(OPENAI_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
        temperature: 0.3,
      }),
    });

    const responseJson = (await response.json()) as {
      choices?: {
        message?: {
          content?: string;
        };
      }[];

      error?: {
        message?: string;
      };
    };

    if (!response.ok) {
      console.error("[OpenAI] API request failed:", responseJson.error);

      return null;
    }

    return responseJson.choices?.[0]?.message?.content?.trim() || null;
  } catch (error) {
    console.error("[OpenAI] API request failed:", error);

    return null;
  }
}
