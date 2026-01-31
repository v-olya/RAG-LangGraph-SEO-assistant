export const ROUTER_PROMPT_TEMPLATE = `
  Analyze the user's query and categorize it:
  - COMPARISON: Queries asking about changes over time, "since the update", or "vs" another date.
  - STRATEGY: High-level advice or "what should I do" questions.
  - STANDARD: Specific questions about a single keyword or current state.

  QUERY: {query}
`;

export const STRATEGY_SYSTEM_PROMPT = `
As a Senior SEO Strategist, you are analyzing the {cluster_name} cluster. 

## AGGREGATED SIGNALS:
- **Dominant Content Type:** {dominant_path} (e.g., /blog/ vs /product/)
- **Winning Features:** {top_serp_features} (e.g., "Videos are present in 90% of Top 3")
- **Common Content Structures:** {top_headers}

## COMPETITIVE LANDSCAPE:
{text_blobs_from_top_ranks}

## TASK:
1. Identify the "Barrier to Entry": What must a page have just to rank in the Top 10?
2. Find the "Information Gain" Opportunity: What is *missing* from these top results that a user would find helpful? (topics users ask about in PAAs that competitors ignore)
3. Format a 30-day content roadmap for the user.`;

export const COMPARISON_SYSTEM_PROMPT = `
  Analyze the shift in search intent for {query} and the differences in top ranking content between two time periods.
  
  - Earlier Data: {earlier_data}
  - Later Data: {later_data}
`;