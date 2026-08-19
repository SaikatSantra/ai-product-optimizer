export type AIRecommendationPriority = "high" | "medium" | "low";

export type AIProductAnalysis = {
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
    priority: AIRecommendationPriority;
    category: string;
    recommendation: string;
  }[];
};

export type AIProductInput = {
  title: string;
  description: string;
  productType: string;
  vendor: string;
  tags: string[];
  seoTitle: string | null;
  seoDescription: string | null;
};

/**
 * AI product analysis service.
 *
 * This function is intentionally kept independent from Shopify.
 * Later we can connect OpenAI, Gemini, Anthropic, or another
 * provider without changing the route architecture.
 */
export async function analyzeProductWithAI(
  product: AIProductInput,
): Promise<AIProductAnalysis> {
  /*
   * Temporary deterministic analysis.
   *
   * This is NOT the final AI implementation.
   * It gives us a stable response shape so we can build and
   * test the complete Shopify application workflow first.
   */

  const titleLength = product.title.trim().length;
  const descriptionLength = product.description.trim().length;

  let score = 100;

  if (!product.title.trim()) {
    score -= 25;
  } else if (titleLength < 30) {
    score -= 10;
  }

  if (!product.description.trim()) {
    score -= 25;
  } else if (descriptionLength < 300) {
    score -= 15;
  }

  if (!product.seoTitle?.trim()) {
    score -= 15;
  }

  if (!product.seoDescription?.trim()) {
    score -= 15;
  }

  if (product.tags.length === 0) {
    score -= 10;
  }

  score = Math.max(0, Math.min(100, score));

  const suggestedTitle =
    product.title.trim() ||
    `${product.productType || "Product"} by ${product.vendor || "Your Store"}`;

  const suggestedDescription =
    product.description.trim() ||
    `Discover ${suggestedTitle}. Explore product details, features, and benefits designed to help customers make a confident purchase.`;

  const suggestedSeoTitle =
    product.seoTitle?.trim() ||
    `${suggestedTitle} | ${product.vendor || "Shop Online"}`;

  const suggestedSeoDescription =
    product.seoDescription?.trim() ||
    `Shop ${suggestedTitle}. Discover product details, key features, and benefits from ${product.vendor || "our store"}.`;

  const suggestedTags =
    product.tags.length > 0
      ? product.tags
      : [
          product.productType || "product",
          product.vendor || "shop",
        ].filter(Boolean);

  const recommendations: AIProductAnalysis["recommendations"] = [];

  if (titleLength < 30) {
    recommendations.push({
      priority: "medium",
      category: "Title",
      recommendation:
        "Make the product title more descriptive and include the most important customer-facing product attributes.",
    });
  }

  if (descriptionLength < 300) {
    recommendations.push({
      priority: "high",
      category: "Description",
      recommendation:
        "Expand the product description with useful product details, benefits, features, and information that helps customers make a purchase decision.",
    });
  }

  if (!product.seoTitle?.trim()) {
    recommendations.push({
      priority: "high",
      category: "SEO",
      recommendation:
        "Add a unique SEO title that clearly describes the product and targets relevant search intent.",
    });
  }

  if (!product.seoDescription?.trim()) {
    recommendations.push({
      priority: "high",
      category: "SEO",
      recommendation:
        "Add a compelling SEO description that explains the product and encourages qualified search users to visit the store.",
    });
  }

  if (product.tags.length === 0) {
    recommendations.push({
      priority: "low",
      category: "Tags",
      recommendation:
        "Add relevant product tags to improve organization, filtering, and internal product discovery.",
    });
  }

  return {
    score,

    summary:
      score >= 85
        ? "This product has a strong content foundation with a few opportunities for improvement."
        : score >= 60
          ? "This product has several optimization opportunities that could improve search visibility and product quality."
          : "This product needs significant content and SEO improvements before it can be considered well optimized.",

    title: {
      current: product.title,
      suggested: suggestedTitle,
      reason:
        "The title should clearly communicate what the product is and include useful descriptive attributes.",
    },

    description: {
      current: product.description,
      suggested: suggestedDescription,
      reason:
        "A stronger description should explain the product, communicate benefits, and provide useful information for customers and search engines.",
    },

    seo: {
      title: {
        current: product.seoTitle,
        suggested: suggestedSeoTitle,
        reason:
          "The SEO title should clearly describe the product and provide relevant search context.",
      },

      description: {
        current: product.seoDescription,
        suggested: suggestedSeoDescription,
        reason:
          "The SEO description should summarize the product clearly and encourage relevant search users to click.",
      },
    },

    tags: {
      current: product.tags,
      suggested: suggestedTags,
      reason:
        "Relevant tags improve product organization and can support collection and filtering strategies.",
    },

    recommendations,
  };
}