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

export async function generateGeminiImageAnalysis({
  imageUrl,
  prompt,
}: {
  imageUrl: string;
  prompt: string;
}): Promise<string | null> {
  if (!gemini) {
    console.warn(
      "[Gemini] GEMINI_API_KEY is not configured. Gemini is unavailable.",
    );

    return null;
  }

  try {
    console.log("[Gemini] Image URL:", imageUrl);
    console.log("[Gemini] Downloading product image...");

    // Validate the URL before fetch()
    let parsedImageUrl: URL;

    try {
      parsedImageUrl = new URL(imageUrl);
    } catch {
      throw new Error(
        `Invalid product image URL received: ${imageUrl.substring(0, 200)}`,
      );
    }

    if (!["http:", "https:"].includes(parsedImageUrl.protocol)) {
      throw new Error(
        `Unsupported product image URL protocol: ${parsedImageUrl.protocol}`,
      );
    }

    const imageResponse = await fetch(parsedImageUrl);

    if (!imageResponse.ok) {
      throw new Error(
        `Unable to download product image. HTTP ${imageResponse.status}`,
      );
    }

    const contentType =
      imageResponse.headers.get("content-type") || "image/jpeg";

    const imageBuffer = await imageResponse.arrayBuffer();

    const base64Image = Buffer.from(imageBuffer).toString("base64");

    console.log("[Gemini] Image downloaded successfully.");
    console.log("[Gemini] Image type:", contentType);
    console.log(
      "[Gemini] Image size:",
      Math.round(imageBuffer.byteLength / 1024),
      "KB",
    );

    const response = await gemini.models.generateContent({
      model: "gemini-3.5-flash-lite",
      contents: [
        {
          text: prompt,
        },
        {
          inlineData: {
            mimeType: contentType,
            data: base64Image,
          },
        },
      ],
      config: {
        temperature: 0.2,
      },
    });

    const text = response.text?.trim();

    if (text) {
      console.log("[Gemini] Image analysis response received successfully.");

      return text;
    }

    const candidate = response.candidates?.[0];

    console.error("[Gemini] Empty image analysis response.", {
      finishReason: candidate?.finishReason,
      safetyRatings: candidate?.safetyRatings,
      promptFeedback: response.promptFeedback,
    });

    throw new Error(
      candidate?.finishReason
        ? `Gemini returned no image analysis. Finish reason: ${candidate.finishReason}.`
        : "Gemini returned an empty image analysis response.",
    );
  } catch (error) {
    console.error("[Gemini] Image analysis failed:", error);

    if (error instanceof Error) {
      throw error;
    }

    throw new Error("Gemini image analysis failed.");
  }
}
