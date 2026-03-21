import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UploadFile } from "@/api/integrations";
import { useSystemPopup } from "@/components/SystemPopupProvider";

export default function ProductForm({ product, onSubmit, onCancel }) {
  const [formData, setFormData] = useState({
    name: product?.name || "",
    price: product?.price || 0,
  });
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const { showAlert } = useSystemPopup();

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!product && !file) {
      await showAlert("נא לבחור תמונה עבור מוצר חדש.");
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
      await showAlert("שגיאה בשמירת המוצר");
    } finally {
      setUploading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4" dir="rtl">
      <div className="space-y-2.5">
        <Label className="text-sm font-semibold text-slate-900">שם המוצר</Label>
        <Input
          className="h-11 rounded-2xl border-slate-200 bg-white text-base"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          required
        />
      </div>

      <div className="space-y-2.5">
        <Label className="text-sm font-semibold text-slate-900">מחיר (₪)</Label>
        <Input
          className="h-11 rounded-2xl border-slate-200 bg-white text-base"
          type="number"
          value={formData.price}
          onChange={(e) => setFormData({ ...formData, price: Number(e.target.value) })}
          required
        />
      </div>

      <div className="space-y-2.5">
        <Label className="text-sm font-semibold text-slate-900">תמונה</Label>
        <Input
          className="h-11 rounded-2xl border-slate-200 bg-white text-base file:ml-4 file:rounded-full file:border-0 file:bg-black file:px-4 file:py-2 file:text-sm file:font-medium file:text-white"
          type="file"
          accept="image/*"
          onChange={(e) => setFile(e.target.files[0])}
        />
        {product?.image_url && !file && (
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
            <img src={product.image_url} alt="Current product" className="h-24 w-24 rounded-xl object-cover" />
          </div>
        )}
      </div>

      <div className="flex flex-col-reverse gap-3 pt-1 sm:flex-row">
        <Button type="button" variant="outline" onClick={onCancel} className="h-11 flex-1 rounded-2xl border-slate-200 bg-white text-base font-medium" disabled={uploading}>
          ביטול
        </Button>
        <Button type="submit" className="h-11 flex-1 rounded-2xl bg-black text-base font-medium text-white hover:bg-zinc-800" disabled={uploading}>
          {uploading ? "שומר..." : product ? 'עדכן מוצר' : 'הוסף מוצר'}
        </Button>
      </div>
    </form>
  );
}
