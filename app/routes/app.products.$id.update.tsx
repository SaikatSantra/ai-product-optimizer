import type { ActionFunctionArgs, HeadersFunction } from "react-router";
import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";

type UpdateInput = {
  title?: string;
  descriptionHtml?: string;
  seoTitle?: string;
  seoDescription?: string;
  tags?: string[];
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

  const productGid = productId.startsWith("gid://")
    ? productId
    : `gid://shopify/Product/${productId}`;

  try {
    const body = (await request.json()) as UpdateInput;

    const input: Record<string, unknown> = {
      id: productGid,
    };

    if (body.title !== undefined) {
      input.title = body.title;
    }

    if (body.descriptionHtml !== undefined) {
      input.descriptionHtml = body.descriptionHtml;
    }

    if (body.tags !== undefined) {
      input.tags = body.tags;
    }

    if (body.seoTitle !== undefined || body.seoDescription !== undefined) {
      input.seo = {
        ...(body.seoTitle !== undefined ? { title: body.seoTitle } : {}),
        ...(body.seoDescription !== undefined
          ? { description: body.seoDescription }
          : {}),
      };
    }

    const response = await admin.graphql(
      `#graphql
        mutation UpdateProduct($input: ProductUpdateInput!) {
          productUpdate(input: $input) {
            product {
              id
              title
              descriptionHtml
              tags
              seo {
                title
                description
              }
            }

            userErrors {
              field
              message
            }
          }
        }
      `,
      {
        variables: {
          input,
        },
      },
    );

    const responseJson = (await response.json()) as {
      data?: {
        productUpdate?: {
          product?: {
            id?: string;
            title?: string;
            descriptionHtml?: string;
            tags?: string[];
            seo?: {
              title?: string | null;
              description?: string | null;
            } | null;
          } | null;
          userErrors?: {
            field?: string[] | null;
            message: string;
          }[];
        } | null;
      };
      errors?: {
        message?: string;
      }[];
    };

    if (responseJson.data?.productUpdate?.userErrors?.length) {
      console.error(
        "[AI Product Optimizer] Shopify update errors:",
        responseJson.data.productUpdate.userErrors,
      );

      return Response.json(
        {
          success: false,
          error: responseJson.data.productUpdate.userErrors
            .map((error: { message: string }) => error.message)
            .join(", "),
        },
        {
          status: 400,
        },
      );
    }

    if (responseJson.errors?.length) {
      console.error(
        "[AI Product Optimizer] Shopify GraphQL errors:",
        responseJson.errors,
      );

      return Response.json(
        {
          success: false,
          error: "Shopify failed to update the product.",
        },
        {
          status: 500,
        },
      );
    }

    const updatedProduct = responseJson.data?.productUpdate?.product;

    return Response.json({
      success: true,
      product: updatedProduct,
    });
  } catch (error) {
    console.error("[AI Product Optimizer] Product update failed:", error);

    return Response.json(
      {
        success: false,
        error:
          error instanceof Error ? error.message : "Unable to update product.",
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
