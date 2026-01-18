import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Product } from "@/api/entities";
import { Star } from "lucide-react";

export default function ProductGallery() {
  const [products, setProducts] = useState([]);

  useEffect(() => {
    const fetchProducts = async () => {
      try {
        const productData = await Product.list();
        const ordered = (productData || [])
          .filter((row) => row?.isActive !== false && row?.is_active !== false)
          .sort((a, b) => (a?.order_index ?? a?.orderIndex ?? 0) - (b?.order_index ?? b?.orderIndex ?? 0));
        setProducts(ordered);
      } catch (error) {
        console.error("Error fetching products:", error);
      }
    };

    fetchProducts();
  }, []);

  if (products.length === 0) {
    return null;
  }

  return (
    <div className="w-full">
      <div className="flex overflow-x-auto gap-3 py-2 scrollbar-hide">
        {products.map((product, index) => (
          <motion.div
            key={product.id}
            className="group relative flex-shrink-0 w-32 bg-white rounded-2xl overflow-hidden shadow-lg hover:shadow-xl transition-all duration-300"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: index * 0.1 }}
            whileHover={{ y: -4 }}
          >
            <div className="relative aspect-[4/5] overflow-hidden">
              <img
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                src={product.image_url || product.imageUrl}
                alt={product.name}
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
              
              <div className="absolute top-2 left-2 bg-black/80 backdrop-blur-sm text-white text-xs font-bold px-2 py-1 rounded-full">
                ₪{product.price}
              </div>
            </div>

            <div className="p-3">
              <h3 className="font-bold text-gray-900 text-center text-xs leading-tight">
                {product.name}
              </h3>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  );
}
