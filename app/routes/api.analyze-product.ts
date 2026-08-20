import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { analyzeProductWithAI } from "../services/ai.server";

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

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

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Action                                                                     */
/* -------------------------------------------------------------------------- */

export async function action({ request }: ActionFunctionArgs) {
  try {
    /* ---------------------------------------------------------------------- */
    /* Authenticate Shopify                                                   */
    /* ---------------------------------------------------------------------- */

    const { admin } = await authenticate.admin(request);

    /* ---------------------------------------------------------------------- */
    /* Check request method                                                   */
    /* ---------------------------------------------------------------------- */

    if (request.method !== "POST") {
      return jsonResponse(
        {
          success: false,
          error: "Method not allowed.",
        },
        405,
      );
    }

    /* ---------------------------------------------------------------------- */
    /* Read request body                                                      */
    /* ---------------------------------------------------------------------- */

    const body = await request.json();

    const productId = body?.productId;

    if (!productId || typeof productId !== "string") {
      return jsonResponse(
        {
          success: false,
          error: "Product ID is required.",
        },
        400,
      );
    }

    /* ---------------------------------------------------------------------- */
    /* Convert product ID to Shopify GID                                      */
    /* ---------------------------------------------------------------------- */

    const productGid = productId.startsWith("gid://")
      ? productId
      : `gid://shopify/Product/${productId}`;

    console.log("[AI Product Optimizer] Analyzing product:", productGid);

    /* ---------------------------------------------------------------------- */
    /* Load product from Shopify                                              */
    /* ---------------------------------------------------------------------- */

    const response = await admin.graphql(
      `#graphql
        query GetProductForAnalysis($id: ID!) {
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
        product?: ProductData | null;
      };

      errors?: unknown[];
    };

    /* ---------------------------------------------------------------------- */
    /* Shopify GraphQL errors                                                 */
    /* ---------------------------------------------------------------------- */

    if (responseJson.errors?.length) {
      console.error(
        "[AI Product Optimizer] Shopify GraphQL error:",
        responseJson.errors,
      );

      return jsonResponse(
        {
          success: false,
          error: "Shopify could not load the product.",
        },
        500,
      );
    }

    /* ---------------------------------------------------------------------- */
    /* Product not found                                                      */
    /* ---------------------------------------------------------------------- */

    const product = responseJson.data?.product;

    if (!product) {
      return jsonResponse(
        {
          success: false,
          error: "Product not found.",
        },
        404,
      );
    }

    /* ---------------------------------------------------------------------- */
    /* AI Analysis                                                            */
    /* ---------------------------------------------------------------------- */

    console.log(
      "[AI Product Optimizer] Sending product to AI service:",
      product.id,
    );

    const analysis = await analyzeProductWithAI({
      title: product.title,
      description: product.description,
      productType: product.productType,
      vendor: product.vendor,
      tags: product.tags,
      seoTitle: product.seo?.title ?? null,
      seoDescription: product.seo?.description ?? null,
    });

    /* ---------------------------------------------------------------------- */
    /* Success                                                                */
    /* ---------------------------------------------------------------------- */

    console.log("[AI Product Optimizer] Analysis completed:", product.id);

    return jsonResponse({
      success: true,
      productId: product.id,
      analysis,
    });
  } catch (error) {
    console.error("[AI Product Optimizer] Analyze product failed:", error);

    return jsonResponse(
      {
        success: false,
        error:
          error instanceof Error ? error.message : "Unable to analyze product.",
      },
      500,
    );
  }
}
