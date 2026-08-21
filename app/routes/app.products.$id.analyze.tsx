import type { ActionFunctionArgs, HeadersFunction } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { createHash } from "node:crypto";
import {
  generateGeminiText,
  generateGeminiImageAnalysis,
} from "../services/gemini.server";
import prisma from "../db.server";

type ProductData = {
  id: string;
  title: string;
  handle: string;
  description: string;
  productType: string;
  vendor: string;
  tags: string[];
  featuredImage: {
    url: string;
    altText: string | null;
  } | null;
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

            featuredImage {
              url
              altText
            }

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
      featuredImageUrl: product.featuredImage?.url ?? null,
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
You are an expert Shopify ecommerce SEO specialist,
ecommerce copywriter, product photographer analyst,
and conversion optimization specialist.

You are analyzing a Shopify product using BOTH:

1. The product information provided below.
2. The product image attached to this request.

IMPORTANT:

The attached product image is a primary source of information.

Use the image to understand:
- What the product actually looks like
- Product category
- Product type
- Visible materials
- Visible colors
- Shape
- Design
- Style
- Intended use when reasonably apparent
- Visible features
- Packaging when visible
- Visual selling points

Do NOT invent information that cannot reasonably be determined
from the image or supplied product information.

PRODUCT INFORMATION

Title:
${product.title}

Handle:
${product.handle}

Current Description:
${product.description || "No description provided."}

Product Type:
${product.productType || "Not provided"}

Vendor:
${product.vendor || "Not provided"}

Tags:
${product.tags.length > 0 ? product.tags.join(", ") : "No tags"}

Current SEO Title:
${product.seo?.title || "Not provided"}

Current SEO Description:
${product.seo?.description || "Not provided"}


YOUR TASK

Analyze the product and create improved ecommerce content.

The most important tasks are:

1. Understand the product from the image.
2. Improve the product title.
3. Write a compelling product description.
4. Create an SEO title.
5. Create an SEO description.
6. Suggest relevant Shopify product tags.
7. Provide SEO and conversion recommendations.


PRODUCT TITLE

Create a clear and natural Shopify product title.

The title should:
- Clearly identify the product.
- Use important searchable terms naturally.
- Be useful to customers.
- Avoid keyword stuffing.
- Not claim features that are not supported.


PRODUCT DESCRIPTION

Create a professional Shopify product description.

The description should:
- Explain what the product is.
- Describe visible characteristics.
- Explain benefits when supported.
- Help customers understand the product.
- Be persuasive but natural.
- Be easy to scan.
- Use clean HTML.

Use only:
<p>
<strong>
<ul>
<li>

Do NOT use:
<h1>
<h2>
<h3>
Markdown
Code blocks

The description must be valid HTML.


SEO TITLE

Create a concise search-friendly SEO title.


SEO DESCRIPTION

Create a compelling SEO meta description that communicates
the product value clearly.


TAGS

Suggest relevant Shopify product tags.

Do not create irrelevant or generic tags just to increase the number.


RETURN ONLY VALID JSON.

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
- Return JSON only.
- Do not use markdown.
- Do not wrap JSON in code fences.
- Do not invent product features.
- Do not invent materials unless supported by the image or product data.
- Do not invent dimensions.
- Do not invent compatibility.
- Do not invent certifications.
- Do not invent warranty information.
- Do not invent pricing.
- Do not invent product benefits that cannot reasonably be supported.
- Use the image as a visual source of truth.
- Keep the title natural.
- Avoid keyword stuffing.
- The description must contain valid HTML.
- recommendations priority must be one of:
  high
  medium
  low
`;

    /* ------------------------------------------------------------------ */
    /* Call Gemini                                                         */
    /* ------------------------------------------------------------------ */

    let geminiResponse: string | null;

    if (product.featuredImage?.url) {
      geminiResponse = await generateGeminiImageAnalysis({
        imageUrl: product.featuredImage.url,
        prompt,
      });
    } else {
      console.warn(
        "[AI Product Optimizer] Product has no featured image. Using text analysis.",
      );

      geminiResponse = await generateGeminiText(prompt);
    }

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
