import { useState } from "react";
import type {
  HeadersFunction,
  LoaderFunctionArgs,
} from "react-router";
import { Link, useLoaderData } from "react-router";

import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

import "../styles/product-optimizer.css";
import "../styles/product-detail.css";

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

  /*
   * Dashboard URL:
   *
   * /app/products/123456789
   *
   * Shopify Admin GraphQL:
   *
   * gid://shopify/Product/123456789
   */

  const productGid = id.startsWith("gid://")
    ? id
    : `gid://shopify/Product/${id}`;

  console.log(
    "[AI Product Optimizer] Loading product:",
    productGid,
  );

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
      product?: Product;
      shop?: {
        myshopifyDomain: string;
      };
    };
    errors?: unknown[];
  };

  if (responseJson.errors?.length) {
    console.error(
      "[AI Product Optimizer] Product GraphQL error:",
      responseJson.errors,
    );

    throw new Response(
      "Shopify could not load this product.",
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

    throw new Response(
      "Product not found in Shopify.",
      {
        status: 404,
      },
    );
  }

  return {
    product,
    shopDomain: data.shop.myshopifyDomain,
  };
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function getSeoStatus(product: Product) {
  const hasTitle = Boolean(product.seo?.title?.trim());
  const hasDescription = Boolean(
    product.seo?.description?.trim(),
  );

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
  return status
    .toLowerCase()
    .replaceAll("_", " ");
}

function getDescriptionLength(description: string) {
  return description?.trim().length ?? 0;
}

function getShopifyProductUrl(
  shopDomain: string, 
  productId: string,
) {
  const storeHandle = shopDomain.replace(".myshopify.com", "");

  return `https://admin.shopify.com/store/${storeHandle}/products/${productId}`;
}

/* -------------------------------------------------------------------------- */
/* Product Detail                                                             */
/* -------------------------------------------------------------------------- */

export default function ProductOptimizer() {
  const { product, shopDomain } = useLoaderData<typeof loader>();
  const productId = product.id.split("/").pop() ?? "";

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<AIProductAnalysis | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const seo = getSeoStatus(product);
  const descriptionLength = getDescriptionLength(product.description);
  const hasDescription = descriptionLength > 0;
  const hasSeoTitle = Boolean(product.seo?.title?.trim());
  const hasSeoDescription = Boolean(product.seo?.description?.trim());
  const hasTags = product.tags.length > 0;
  const checks = [
    {
      label: "Product title",
      description:
        "A clear product title is available.",
      passed: Boolean(product.title.trim()),
    },
    {
      label: "Product description",
      description:
        "The product contains descriptive content.",
      passed: hasDescription,
    },
    {
      label: "SEO title",
      description:
        "A dedicated SEO title is configured.",
      passed: hasSeoTitle,
    },
    {
      label: "SEO description",
      description:
        "A dedicated SEO description is configured.",
      passed: hasSeoDescription,
    },
    {
      label: "Product tags",
      description:
        "The product has searchable tags.",
      passed: hasTags,
    },
  ];

  const completedChecks =
    checks.filter((check) => check.passed).length;

  async function handleAnalyze() {
    setIsAnalyzing(true);
    setAnalysisError(null);

    try {
      const response = await fetch(
        `/app/products/${product.id.split("/").pop()}/analyze`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
        },
      );

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(
          result.error || "Unable to analyze product.",
        );
      }

      setAnalysis(result.analysis);
    } catch (error) {
      console.error("AI analysis failed:", error);

      setAnalysisError(
        error instanceof Error
          ? error.message
          : "Unable to analyze product.",
      );
    } finally {
      setIsAnalyzing(false);
    }
  }

  return (
    <s-page heading="Product optimization">
      <div className="optimizer product-detail-page">

        {/* ---------------------------------------------------------------- */}
        {/* Navigation                                                       */}
        {/* ---------------------------------------------------------------- */}

        <div className="detail-navigation">
          <Link
            to="/app"
            className="back-link"
          >
            <span>←</span>
            Products
          </Link>

          <span className="breadcrumb-separator">
            /
          </span>

          <span className="breadcrumb-current">
            {product.title}
          </span>
        </div>

        {/* ---------------------------------------------------------------- */}
        {/* Product hero                                                     */}
        {/* ---------------------------------------------------------------- */}

        <section className="product-detail-hero">

          <div className="product-detail-main">

            {product.featuredImage ? (
              <img
                src={product.featuredImage.url}
                alt={
                  product.featuredImage.altText ||
                  product.title
                }
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
                Review product content, SEO and
                discoverability opportunities.
              </p>

              <div className="product-detail-meta">
                <span>
                  {product.vendor || "No vendor"}
                </span>

                <span>
                  {product.productType || "Product"}
                </span>

                <span>
                  {getStatusLabel(product.status)}
                </span>
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
              disabled={isAnalyzing}
              onClick={handleAnalyze}
            >
              {isAnalyzing
                ? "Analyzing..."
                : "Analyze with AI"}
            </s-button>
          </div>

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
              >
                Try again
              </s-button>
            </div>
          )}
        </section>

        

        {/* ---------------------------------------------------------------- */}
        {/* Overview                                                         */}
        {/* ---------------------------------------------------------------- */}

        <section className="detail-grid">

          {/* Score */}

          <div className="detail-card">

            <div className="detail-card-header">
              <div>
                <h2>Optimization score</h2>

                <p>
                  Based on the product information
                  currently available.
                </p>
              </div>
            </div>

            <div className="score-content">

              <div
                className={`score-circle score-${seo.type}`}
              >
                <span className="score-value">
                  {seo.score}
                </span>

                <span className="score-label">
                  / 100
                </span>
              </div>

              <div className="score-summary">

                <span
                  className={`optimization optimization-${seo.type}`}
                >
                  <span className="optimization-icon">
                    {seo.type === "success" && "✓"}
                    {seo.type === "warning" && "•"}
                    {seo.type === "critical" && "!"}
                  </span>

                  {seo.label}
                </span>

                <h3>
                  {completedChecks} of{" "}
                  {checks.length} checks passed
                </h3>

                <p>
                  Improve the areas marked below to
                  increase product quality,
                  discoverability and conversion
                  potential.
                </p>

              </div>

            </div>

          </div>

          {/* Product information */}

          <div className="detail-card">

            <div className="detail-card-header">
              <div>
                <h2>Product information</h2>

                <p>
                  Current information stored in
                  Shopify.
                </p>
              </div>
            </div>

            <div className="detail-fields">

              <div className="detail-field">
                <span className="detail-field-label">
                  Title
                </span>

                <span className="detail-field-value">
                  {product.title || "Not set"}
                </span>
              </div>

              <div className="detail-field">
                <span className="detail-field-label">
                  Handle
                </span>

                <span className="detail-field-value">
                  {product.handle || "Not set"}
                </span>
              </div>

              <div className="detail-field">
                <span className="detail-field-label">
                  Vendor
                </span>

                <span className="detail-field-value">
                  {product.vendor || "Not set"}
                </span>
              </div>

              <div className="detail-field">
                <span className="detail-field-label">
                  Type
                </span>

                <span className="detail-field-value">
                  {product.productType || "Not set"}
                </span>
              </div>

            </div>

          </div>

        </section>

        {/* ---------------------------------------------------------------- */}
        {/* SEO analysis                                                     */}
        {/* ---------------------------------------------------------------- */}

        <section className="detail-card">

          <div className="detail-card-header">

            <div>
              <h2>SEO analysis</h2>

              <p>
                Review the metadata search engines
                can use to understand this product.
              </p>
            </div>

            <span
              className={`optimization optimization-${seo.type}`}
            >
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
                hasSeoTitle
                  ? "analysis-success"
                  : "analysis-critical"
              }`}
            >

              <div className="analysis-icon">
                {hasSeoTitle ? "✓" : "!"}
              </div>

              <div className="analysis-content">

                <span className="analysis-label">
                  SEO title
                </span>

                <strong>
                  {hasSeoTitle
                    ? product.seo.title
                    : "SEO title missing"}
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
                hasSeoDescription
                  ? "analysis-success"
                  : "analysis-critical"
              }`}
            >

              <div className="analysis-icon">
                {hasSeoDescription ? "✓" : "!"}
              </div>

              <div className="analysis-content">

                <span className="analysis-label">
                  SEO description
                </span>

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
        {/* Content analysis                                                 */}
        {/* ---------------------------------------------------------------- */}

        <section className="detail-card">

          <div className="detail-card-header">

            <div>
              <h2>Content analysis</h2>

              <p>
                A quick analysis of the product
                content before AI recommendations
                are generated.
              </p>
            </div>

          </div>

          <div className="content-analysis">

            <div className="content-stat">
              <span className="content-stat-value">
                {descriptionLength}
              </span>

              <span className="content-stat-label">
                Description characters
              </span>
            </div>

            <div className="content-stat">
              <span className="content-stat-value">
                {product.tags.length}
              </span>

              <span className="content-stat-label">
                Tags
              </span>
            </div>

            <div className="content-stat">
              <span className="content-stat-value">
                {product.title.trim().length}
              </span>

              <span className="content-stat-label">
                Title characters
              </span>
            </div>

          </div>

          <div className="check-list">

            {checks.map((check) => (
              <div
                className="check-row"
                key={check.label}
              >

                <span
                  className={`check-icon ${
                    check.passed
                      ? "check-icon-success"
                      : "check-icon-critical"
                  }`}
                >
                  {check.passed ? "✓" : "!"}
                </span>

                <div className="check-copy">
                  <strong>{check.label}</strong>

                  <span>
                    {check.description}
                  </span>
                </div>

                <span className="check-status">
                  {check.passed
                    ? "Complete"
                    : "Needs attention"}
                </span>

              </div>
            ))}

          </div>

        </section>

        {analysis && (
          <section className="ai-results">
            <div className="ai-results-header">
              <div>
                <div className="eyebrow">
                  <span className="eyebrow-dot" />
                  AI analysis complete
                </div>

                <h2>Optimization recommendations</h2>

                <p>{analysis.summary}</p>
              </div>

              <div className="ai-score">
                <span className="ai-score-value">
                  {analysis.score}
                </span>

                <span className="ai-score-label">
                  / 100
                </span>
              </div>
            </div>

            {/* Title */}

            <div className="ai-recommendation">
              <div className="ai-recommendation-header">
                <div>
                  <span className="ai-recommendation-category">
                    Product title
                  </span>

                  <h3>Improve your product title</h3>
                </div>

                <span className="priority priority-medium">
                  Medium
                </span>
              </div>

              <div className="comparison-grid">
                <div className="comparison current">
                  <span>Current</span>

                  <p>
                    {analysis.title.current || "No title"}
                  </p>
                </div>

                <div className="comparison suggested">
                  <span>Suggested</span>

                  <p>
                    {analysis.title.suggested}
                  </p>
                </div>
              </div>

              <div className="recommendation-reason">
                <strong>Why this matters</strong>

                <p>{analysis.title.reason}</p>
              </div>
            </div>

            {/* Description */}

            <div className="ai-recommendation">
              <div className="ai-recommendation-header">
                <div>
                  <span className="ai-recommendation-category">
                    Product description
                  </span>

                  <h3>Improve your product description</h3>
                </div>

                <span className="priority priority-high">
                  High
                </span>
              </div>

              <div className="comparison-grid">
                <div className="comparison current">
                  <span>Current</span>

                  <p>
                    {analysis.description.current ||
                      "No description"}
                  </p>
                </div>

                <div className="comparison suggested">
                  <span>Suggested</span>

                  <p>
                    {analysis.description.suggested}
                  </p>
                </div>
              </div>

              <div className="recommendation-reason">
                <strong>Why this matters</strong>

                <p>
                  {analysis.description.reason}
                </p>
              </div>
            </div>

            {/* SEO */}

            <div className="ai-recommendation">
              <div className="ai-recommendation-header">
                <div>
                  <span className="ai-recommendation-category">
                    SEO
                  </span>

                  <h3>Improve SEO metadata</h3>
                </div>

                <span className="priority priority-high">
                  High
                </span>
              </div>

              <div className="seo-suggestion">
                <div>
                  <span>SEO title</span>

                  <p>
                    {analysis.seo.title.suggested}
                  </p>
                </div>

                <div>
                  <span>SEO description</span>

                  <p>
                    {analysis.seo.description.suggested}
                  </p>
                </div>
              </div>

              <div className="recommendation-reason">
                <strong>Why this matters</strong>

                <p>
                  {analysis.seo.title.reason}
                </p>
              </div>
            </div>

            {/* Tags */}

            <div className="ai-recommendation">
              <div className="ai-recommendation-header">
                <div>
                  <span className="ai-recommendation-category">
                    Tags
                  </span>

                  <h3>Improve product organization</h3>
                </div>

                <span className="priority priority-low">
                  Low
                </span>
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
          </section>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* AI recommendation panel                                          */}
        {/* ---------------------------------------------------------------- */}

        <section className="ai-recommendation-card">

          <div className="ai-recommendation-icon">
            ✦
          </div>

          <div className="ai-recommendation-content">

            <span className="eyebrow">
              AI optimization
            </span>

            <h2>
              Generate product recommendations
            </h2>

            <p>
              Let AI analyze your product and
              generate improved titles, descriptions,
              SEO metadata and tags.
            </p>

          </div>

          <div className="ai-recommendation-action">

            <s-button
              variant="primary"
              disabled={isAnalyzing}
              onClick={handleAnalyze}
            >
              {isAnalyzing
                ? "Analyzing..."
                : "Start AI analysis"}
            </s-button>

          </div>

        </section>

      </div>
    </s-page>
  );
}

export const headers: HeadersFunction = (
  headersArgs,
) => {
  return boundary.headers(headersArgs);
};