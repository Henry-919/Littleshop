export interface Product {
  id: string;
  name: string;
  stock: number;
  price: number;
  category?: string;
  cost_price?: number;
  time?: string;
  deleted_at?: string | null;
}

export interface Sale {
  id: string;
  productId: string;
  quantity: number;
  totalAmount: number;
  salesperson: string;
  date: string;
}

export interface AnalyticsData {
  bestSellers: { name: string; total_sold: number; revenue: number }[];
  lowStock: Product[];
  dailySales: { date: string; revenue: number }[];
}
