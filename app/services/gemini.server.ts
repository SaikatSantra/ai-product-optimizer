import { GoogleGenAI } from "@google/genai";

const apiKey = process.env.GEMINI_API_KEY;

const gemini = apiKey
  ? new GoogleGenAI({
      apiKey,
    })
  : null;

/**
 * Generate text using Google Gemini.
 *
 * Important:
 * - Gemini is optional.
 * - Missing GEMINI_API_KEY does NOT crash the application.
 * - The caller can decide whether to use another AI provider.
 */
export async function generateGeminiText(
  prompt: string,
): Promise<string | null> {
  if (!gemini) {
    console.warn(
      "[Gemini] GEMINI_API_KEY is not configured. Gemini is unavailable.",
    );

    return null;
  }

  try {
    const response = await gemini.models.generateContent({
      model: "gemini-3.5-flash-lite",
      contents: prompt,
      config: {
        temperature: 0,
      },
    });

    /*
     * Normal SDK response.
     */
    const text = response.text?.trim();

    if (text) {
      console.log("[Gemini] Response received successfully.");

      return text;
    }

    /*
     * response.text can be empty when Gemini did not return
     * a normal text part.
     *
     * Inspect the raw response so we know WHY.
     */
    const candidate = response.candidates?.[0];

    console.error("[Gemini] Empty text response.", {
      finishReason: candidate?.finishReason,
      safetyRatings: candidate?.safetyRatings,
      promptFeedback: response.promptFeedback,
      candidates: response.candidates,
    });

    throw new Error(
      candidate?.finishReason
        ? `Gemini returned no text. Finish reason: ${candidate.finishReason}.`
        : "Gemini returned an empty response.",
    );
  } catch (error) {
    console.error("[Gemini] API request failed:", error);

    if (error instanceof Error) {
      throw error;
    }

    throw new Error("Gemini API request failed.");
  }
}
