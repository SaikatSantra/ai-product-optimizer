import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";

import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

import "../styles/product-optimizer.css";

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
  products: Product[];
};

export async function loader({
  request,
}: LoaderFunctionArgs): Promise<LoaderData> {
  const { admin } = await authenticate.admin(request);

  const response = await admin.graphql(
    `#graphql
      query GetProducts {
        products(
          first: 50
          sortKey: UPDATED_AT
          reverse: true
        ) {
          nodes {
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
      }
    `,
  );

  const responseJson = (await response.json()) as {
    errors?: unknown[];
    data?: {
      products?: {
        nodes?: Product[];
      };
    };
  };

  if (responseJson.errors?.length) {
    console.error(
      "Shopify GraphQL errors while loading products:",
      responseJson.errors,
    );

    throw new Response("Unable to load products from Shopify.", {
      status: 500,
    });
  }

  const products = responseJson.data?.products?.nodes;

  if (!Array.isArray(products)) {
    console.error("Unexpected Shopify products response:", responseJson);

    throw new Response("Unable to load products from Shopify.", {
      status: 500,
    });
  }

  return {
    products,
  };
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function getProductId(gid: string): string {
  const parts = gid.split("/");
  return parts[parts.length - 1] ?? "";
}

function getSeoStatus(product: Product) {
  const hasTitle = Boolean(product.seo?.title?.trim());
  const hasDescription = Boolean(product.seo?.description?.trim());

  if (hasTitle && hasDescription) {
    return {
      label: "Optimized",
      type: "success" as const,
    };
  }

  if (hasTitle || hasDescription) {
    return {
      label: "Partial",
      type: "warning" as const,
    };
  }

  return {
    label: "Needs work",
    type: "critical" as const,
  };
}

function getStatusLabel(status: string): string {
  return status.toLowerCase().replaceAll("_", " ");
}

/* -------------------------------------------------------------------------- */
/* Dashboard                                                                  */
/* -------------------------------------------------------------------------- */

export default function Dashboard() {
  const { products } = useLoaderData<typeof loader>();

  const optimizedCount = products.filter(
    (product) => getSeoStatus(product).type === "success",
  ).length;

  const partialCount = products.filter(
    (product) => getSeoStatus(product).type === "warning",
  ).length;

  const needsWorkCount = products.filter(
    (product) => getSeoStatus(product).type === "critical",
  ).length;

  return (
    <s-page heading="AI Product Optimizer">
      <div className="optimizer">
        {/* ---------------------------------------------------------------- */}
        {/* Hero                                                             */}
        {/* ---------------------------------------------------------------- */}

        <section className="hero">
          <div className="hero-content">
            <div className="eyebrow">
              <span className="eyebrow-dot" />
              AI-powered product optimization
            </div>

            <h1>Improve your products with AI</h1>

            <p>
              Analyze product content, SEO and discoverability. Get actionable
              recommendations to improve every product in your store.
            </p>
          </div>

          <div className="hero-stats">
            <div className="hero-stat">
              <span className="hero-stat-value">{products.length}</span>

              <span className="hero-stat-label">Products</span>
            </div>

            <div className="hero-stat-divider" />

            <div className="hero-stat">
              <span className="hero-stat-value">{optimizedCount}</span>

              <span className="hero-stat-label">Optimized</span>
            </div>

            <div className="hero-stat-divider" />

            <div className="hero-stat">
              <span className="hero-stat-value">{partialCount}</span>

              <span className="hero-stat-label">Partial</span>
            </div>

            <div className="hero-stat-divider" />

            <div className="hero-stat">
              <span className="hero-stat-value">{needsWorkCount}</span>

              <span className="hero-stat-label">Needs work</span>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* Product workspace                                                */}
        {/* ---------------------------------------------------------------- */}

        <section className="workspace">
          <div className="workspace-header">
            <div>
              <h2>Product optimization</h2>

              <p>
                Review your products and identify the biggest optimization
                opportunities.
              </p>
            </div>

            <div className="workspace-meta">{products.length} products</div>
          </div>

          {products.length === 0 ? (
            <div className="empty-state">
              <div className="empty-icon">✦</div>

              <h3>No products found</h3>

              <p>
                Products from your Shopify store will appear here when they are
                available.
              </p>
            </div>
          ) : (
            <div className="product-list">
              <div className="product-list-header">
                <span>Product</span>
                <span>Type</span>
                <span>Status</span>
                <span>Optimization</span>
                <span />
              </div>

              {products.map((product) => {
                const seo = getSeoStatus(product);
                const productId = getProductId(product.id);

                return (
                  <div className="product-row" key={product.id}>
                    {/* Product */}
                    <div className="product-cell product-main">
                      {product.featuredImage ? (
                        <img
                          src={product.featuredImage.url}
                          alt={product.featuredImage.altText || product.title}
                          className="product-image"
                        />
                      ) : (
                        <div className="product-image product-image-empty">
                          <span>✦</span>
                        </div>
                      )}

                      <div className="product-copy">
                        <span className="product-title">{product.title}</span>

                        <span className="product-vendor">
                          {product.vendor || "No vendor"}
                        </span>
                      </div>
                    </div>

                    {/* Type */}
                    <div className="product-cell">
                      <span className="muted-text">
                        {product.productType || "—"}
                      </span>
                    </div>

                    {/* Status */}
                    <div className="product-cell">
                      <span
                        className={`status status-${getStatusLabel(
                          product.status,
                        ).replaceAll(" ", "-")}`}
                      >
                        <span className="status-dot" />

                        {getStatusLabel(product.status)}
                      </span>
                    </div>

                    {/* Optimization */}
                    <div className="product-cell">
                      <span className={`optimization optimization-${seo.type}`}>
                        <span className="optimization-icon">
                          {seo.type === "success" && "✓"}
                          {seo.type === "warning" && "•"}
                          {seo.type === "critical" && "!"}
                        </span>

                        {seo.label}
                      </span>
                    </div>

                    {/* Action */}
                    <div className="product-cell product-action">
                      <Link
                        to={`/app/products/${productId}`}
                        className="analyze-link"
                      >
                        Analyze
                        <span className="analyze-arrow">→</span>
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* ---------------------------------------------------------------- */}
        {/* Information                                                      */}
        {/* ---------------------------------------------------------------- */}

        <section className="info-grid">
          <div className="info-card">
            <div className="info-card-icon">✦</div>

            <div>
              <h3>What AI analyzes</h3>

              <p>
                Product information is evaluated across the areas that matter
                most for search visibility and conversion.
              </p>

              <div className="feature-list">
                <span>Title</span>
                <span>Description</span>
                <span>SEO metadata</span>
                <span>Tags</span>
                <span>Product structure</span>
              </div>
            </div>
          </div>

          <div className="info-card">
            <div className="info-card-icon">↗</div>

            <div>
              <h3>Optimization workflow</h3>

              <p>
                Analyze your product, review AI recommendations, then apply
                approved improvements directly to Shopify.
              </p>

              <div className="workflow">
                <span>Analyze</span>
                <i>→</i>
                <span>Review</span>
                <i>→</i>
                <span>Apply</span>
              </div>
            </div>
          </div>
        </section>

        <section className="info-card" style={{ marginTop: "1.5rem" }}>
          <div className="info-card-icon">?</div>

          <div>
            <h3>Merchant support</h3>

            <p>
              Need help, have feedback, or want to understand how your product
              data is used? Visit our support and privacy pages.
            </p>

            <div className="workflow">
              <Link to="/support">Support</Link>
              <i>•</i>
              <Link to="/privacy">Privacy</Link>
            </div>
          </div>
        </section>
      </div>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
