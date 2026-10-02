import { Link } from 'react-router-dom';
import { Badge } from './Badge';
import { useProductContext } from '../context/ProductContext';
import type { ReactNode } from 'react';

export function RequireProduct({ children }: { children: ReactNode }) {
  const { selectedProduct, selectedProductId, loading } = useProductContext();

  if (loading) {
    return <div className="card text-sm font-bold text-muted">Loading selected product...</div>;
  }

  if (!selectedProductId || !selectedProduct) {
    return (
      <section className="card text-center">
        <h2 className="text-2xl font-extrabold">Select a product</h2>
        <p className="mx-auto mt-2 max-w-2xl text-muted">Please select a product from the header to continue. You can also create a new product to start the workflow.</p>
        <Link className="btn btn-primary mt-5" to="/setup">Create Product</Link>
      </section>
    );
  }

  return (
    <>
      <section className="card mb-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-extrabold uppercase tracking-wide text-primary">Showing data for selected product only.</p>
            <h2 className="mt-1 text-2xl font-extrabold">{selectedProduct.name}</h2>
            <p className="mt-1 text-sm text-muted">Owner: {selectedProduct.owner || 'Unassigned'}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge>{selectedProduct.product_type || selectedProduct.type || 'Product'}</Badge>
            <Badge>{selectedProduct.environment || 'Environment'}</Badge>
            <Badge>{selectedProduct.default_framework || selectedProduct.framework || 'Framework'}</Badge>
          </div>
        </div>
      </section>
      {children}
    </>
  );
}
