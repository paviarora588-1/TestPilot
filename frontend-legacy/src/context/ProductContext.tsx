import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { errorMessage, listProducts } from '../services/api';
import type { Product } from '../types';

const STORAGE_KEY = 'testpilot_product_id';

interface ProductContextValue {
  products: Product[];
  selectedProduct?: Product;
  selectedProductId: number;
  setSelectedProductId: (id: number) => void;
  refreshProducts: () => Promise<Product[]>;
  loading: boolean;
  error: string;
}

const ProductContext = createContext<ProductContextValue | undefined>(undefined);

export function ProductProvider({ children }: { children: ReactNode }) {
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedProductId, setSelectedProductIdState] = useState<number>(() => Number(localStorage.getItem(STORAGE_KEY) || 0));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  function setSelectedProductId(id: number) {
    setSelectedProductIdState(id);
    if (id) {
      localStorage.setItem(STORAGE_KEY, String(id));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  async function refreshProducts() {
    setLoading(true);
    setError('');
    try {
      const rows = await listProducts();
      setProducts(rows);
      setSelectedProductIdState((current) => {
        const stored = Number(localStorage.getItem(STORAGE_KEY) || 0);
        const candidate = current || stored;
        if (candidate && rows.some((product) => product.id === candidate)) {
          localStorage.setItem(STORAGE_KEY, String(candidate));
          return candidate;
        }
        if (rows[0]) {
          localStorage.setItem(STORAGE_KEY, String(rows[0].id));
          return rows[0].id;
        }
        localStorage.removeItem(STORAGE_KEY);
        return 0;
      });
      return rows;
    } catch (error) {
      setError(errorMessage(error));
      return [];
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refreshProducts();
  }, []);

  const selectedProduct = useMemo(
    () => products.find((product) => product.id === selectedProductId),
    [products, selectedProductId]
  );

  return (
    <ProductContext.Provider value={{ products, selectedProduct, selectedProductId, setSelectedProductId, refreshProducts, loading, error }}>
      {children}
    </ProductContext.Provider>
  );
}

export function useProductContext() {
  const context = useContext(ProductContext);
  if (!context) {
    throw new Error('useProductContext must be used inside ProductProvider');
  }
  return context;
}
