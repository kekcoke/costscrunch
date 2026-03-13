export interface AnalyticsQuery {
  period?: "week" | "month" | "quarter" | "year";
  categories?: string[];
  from?: string;
  to?: string;
  currency?: string;
  scope?: "personal" | "group" | "all";
  chartType?: "donut" | "horizontalBar" | "bubble" | "stackedBar";
}

export interface ExpenseSummaryStats {
  period: string;
  startDate: string;
  totalAmount: number;
  expenseCount: number;
  byCategory: { category: string; amount: number }[];
  byStatus: Record<string, number>;
  byMonth: Record<string, number>;
  averageExpense: number;
  topCategory?: string;
}

export interface TrendBucket {
  label: string;
  total: number;
  count: number;
  categories?: Record<string, number>;
}

export interface AnalyticsTrends {
  trend: TrendBucket[];
}

export interface DonutChartDatum {
  label: string;
  value: number;
  color: string;
}

export interface HorizontalBarChartDatum {
  category: string;
  amount: number;
}

export interface BubbleChartDatum {
  date: string;
  amount: number;
  frequency: number;
  category: string;
}

export interface AnalyticsChartData {
  donut: DonutChartDatum[];
  horizontalBar: HorizontalBarChartDatum[];
  bubble: BubbleChartDatum[];
  stackedBar: TrendBucket[];
}