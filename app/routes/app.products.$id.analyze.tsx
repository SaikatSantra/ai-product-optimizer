import type {
  ActionFunctionArgs,
  HeadersFunction,
} from "react-router";

import { authenticate } from "../shopify.server";
import { boundary } from "@shopify/shopify-app-react-router/server";

import {
  analyzeProductWithAI,
} from "../services/ai.server";

export async function action({
  request,
  params,
}: ActionFunctionArgs) {
  const { admin } = await authenticate.admin(request);

  const productId = params.id;

  if (!productId) {
    return Response.json(
      {
        error: "Product ID is required.",
      },
      {
        status: 400,
      },
    );
  }

  if (request.method !== "POST") {
    return Response.json(
      {
        error: "Method not allowed.",
      },
      {
        status: 405,
      },
    );
  }

  const productGid = productId.startsWith("gid://shopify/Product/")
    ? productId
    : `gid://shopify/Product/${productId}`;

  try {
    const response = await admin.graphql(
      `#graphql
        query GetProductForAI($id: ID!) {
          product(id: $id) {
            id
            title
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

    const responseJson = await response.json();

    if (responseJson.errors?.length) {
      console.error(
        "Shopify GraphQL error:",
        responseJson.errors,
      );

      return Response.json(
        {
          error: "Unable to load the product from Shopify.",
        },
        {
          status: 500,
        },
      );
    }

    const product = responseJson.data?.product;

    if (!product) {
      return Response.json(
        {
          error: "Product not found.",
        },
        {
          status: 404,
        },
      );
    }

    const analysis = await analyzeProductWithAI({
      title: product.title,
      description: product.description,
      productType: product.productType,
      vendor: product.vendor,
      tags: product.tags,
      seoTitle: product.seo?.title ?? null,
      seoDescription: product.seo?.description ?? null,
    });

    return Response.json({
      success: true,
      productId: product.id,
      analysis,
    });
  } catch (error) {
    console.error(
      "Product AI analysis failed:",
      error,
    );

    return Response.json(
      {
        error: "Unable to analyze this product.",
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