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
    <form onSubmit={handleSubmit} className="space-y-5" dir="rtl">
      <div className="overflow-hidden rounded-[28px] bg-gradient-to-br from-emerald-500 via-teal-500 to-zinc-900 p-5 text-white shadow-[0_24px_60px_rgba(15,23,42,0.22)]">
        <p className="text-xs font-medium text-white/75">Familia Admin</p>
        <h3 className="mt-2 text-2xl font-semibold">{product ? "עריכת מוצר" : "מוצר חדש"}</h3>
        <p className="mt-2 text-sm leading-6 text-white/80">מסך מעודכן עם היררכיה ברורה בין פרטי המוצר, המחיר והתמונה.</p>
      </div>

      <div className="space-y-4 rounded-[28px] border border-slate-200 bg-slate-50/80 p-4 sm:p-5">
        <div className="space-y-2.5">
          <div className="space-y-1">
            <Label className="text-sm font-semibold text-slate-900">שם המוצר</Label>
            <p className="text-xs leading-5 text-slate-500">שם קצר שיקל לזהות את המוצר באתר ובניהול.</p>
          </div>
          <Input
            className="h-12 rounded-2xl border-slate-200 bg-white text-base"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            required
          />
        </div>

        <div className="space-y-2.5">
          <div className="space-y-1">
            <Label className="text-sm font-semibold text-slate-900">מחיר (₪)</Label>
            <p className="text-xs leading-5 text-slate-500">המחיר שיוצג בכרטיס המוצר ללקוחות.</p>
          </div>
          <Input
            className="h-12 rounded-2xl border-slate-200 bg-white text-base"
            type="number"
            value={formData.price}
            onChange={(e) => setFormData({ ...formData, price: Number(e.target.value) })}
            required
          />
        </div>

        <div className="space-y-2.5">
          <div className="space-y-1">
            <Label className="text-sm font-semibold text-slate-900">תמונה</Label>
            <p className="text-xs leading-5 text-slate-500">אפשר להעלות תמונה חדשה או להשאיר את התמונה הקיימת.</p>
          </div>
          <Input
            className="h-12 rounded-2xl border-slate-200 bg-white text-base file:ml-4 file:rounded-full file:border-0 file:bg-black file:px-4 file:py-2 file:text-sm file:font-medium file:text-white"
            type="file"
            accept="image/*"
            onChange={(e) => setFile(e.target.files[0])}
          />
          {product?.image_url && !file && (
            <div className="rounded-[24px] border border-slate-200 bg-white p-3">
              <p className="mb-3 text-xs font-medium text-slate-500">תמונה נוכחית</p>
              <img src={product.image_url} alt="Current product" className="h-28 w-28 rounded-2xl object-cover" />
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-col-reverse gap-3 sm:flex-row">
        <Button type="button" variant="outline" onClick={onCancel} className="h-12 flex-1 rounded-2xl border-slate-200 bg-white text-base font-medium" disabled={uploading}>
          ביטול
        </Button>
        <Button type="submit" className="h-12 flex-1 rounded-2xl bg-black text-base font-medium text-white hover:bg-zinc-800" disabled={uploading}>
          {uploading ? "שומר..." : product ? 'עדכן מוצר' : 'הוסף מוצר'}
        </Button>
      </div>
    </form>
  );
}
