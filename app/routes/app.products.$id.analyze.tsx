import type { ActionFunctionArgs, HeadersFunction } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { createHash } from "node:crypto";
import { generateGeminiText } from "../services/gemini.server";
import prisma from "../db.server";

type ProductData = {
  id: string;
  title: string;
  handle: string;
  description: string;
  productType: string;
  vendor: string;
  tags: string[];
  seo: {
    title: string | null;
    description: string | null;
  };
};

type ProductAnalysisRecord = {
  analysis: string;
};

type ProductAnalysisDelegate = {
  findUnique(args: {
    where: {
      shop_productId_contentHash: {
        shop: string;
        productId: string;
        contentHash: string;
      };
    };
  }): Promise<ProductAnalysisRecord | null>;
  create(args: {
    data: {
      shop: string;
      productId: string;
      contentHash: string;
      analysis: string;
    };
  }): Promise<unknown>;
};

export async function action({ request, params }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return Response.json(
      {
        success: false,
        error: "Method not allowed.",
      },
      {
        status: 405,
      },
    );
  }

  const { admin } = await authenticate.admin(request);

  const productId = params.id;

  if (!productId) {
    return Response.json(
      {
        success: false,
        error: "Product ID is required.",
      },
      {
        status: 400,
      },
    );
  }

  const productGid = productId.startsWith("gid://shopify/Product/")
    ? productId
    : `gid://shopify/Product/${productId}`;

  try {
    /* ------------------------------------------------------------------ */
    /* Get product from Shopify                                           */
    /* ------------------------------------------------------------------ */

    const response = await admin.graphql(
      `#graphql
        query GetProductForAI($id: ID!) {
          shop {
            myshopifyDomain
          }
          product(id: $id) {
            id
            title
            handle
            description
            productType
            vendor
            tags

            seo {
              title
              description
            }
          }
        }
      `,
      {
        variables: {
          id: productGid,
        },
      },
    );

    const responseJson = (await response.json()) as {
      data?: {
        shop?: {
          myshopifyDomain: string;
        };
        product?: ProductData | null;
      };
      errors?: unknown[];
    };

    if (responseJson.errors?.length) {
      console.error(
        "[AI Product Optimizer] Shopify GraphQL error:",
        responseJson.errors,
      );

      return Response.json(
        {
          success: false,
          error: "Unable to load the product from Shopify.",
        },
        {
          status: 500,
        },
      );
    }

    const product = responseJson.data?.product;
    const shopDomain = responseJson.data?.shop?.myshopifyDomain;

    if (!product) {
      return Response.json(
        {
          success: false,
          error: "Product not found.",
        },
        {
          status: 404,
        },
      );
    }

    if (!shopDomain) {
      return Response.json(
        {
          success: false,
          error: "Unable to identify the Shopify store.",
        },
        {
          status: 500,
        },
      );
    }

    const productFingerprint = JSON.stringify({
      id: product.id,
      title: product.title,
      handle: product.handle,
      description: product.description,
      productType: product.productType,
      vendor: product.vendor,
      tags: [...product.tags].sort(),
      seoTitle: product.seo?.title ?? null,
      seoDescription: product.seo?.description ?? null,
    });

    const contentHash = createHash("sha256")
      .update(productFingerprint)
      .digest("hex");

    const productAnalysis = (
      prisma as unknown as {
        productAnalysis: ProductAnalysisDelegate;
      }
    ).productAnalysis;

    const cachedAnalysis = await productAnalysis.findUnique({
      where: {
        shop_productId_contentHash: {
          shop: shopDomain,
          productId: product.id,
          contentHash,
        },
      },
    });
    if (cachedAnalysis) {
      console.log(
        "[AI Product Optimizer] Returning cached analysis:",
        product.id,
      );

      return Response.json({
        success: true,
        provider: "gemini",
        cached: true,
        productId: product.id,
        analysis: JSON.parse(cachedAnalysis.analysis),
      });
    }
    /* ------------------------------------------------------------------ */
    /* Gemini prompt                                                       */
    /* ------------------------------------------------------------------ */

    const prompt = `
You are an expert Shopify ecommerce SEO and conversion optimization specialist.
You are an expert Shopify e-commerce copywriter.

Convert the following product text into clean, valid HTML formatting ready to paste directly into Shopify's HTML editor.

CRITICAL INSTRUCTIONS for product description:
1. DO NOT use markdown formatting anywhere (No asterisks, no hash signs like ###).
2. DO NOT wrap the output in markdown code blocks.
3. Start your response directly with the first HTML tag.
4. DO NOT Use <h2> or <h3> for headings, <p> for paragraphs, and <ul><li> for lists.

Product Text to Convert:

Analyze the following Shopify product.

PRODUCT INFORMATION

Title:
${product.title}

Handle:
${product.handle}

Description:
${product.description || "No description provided."}

Product type:
${product.productType || "Not provided"}

Vendor:
${product.vendor || "Not provided"}

Tags:
${product.tags.length > 0 ? product.tags.join(", ") : "No tags"}

SEO title:
${product.seo?.title || "Not provided"}

SEO description:
${product.seo?.description || "Not provided"}


YOUR TASK

Analyze this product for:

1. Product title quality
2. Product description quality
3. SEO title
4. SEO description
5. Product tags
6. Search discoverability
7. Conversion potential


Return ONLY valid JSON.

Use exactly this structure:

{
  "score": 0,
  "summary": "",
  "title": {
    "current": "",
    "suggested": "",
    "reason": ""
  },
  "description": {
    "current": "",
    "suggested": "",
    "reason": ""
  },
  "seo": {
    "title": {
      "current": null,
      "suggested": "",
      "reason": ""
    },
    "description": {
      "current": null,
      "suggested": "",
      "reason": ""
    }
  },
  "tags": {
    "current": [],
    "suggested": [],
    "reason": ""
  },
  "recommendations": [
    {
      "priority": "high",
      "category": "",
      "recommendation": ""
    }
  ]
}

RULES

- score must be an integer from 0 to 100.
- Keep the suggested product title clear and natural.
- Do not keyword-stuff.
- Make the title useful for both Shopify customers and search engines.
- Improve the description for clarity, benefits and conversion.
- SEO title should generally be concise and search-friendly.
- SEO description should clearly communicate product value.
- Suggested tags must be relevant to the product.
- Do not invent product features that are not supported by the supplied information.
- recommendations priority must be one of: high, medium, low.
- Return JSON only.
`;

    /* ------------------------------------------------------------------ */
    /* Call Gemini                                                         */
    /* ------------------------------------------------------------------ */

    const geminiResponse = await generateGeminiText(prompt);

    console.log("[AI Product Optimizer] Gemini response:", geminiResponse);

    /* ------------------------------------------------------------------ */
    /* Parse Gemini JSON                                                   */
    /* ------------------------------------------------------------------ */

    let analysis;

    try {
      if (!geminiResponse) {
        throw new Error("Gemini returned an empty response.");
      }

      const cleanedResponse = geminiResponse
        .replace("```json", "")
        .replace("```", "")
        .trim();

      analysis = JSON.parse(cleanedResponse);
    } catch (parseError) {
      console.error(
        "[AI Product Optimizer] Unable to parse Gemini response:",
        parseError,
      );

      console.error(
        "[AI Product Optimizer] Raw Gemini response:",
        geminiResponse,
      );

      return Response.json(
        {
          success: false,
          error: "Gemini returned an invalid analysis response.",
        },
        {
          status: 502,
        },
      );
    }

    await productAnalysis.create({
      data: {
        shop: shopDomain,
        productId: product.id,
        contentHash,
        analysis: JSON.stringify(analysis),
      },
    });

    console.log("[AI Product Optimizer] Analysis saved:", product.id);

    return Response.json({
      success: true,
      provider: "gemini",
      cached: false,
      productId: product.id,
      analysis,
    });
  } catch (error) {
    console.error("[AI Product Optimizer] Product AI analysis failed:", error);

    return Response.json(
      {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to analyze this product.",
      },
      {
        status: 500,
      },
    );
  }
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
