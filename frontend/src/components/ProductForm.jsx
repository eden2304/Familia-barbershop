import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UploadFile } from "@/api/integrations";

export default function ProductForm({ product, onSubmit, onCancel }) {
  const [formData, setFormData] = useState({
    name: product?.name || "",
    price: product?.price || 0,
  });
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!product && !file) {
      alert("נא לבחור תמונה עבור מוצר חדש.");
      return;
    }

    setUploading(true);
    let imageUrl = product?.image_url;

    try {
      if (file) {
        const { file_url } = await UploadFile.upload(file);
        imageUrl = file_url;
      }

      await onSubmit({
        ...formData,
        price: Number(formData.price),
        image_url: imageUrl,
      });

    } catch (error) {
      console.error("Error saving product:", error);
      alert("שגיאה בשמירת המוצר");
    } finally {
      setUploading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <Label>שם המוצר</Label>
        <Input
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          required
        />
      </div>
      
      <div>
        <Label>מחיר (₪)</Label>
        <Input
          type="number"
          value={formData.price}
          onChange={(e) => setFormData({ ...formData, price: Number(e.target.value) })}
          required
        />
      </div>

      <div>
        <Label>תמונה</Label>
        <Input
          type="file"
          accept="image/*"
          onChange={(e) => setFile(e.target.files[0])}
        />
        {product?.image_url && !file && (
          <img src={product.image_url} alt="Current product" className="mt-2 w-24 h-24 object-cover rounded-md" />
        )}
      </div>

      <div className="flex gap-3 pt-4">
        <Button type="submit" className="flex-1" disabled={uploading}>
          {uploading ? "שומר..." : product ? 'עדכן' : 'הוסף'}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel} className="flex-1" disabled={uploading}>
          ביטול
        </Button>
      </div>
    </form>
  );
}