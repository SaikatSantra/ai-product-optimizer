import { useState } from "react";
import type {
  ActionFunctionArgs,
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { Link, useFetcher, useLoaderData, useRevalidator } from "react-router";

import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

import "../styles/product-optimizer.css";
import "../styles/product-detail.css";

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

type Product = {
  id: string;
  title: string;
  handle: string;
  description: string;
  productType: string;
  vendor: string;
  status: string;
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

type LoaderData = {
  product: Product;
  shopDomain: string;
};

type AIProductAnalysis = {
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
    priority: "high" | "medium" | "low";
    category: string;
    recommendation: string;
  }[];
};

type ProductUpdatePayload = {
  title: string;
  description: string;
  seoTitle: string;
  seoDescription: string;
  tags: string[];
};

/* -------------------------------------------------------------------------- */
/* Loader                                                                     */
/* -------------------------------------------------------------------------- */

export async function loader({
  request,
  params,
}: LoaderFunctionArgs): Promise<LoaderData> {
  const { admin } = await authenticate.admin(request);

  const id = params.id;

  if (!id) {
    throw new Response("Product ID is required.", {
      status: 400,
    });
  }

  const productGid = id.startsWith("gid://")
    ? id
    : `gid://shopify/Product/${id}`;

  console.log("[AI Product Optimizer] Loading product:", productGid);

  const response = await admin.graphql(
    `#graphql
      query GetProduct($id: ID!) {
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
          status
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
      product?: Product | null;
      shop?: {
        myshopifyDomain: string;
      } | null;
    };

    errors?: {
      message?: string;
    }[];
  };

  if (responseJson.errors?.length) {
    console.error(
      "[AI Product Optimizer] Product GraphQL error:",
      responseJson.errors,
    );

    throw new Response(
      responseJson.errors
        .map((error) => error.message)
        .filter(Boolean)
        .join(", ") || "Shopify could not load this product.",
      {
        status: 500,
      },
    );
  }

  const data = responseJson.data;
  const product = data?.product;

  if (!data || !product || !data.shop?.myshopifyDomain) {
    console.error(
      "[AI Product Optimizer] Product not found:",
      productGid,
      responseJson,
    );

    throw new Response("Product not found in Shopify.", {
      status: 404,
    });
  }

  return {
    product,
    shopDomain: data.shop.myshopifyDomain,
  };
}

/* -------------------------------------------------------------------------- */
/* Action - Update product                                                    */
/* -------------------------------------------------------------------------- */

export async function action({ request, params }: ActionFunctionArgs) {
  console.log("[AI Product Optimizer] Product update action called.");

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

  try {
    /* ---------------------------------------------------------------------- */
    /* Authenticate Shopify Admin                                             */
    /* ---------------------------------------------------------------------- */

    const { admin } = await authenticate.admin(request);

    const id = params.id;

    if (!id) {
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

    const productGid = id.startsWith("gid://shopify/Product/")
      ? id
      : `gid://shopify/Product/${id}`;

    console.log("[AI Product Optimizer] Updating product:", productGid);

    /* ---------------------------------------------------------------------- */
    /* Read request body                                                       */
    /* ---------------------------------------------------------------------- */

    const contentType = request.headers.get("content-type") || "";

    let body: Partial<ProductUpdatePayload>;

    if (contentType.includes("application/json")) {
      body = await request.json();
    } else {
      const formData = await request.formData();

      const tagsValue = formData.get("tags");

      body = {
        title: String(formData.get("title") || ""),
        description: String(formData.get("description") || ""),
        seoTitle: String(formData.get("seoTitle") || ""),
        seoDescription: String(formData.get("seoDescription") || ""),
        tags: typeof tagsValue === "string" ? JSON.parse(tagsValue) : [],
      };
    }

    console.log("[AI Product Optimizer] Update request body:", body);

    /* ---------------------------------------------------------------------- */
    /* Validate                                                               */
    /* ---------------------------------------------------------------------- */

    const title = typeof body.title === "string" ? body.title.trim() : "";

    const description =
      typeof body.description === "string" ? body.description : "";

    const seoTitle =
      typeof body.seoTitle === "string" ? body.seoTitle.trim() : "";

    const seoDescription =
      typeof body.seoDescription === "string" ? body.seoDescription.trim() : "";

    const tags = Array.isArray(body.tags)
      ? body.tags
          .filter((tag): tag is string => typeof tag === "string")
          .map((tag) => tag.trim())
          .filter(Boolean)
      : [];

    if (!title) {
      return Response.json(
        {
          success: false,
          error: "Product title cannot be empty.",
        },
        {
          status: 400,
        },
      );
    }

    if (!description.trim()) {
      return Response.json(
        {
          success: false,
          error: "Product description cannot be empty.",
        },
        {
          status: 400,
        },
      );
    }

    if (!seoTitle) {
      return Response.json(
        {
          success: false,
          error: "SEO title cannot be empty.",
        },
        {
          status: 400,
        },
      );
    }

    if (!seoDescription) {
      return Response.json(
        {
          success: false,
          error: "SEO description cannot be empty.",
        },
        {
          status: 400,
        },
      );
    }

    /* ---------------------------------------------------------------------- */
    /* Shopify GraphQL mutation                                               */
    /* ---------------------------------------------------------------------- */

    const response = await admin.graphql(
      `#graphql
        mutation UpdateProduct($product: ProductUpdateInput!) {
          productUpdate(product: $product) {
            product {
              id
              title
              handle
              description
              productType
              vendor
              status
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
          product: {
            id: productGid,

            title,

            descriptionHtml: description,

            seo: {
              title: seoTitle,
              description: seoDescription,
            },

            tags,
          },
        },
      },
    );

    /* ---------------------------------------------------------------------- */
    /* Parse Shopify response                                                 */
    /* ---------------------------------------------------------------------- */

    const responseJson = (await response.json()) as {
      data?: {
        productUpdate?: {
          product?: Product | null;

          userErrors?: {
            field?: string[];
            message: string;
          }[];
        } | null;
      };

      errors?: {
        message?: string;
      }[];
    };

    console.log(
      "[AI Product Optimizer] Shopify update response:",
      JSON.stringify(responseJson, null, 2),
    );

    /* ---------------------------------------------------------------------- */
    /* GraphQL errors                                                         */
    /* ---------------------------------------------------------------------- */

    if (responseJson.errors?.length) {
      const graphqlMessage =
        responseJson.errors
          .map((error) => error.message)
          .filter(Boolean)
          .join(", ") || "Shopify returned a GraphQL error.";

      console.error(
        "[AI Product Optimizer] Shopify GraphQL errors:",
        responseJson.errors,
      );

      return Response.json(
        {
          success: false,
          error: graphqlMessage,
        },
        {
          status: 500,
        },
      );
    }

    /* ---------------------------------------------------------------------- */
    /* Mutation result                                                        */
    /* ---------------------------------------------------------------------- */

    const updateResult = responseJson.data?.productUpdate;

    if (!updateResult) {
      return Response.json(
        {
          success: false,
          error: "Shopify did not return a product update result.",
        },
        {
          status: 500,
        },
      );
    }

    /* ---------------------------------------------------------------------- */
    /* Shopify user errors                                                    */
    /* ---------------------------------------------------------------------- */

    if (updateResult.userErrors && updateResult.userErrors.length > 0) {
      const errorMessage = updateResult.userErrors
        .map((error) => {
          const field = error.field?.join(". ");

          return field ? `${field}: ${error.message}` : error.message;
        })
        .join(", ");

      console.error(
        "[AI Product Optimizer] Shopify user errors:",
        updateResult.userErrors,
      );

      return Response.json(
        {
          success: false,
          error: errorMessage || "Shopify could not update the product.",
          userErrors: updateResult.userErrors,
        },
        {
          status: 400,
        },
      );
    }

    /* ---------------------------------------------------------------------- */
    /* Make sure product was returned                                         */
    /* ---------------------------------------------------------------------- */

    if (!updateResult.product) {
      return Response.json(
        {
          success: false,
          error: "Shopify did not return the updated product.",
        },
        {
          status: 500,
        },
      );
    }

    console.log(
      "[AI Product Optimizer] Product updated successfully:",
      updateResult.product.id,
    );

    /* ---------------------------------------------------------------------- */
    /* Success                                                                */
    /* ---------------------------------------------------------------------- */

    return Response.json({
      success: true,

      message: "Product updated successfully in Shopify.",

      product: updateResult.product,
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

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function getSeoStatus(product: Product) {
  const hasTitle = Boolean(product.seo?.title?.trim());

  const hasDescription = Boolean(product.seo?.description?.trim());

  if (hasTitle && hasDescription) {
    return {
      label: "Optimized",
      type: "success" as const,
      score: 100,
    };
  }

  if (hasTitle || hasDescription) {
    return {
      label: "Partial",
      type: "warning" as const,
      score: 50,
    };
  }

  return {
    label: "Needs work",
    type: "critical" as const,
    score: 0,
  };
}

function getStatusLabel(status: string) {
  return status.toLowerCase().replaceAll("_", " ");
}

function getDescriptionLength(description: string) {
  return description?.trim().length ?? 0;
}

function getShopifyProductUrl(shopDomain: string, productId: string) {
  const storeHandle = shopDomain.replace(".myshopify.com", "");

  return `https://admin.shopify.com/store/${storeHandle}/products/${productId}`;
}

/* -------------------------------------------------------------------------- */
/* Product Detail                                                             */
/* -------------------------------------------------------------------------- */

export default function ProductOptimizer() {
  const { product, shopDomain } = useLoaderData<typeof loader>();

  const revalidator = useRevalidator();

  /* ------------------------------------------------------------------------ */
  /* Fetcher                                                                  */
  /* ------------------------------------------------------------------------ */

  const updateFetcher = useFetcher<{
    success: boolean;
    message?: string;
    error?: string;
    product?: Product;
  }>();

  /* ------------------------------------------------------------------------ */
  /* State                                                                    */
  /* ------------------------------------------------------------------------ */

  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const [analysis, setAnalysis] = useState<AIProductAnalysis | null>(null);

  const [analysisError, setAnalysisError] = useState<string | null>(null);

  const [updateMessage, setUpdateMessage] = useState<string | null>(null);

  const [updateError, setUpdateError] = useState<string | null>(null);

  const productId = product.id.split("/").pop() ?? "";

  const seo = getSeoStatus(product);

  const descriptionLength = getDescriptionLength(product.description);

  const hasDescription = descriptionLength > 0;

  const hasSeoTitle = Boolean(product.seo?.title?.trim());

  const hasSeoDescription = Boolean(product.seo?.description?.trim());

  const hasTags = product.tags.length > 0;

  const checks = [
    {
      label: "Product title",
      description: "A clear product title is available.",
      passed: Boolean(product.title.trim()),
    },

    {
      label: "Product description",
      description: "The product contains descriptive content.",
      passed: hasDescription,
    },

    {
      label: "SEO title",
      description: "A dedicated SEO title is configured.",
      passed: hasSeoTitle,
    },

    {
      label: "SEO description",
      description: "A dedicated SEO description is configured.",
      passed: hasSeoDescription,
    },

    {
      label: "Product tags",
      description: "The product has searchable tags.",
      passed: hasTags,
    },
  ];

  const completedChecks = checks.filter((check) => check.passed).length;

  /* ------------------------------------------------------------------------ */
  /* AI Analysis                                                              */
  /* ------------------------------------------------------------------------ */

  async function handleAnalyze() {
    setIsAnalyzing(true);

    setAnalysisError(null);
    setUpdateError(null);
    setUpdateMessage(null);

    try {
      const response = await fetch(`/app/products/${productId}/analyze`, {
        method: "POST",

        headers: {
          "Content-Type": "application/json",

          Accept: "application/json",
        },
      });

      const responseText = await response.text();

      let result: {
        success?: boolean;
        analysis?: AIProductAnalysis;
        error?: string;
      };

      try {
        result = JSON.parse(responseText);
      } catch {
        throw new Error(
          `Analysis endpoint returned invalid JSON (${response.status}).`,
        );
      }

      console.log("[AI Product Optimizer] Analyze response:", result);

      if (!response.ok || !result.success || !result.analysis) {
        throw new Error(result.error || "Unable to analyze product.");
      }

      setAnalysis(result.analysis);
    } catch (error) {
      console.error("[AI Product Optimizer] AI analysis failed:", error);

      setAnalysisError(
        error instanceof Error ? error.message : "Unable to analyze product.",
      );
    } finally {
      setIsAnalyzing(false);
    }
  }

  /* ------------------------------------------------------------------------ */
  /* Update Product                                                           */
  /* ------------------------------------------------------------------------ */

  function handleUpdateProduct() {
    if (!analysis) {
      return;
    }

    setUpdateError(null);
    setUpdateMessage(null);

    const payload: ProductUpdatePayload = {
      title: analysis.title.suggested,

      description: analysis.description.suggested,

      seoTitle: analysis.seo.title.suggested,

      seoDescription: analysis.seo.description.suggested,

      tags: analysis.tags.suggested,
    };

    console.log(
      "[AI Product Optimizer] Updating product with AI suggestions:",
      payload,
    );

    updateFetcher.submit(payload, {
      method: "POST",

      encType: "application/json",

      action: `/app/products/${productId}`,
    });
  }

  /* ------------------------------------------------------------------------ */
  /* Handle update fetcher result                                             */
  /* ------------------------------------------------------------------------ */

  const isUpdating = updateFetcher.state !== "idle";

  if (
    updateFetcher.state === "idle" &&
    updateFetcher.data?.success &&
    !updateMessage
  ) {
    setUpdateMessage(
      updateFetcher.data.message || "Product updated successfully in Shopify.",
    );

    setUpdateError(null);

    /*
     * Reload the loader so the page displays
     * the actual values now stored in Shopify.
     */
    revalidator.revalidate();
  }

  if (
    updateFetcher.state === "idle" &&
    updateFetcher.data &&
    !updateFetcher.data.success &&
    !updateError
  ) {
    setUpdateError(updateFetcher.data.error || "Unable to update product.");

    setUpdateMessage(null);
  }

  /* ------------------------------------------------------------------------ */
  /* Render                                                                   */
  /* ------------------------------------------------------------------------ */

  return (
    <s-page heading="Product optimization">
      <div className="optimizer product-detail-page">
        {/* ---------------------------------------------------------------- */}
        {/* Navigation                                                       */}
        {/* ---------------------------------------------------------------- */}

        <div className="detail-navigation">
          <Link to="/app" className="back-link">
            <span>←</span>
            Products
          </Link>

          <span className="breadcrumb-separator">/</span>

          <span className="breadcrumb-current">{product.title}</span>
        </div>

        {/* ---------------------------------------------------------------- */}
        {/* Product Hero                                                     */}
        {/* ---------------------------------------------------------------- */}

        <section className="product-detail-hero">
          <div className="product-detail-main">
            {product.featuredImage ? (
              <img
                src={product.featuredImage.url}
                alt={product.featuredImage.altText || product.title}
                className="product-detail-image"
              />
            ) : (
              <div className="product-detail-image product-detail-image-empty">
                ✦
              </div>
            )}

            <div className="product-detail-copy">
              <div className="eyebrow">
                <span className="eyebrow-dot" />
                AI Product Optimizer
              </div>

              <h1>{product.title}</h1>

              <p>
                Review product content, SEO and discoverability opportunities.
              </p>

              <div className="product-detail-meta">
                <span>{product.vendor || "No vendor"}</span>

                <span>{product.productType || "Product"}</span>

                <span>{getStatusLabel(product.status)}</span>
              </div>
            </div>
          </div>

          <div className="product-detail-action">
            <a
              href={getShopifyProductUrl(shopDomain, productId)}
              target="_top"
              rel="noreferrer"
              className="shopify-view-button"
            >
              <span>↗</span>
              View in Shopify
            </a>

            <s-button
              variant="primary"
              disabled={isAnalyzing || isUpdating}
              onClick={handleAnalyze}
            >
              {isAnalyzing ? "Analyzing..." : "Start AI analysis"}
            </s-button>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* Analysis Error                                                   */}
        {/* ---------------------------------------------------------------- */}

        {analysisError && (
          <div className="analysis-error">
            <div className="analysis-error-icon">!</div>

            <div>
              <strong>Analysis failed</strong>

              <p>{analysisError}</p>
            </div>

            <s-button
              variant="secondary"
              onClick={handleAnalyze}
              disabled={isAnalyzing}
            >
              Try again
            </s-button>
          </div>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* Update Success                                                   */}
        {/* ---------------------------------------------------------------- */}

        {updateMessage && (
          <div className="analysis-success">
            <div className="analysis-success-icon">✓</div>

            <div>
              <strong>Product updated</strong>

              <p>{updateMessage}</p>
            </div>
          </div>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* Update Error                                                     */}
        {/* ---------------------------------------------------------------- */}

        {updateError && (
          <div className="analysis-error">
            <div className="analysis-error-icon">!</div>

            <div>
              <strong>Update failed</strong>

              <p>{updateError}</p>
            </div>

            <s-button
              variant="secondary"
              onClick={handleUpdateProduct}
              disabled={isUpdating}
            >
              Try again
            </s-button>
          </div>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* Overview                                                         */}
        {/* ---------------------------------------------------------------- */}

        <section className="detail-grid">
          {/* Score */}

          <div className="detail-card">
            <div className="detail-card-header">
              <div>
                <h2>Optimization score</h2>

                <p>Based on the product information currently available.</p>
              </div>
            </div>

            <div className="score-content">
              <div className={`score-circle score-${seo.type}`}>
                <span className="score-value">{seo.score}</span>

                <span className="score-label">/ 100</span>
              </div>

              <div className="score-summary">
                <span className={`optimization optimization-${seo.type}`}>
                  <span className="optimization-icon">
                    {seo.type === "success" && "✓"}

                    {seo.type === "warning" && "•"}

                    {seo.type === "critical" && "!"}
                  </span>

                  {seo.label}
                </span>

                <h3>
                  {completedChecks} of {checks.length} checks passed
                </h3>

                <p>
                  Improve the areas marked below to increase product quality,
                  discoverability and conversion potential.
                </p>
              </div>
            </div>
          </div>

          {/* Product information */}

          <div className="detail-card">
            <div className="detail-card-header">
              <div>
                <h2>Product information</h2>

                <p>Current information stored in Shopify.</p>
              </div>
            </div>

            <div className="detail-fields">
              <div className="detail-field">
                <span className="detail-field-label">Title</span>

                <span className="detail-field-value">
                  {product.title || "Not set"}
                </span>
              </div>

              <div className="detail-field">
                <span className="detail-field-label">Handle</span>

                <span className="detail-field-value">
                  {product.handle || "Not set"}
                </span>
              </div>

              <div className="detail-field">
                <span className="detail-field-label">Vendor</span>

                <span className="detail-field-value">
                  {product.vendor || "Not set"}
                </span>
              </div>

              <div className="detail-field">
                <span className="detail-field-label">Type</span>

                <span className="detail-field-value">
                  {product.productType || "Not set"}
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* SEO Analysis                                                     */}
        {/* ---------------------------------------------------------------- */}

        <section className="detail-card">
          <div className="detail-card-header">
            <div>
              <h2>SEO analysis</h2>

              <p>
                Review the metadata search engines can use to understand this
                product.
              </p>
            </div>

            <span className={`optimization optimization-${seo.type}`}>
              <span className="optimization-icon">
                {seo.type === "success" && "✓"}

                {seo.type === "warning" && "•"}

                {seo.type === "critical" && "!"}
              </span>

              {seo.label}
            </span>
          </div>

          <div className="seo-analysis-grid">
            <div
              className={`analysis-item ${
                hasSeoTitle ? "analysis-success" : "analysis-critical"
              }`}
            >
              <div className="analysis-icon">{hasSeoTitle ? "✓" : "!"}</div>

              <div className="analysis-content">
                <span className="analysis-label">SEO title</span>

                <strong>
                  {hasSeoTitle ? product.seo.title : "SEO title missing"}
                </strong>

                <p>
                  {hasSeoTitle
                    ? "Your product has an SEO title configured."
                    : "Add a clear and keyword-focused SEO title."}
                </p>
              </div>
            </div>

            <div
              className={`analysis-item ${
                hasSeoDescription ? "analysis-success" : "analysis-critical"
              }`}
            >
              <div className="analysis-icon">
                {hasSeoDescription ? "✓" : "!"}
              </div>

              <div className="analysis-content">
                <span className="analysis-label">SEO description</span>

                <strong>
                  {hasSeoDescription
                    ? product.seo.description
                    : "SEO description missing"}
                </strong>

                <p>
                  {hasSeoDescription
                    ? "Your product has an SEO description configured."
                    : "Add a useful description that explains the product."}
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* Content Analysis                                                 */}
        {/* ---------------------------------------------------------------- */}

        <section className="detail-card">
          <div className="detail-card-header">
            <div>
              <h2>Content analysis</h2>

              <p>
                A quick analysis of the product content before AI
                recommendations are generated.
              </p>
            </div>
          </div>

          <div className="content-analysis">
            <div className="content-stat">
              <span className="content-stat-value">{descriptionLength}</span>

              <span className="content-stat-label">Description characters</span>
            </div>

            <div className="content-stat">
              <span className="content-stat-value">{product.tags.length}</span>

              <span className="content-stat-label">Tags</span>
            </div>

            <div className="content-stat">
              <span className="content-stat-value">
                {product.title.trim().length}
              </span>

              <span className="content-stat-label">Title characters</span>
            </div>
          </div>

          <div className="check-list">
            {checks.map((check) => (
              <div className="check-row" key={check.label}>
                <span
                  className={`check-icon ${
                    check.passed ? "check-icon-success" : "check-icon-critical"
                  }`}
                >
                  {check.passed ? "✓" : "!"}
                </span>

                <div className="check-copy">
                  <strong>{check.label}</strong>

                  <span>{check.description}</span>
                </div>

                <span className="check-status">
                  {check.passed ? "Complete" : "Needs attention"}
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* AI Results                                                       */}
        {/* ---------------------------------------------------------------- */}

        {analysis && (
          <section className="ai-results">
            {/* AI Header */}

            <div className="ai-results-header">
              <div>
                <div className="eyebrow">
                  <span className="eyebrow-dot" />
                  AI analysis complete
                </div>

                <h2>Optimization recommendations</h2>

                <p>{analysis.summary}</p>
              </div>

              <div className="ai-results-actions">
                <div className="ai-score">
                  <span className="ai-score-value">{analysis.score}</span>

                  <span className="ai-score-label">/ 100</span>
                </div>

                <s-button
                  variant="primary"
                  disabled={isUpdating}
                  onClick={handleUpdateProduct}
                >
                  {isUpdating ? "Updating..." : "Update product"}
                </s-button>
              </div>
            </div>

            {/* ---------------------------------------------------------------- */}
            {/* Title                                                            */}
            {/* ---------------------------------------------------------------- */}

            <div className="ai-recommendation">
              <div className="ai-recommendation-header">
                <div>
                  <span className="ai-recommendation-category">
                    Product title
                  </span>

                  <h3>Improve your product title</h3>
                </div>

                <span className="priority priority-medium">Medium</span>
              </div>

              <div className="comparison-grid">
                <div className="comparison current">
                  <span>Current</span>

                  <p>{analysis.title.current || "No title"}</p>
                </div>

                <div className="comparison suggested">
                  <span>Suggested</span>

                  <p>{analysis.title.suggested}</p>
                </div>
              </div>

              <div className="recommendation-reason">
                <strong>Why this matters</strong>

                <p>{analysis.title.reason}</p>
              </div>
            </div>

            {/* ---------------------------------------------------------------- */}
            {/* Description                                                       */}
            {/* ---------------------------------------------------------------- */}

            <div className="ai-recommendation">
              <div className="ai-recommendation-header">
                <div>
                  <span className="ai-recommendation-category">
                    Product description
                  </span>

                  <h3>Improve your product description</h3>
                </div>

                <span className="priority priority-high">High</span>
              </div>

              <div className="comparison-grid">
                <div className="comparison current">
                  <span>Current</span>

                  <p>{analysis.description.current || "No description"}</p>
                </div>

                <div className="comparison suggested">
                  <span>Suggested</span>

                  <p
                    dangerouslySetInnerHTML={{
                      __html: analysis.description.suggested,
                    }}
                  />
                </div>
              </div>

              <div className="recommendation-reason">
                <strong>Why this matters</strong>

                <p>{analysis.description.reason}</p>
              </div>
            </div>

            {/* ---------------------------------------------------------------- */}
            {/* SEO                                                              */}
            {/* ---------------------------------------------------------------- */}

            <div className="ai-recommendation">
              <div className="ai-recommendation-header">
                <div>
                  <span className="ai-recommendation-category">SEO</span>

                  <h3>Improve SEO metadata</h3>
                </div>

                <span className="priority priority-high">High</span>
              </div>

              <div className="seo-suggestion">
                <div>
                  <span>SEO title</span>

                  <p>{analysis.seo.title.suggested}</p>
                </div>

                <div>
                  <span>SEO description</span>

                  <p>{analysis.seo.description.suggested}</p>
                </div>
              </div>

              <div className="recommendation-reason">
                <strong>Why this matters</strong>

                <p>{analysis.seo.title.reason}</p>
              </div>
            </div>

            {/* ---------------------------------------------------------------- */}
            {/* Tags                                                             */}
            {/* ---------------------------------------------------------------- */}

            <div className="ai-recommendation">
              <div className="ai-recommendation-header">
                <div>
                  <span className="ai-recommendation-category">Tags</span>

                  <h3>Improve product organization</h3>
                </div>

                <span className="priority priority-low">Low</span>
              </div>

              <div className="tag-suggestion">
                {analysis.tags.suggested.map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </div>

              <div className="recommendation-reason">
                <strong>Why this matters</strong>

                <p>{analysis.tags.reason}</p>
              </div>
            </div>

            {/* ---------------------------------------------------------------- */}
            {/* Bottom Update                                                     */}
            {/* ---------------------------------------------------------------- */}

            <div className="ai-update-footer">
              <div>
                <strong>Ready to optimize?</strong>

                <p>
                  Apply the AI-generated title, description, SEO metadata and
                  tags directly to Shopify.
                </p>
              </div>

              <s-button
                variant="primary"
                disabled={isUpdating}
                onClick={handleUpdateProduct}
              >
                {isUpdating ? "Updating..." : "Update product"}
              </s-button>
            </div>
            <footer className="app-footer">
              <Link to="/privacy">Privacy Policy</Link>

              <Link to="/terms">Terms of Service</Link>

              <Link to="/support">Support</Link>
            </footer>
          </section>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* AI Recommendation Panel                                          */}
        {/* ---------------------------------------------------------------- */}

        <section className="ai-recommendation-card">
          <div className="ai-recommendation-icon">✦</div>

          <div className="ai-recommendation-content">
            <span className="eyebrow">AI optimization</span>

            <h2>Generate product recommendations</h2>

            <p>
              Let AI analyze your product and generate improved titles,
              descriptions, SEO metadata and tags.
            </p>
          </div>

          <div className="ai-recommendation-action">
            <s-button
              variant="primary"
              disabled={isAnalyzing || isUpdating}
              onClick={handleAnalyze}
            >
              {isAnalyzing ? "Analyzing..." : "Start AI analysis"}
            </s-button>
          </div>
        </section>
      </div>
    </s-page>
  );
}

/* -------------------------------------------------------------------------- */
/* Headers                                                                    */
/* -------------------------------------------------------------------------- */

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
