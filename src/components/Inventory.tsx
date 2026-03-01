import React, { useEffect, useState, useMemo, useRef } from 'react';
import { useStore } from '../hooks/useStore';
import { supabase } from '../lib/supabase';
import * as XLSX from 'xlsx';
import heic2any from 'heic2any';
import { 
  Layers, Search, ScanLine, Plus, Edit2, Trash2, Check, RotateCcw, X, AlertTriangle, ArrowRightLeft, ImageUp, Loader2, History
} from 'lucide-react';
import { ExcelImporter } from './ExcelImporter';
import { ReceiptScanner } from './ReceiptScanner';
import { StockBatchImporter } from './StockBatchImporter';
import { formatZhDateTime } from '../lib/date';
import { appendInboundLogs, getInboundLogsByStore } from '../lib/inboundLog';

const normalizeModel = (value: string) =>
  value
    .toLowerCase()
    .replace(/[\s_\-./\\()[\]{}]+/g, '')
    .replace(/[^\u4e00-\u9fa5a-z0-9]/g, '');

const levenshteinDistance = (a: string, b: string): number => {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const matrix: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) matrix[i][0] = i;
  for (let j = 0; j <= b.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }
  return matrix[a.length][b.length];
};

const scoreModelSimilarity = (source: string, target: string) => {
  const sourceNormalized = normalizeModel(source);
  const targetNormalized = normalizeModel(target);
  if (!sourceNormalized || !targetNormalized) return 0;
  if (sourceNormalized === targetNormalized) return 1;
  if (sourceNormalized.includes(targetNormalized) || targetNormalized.includes(sourceNormalized)) return 0.92;
  const maxLen = Math.max(sourceNormalized.length, targetNormalized.length);
  return maxLen === 0 ? 0 : Math.max(0, 1 - levenshteinDistance(sourceNormalized, targetNormalized) / maxLen);
};

const fileToDataUrl = (file: File | Blob) => {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (evt) => resolve(String(evt.target?.result || ''));
    reader.onerror = () => reject(new Error('图片读取失败'));
    reader.readAsDataURL(file);
  });
};

const isHeicLike = (file: File) => {
  const type = String(file.type || '').toLowerCase();
  const name = String(file.name || '').toLowerCase();
  return type.includes('heic') || type.includes('heif') || /\.(heic|heif)$/.test(name);
};

const toJpegDataUrlIfNeeded = async (file: File) => {
  if (!isHeicLike(file)) return fileToDataUrl(file);
  const converted = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.9 });
  const jpegBlob = Array.isArray(converted) ? converted[0] : converted;
  if (!(jpegBlob instanceof Blob)) throw new Error('HEIC 转换失败');
  return fileToDataUrl(jpegBlob);
};

const compressImageDataUrl = (
  dataUrl: string,
  outputType: 'image/jpeg' | 'image/png' = 'image/jpeg',
  options?: { maxWidth?: number; jpegQuality?: number }
) => {
  return new Promise<string>((resolve, reject) => {
    const img = new Image();
    img.src = dataUrl;
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const maxWidth = options?.maxWidth || 1400;
      const jpegQuality = typeof options?.jpegQuality === 'number' ? options.jpegQuality : 0.82;
      let { width, height } = img;
      if (width > maxWidth) {
        height = Math.round(height * (maxWidth / width));
        width = maxWidth;
      }
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('图片压缩失败'));
      ctx.drawImage(img, 0, 0, width, height);
      const output = outputType === 'image/png'
        ? canvas.toDataURL('image/png')
        : canvas.toDataURL('image/jpeg', jpegQuality);
      resolve(output);
    };
    img.onerror = () => reject(new Error('图片压缩失败'));
  });
};

export function Inventory({ store, storeId }: { store: ReturnType<typeof useStore>; storeId?: string }) {
  // 1. 防御性数据获取
  const products = store?.products || [];
  const categories = store?.categories || [];
  const { updateProduct, deleteProduct, fetchData, loading, addProduct, transferStock } = store || {};

  const [isScanOpen, setIsScanOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editFormData, setEditFormData] = useState<any>(null);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [addFormData, setAddFormData] = useState({
    name: '',
    cost_price: '',
    stock: '',
    category_id: ''
  });
  const [inboundStart, setInboundStart] = useState('');
  const [inboundEnd, setInboundEnd] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [dwellFilter, setDwellFilter] = useState<'all' | '0-7' | '8-30' | '30+'>('all');
  const [stockStatusFilter, setStockStatusFilter] = useState<'all' | 'negative'>('all');
  const [showDeleted, setShowDeleted] = useState(false);
  const [deletedProducts, setDeletedProducts] = useState<any[]>([]);
  const [deletedLoading, setDeletedLoading] = useState(false);
  const [deletedPage, setDeletedPage] = useState(1);
  const [isTransferOpen, setIsTransferOpen] = useState(false);
  const [transferSubmitting, setTransferSubmitting] = useState(false);
  const [transferStores, setTransferStores] = useState<Array<{ id: string; name: string }>>([]);
  const [transferMode, setTransferMode] = useState<'manual' | 'image'>('manual');
  const [manualProductName, setManualProductName] = useState('');
  const transferImageInputRef = useRef<HTMLInputElement>(null);
  const [transferImageLoading, setTransferImageLoading] = useState(false);
  const [transferImageError, setTransferImageError] = useState<string | null>(null);
  const [transferImageRows, setTransferImageRows] = useState<Array<{ model: string; quantity: number; matchedProductId: string; score: number }>>([]);
  const [showTransferHistory, setShowTransferHistory] = useState(false);
  const [transferHistoryLoading, setTransferHistoryLoading] = useState(false);
  const [transferHistory, setTransferHistory] = useState<any[]>([]);
  const [transferHistoryError, setTransferHistoryError] = useState('');
  const [transferHistoryStart, setTransferHistoryStart] = useState('');
  const [transferHistoryEnd, setTransferHistoryEnd] = useState('');
  const [storeNameMap, setStoreNameMap] = useState<Record<string, string>>({});
  const [showInboundHistory, setShowInboundHistory] = useState(false);
  const [inboundHistoryLoading, setInboundHistoryLoading] = useState(false);
  const [inboundHistoryError, setInboundHistoryError] = useState('');
  const [inboundHistory, setInboundHistory] = useState<any[]>([]);
  const [inboundHistoryStart, setInboundHistoryStart] = useState('');
  const [inboundHistoryEnd, setInboundHistoryEnd] = useState('');
  const [inboundSourceFilter, setInboundSourceFilter] = useState<'all' | 'transfer_in' | 'batch_restock' | 'excel_import' | 'manual_add'>('all');
  const [transferForm, setTransferForm] = useState({
    productId: '',
    targetStoreId: '',
    quantity: '1'
  });

  const DELETED_PAGE_SIZE = 10;

  useEffect(() => {
    if (!isTransferOpen || !storeId) return;

    const loadTransferStores = async () => {
      const { data, error } = await supabase
        .from('stores')
        .select('id,name')
        .is('deleted_at', null)
        .neq('id', storeId)
        .order('name');
      if (!error && data) {
        setTransferStores(data);
      }
    };

    loadTransferStores();
  }, [isTransferOpen, storeId]);

  const loadDeletedProducts = async () => {
    if (!storeId) return;
    setDeletedLoading(true);
    const { data, error } = await supabase
      .from('products')
      .select('id, name, deleted_at')
      .eq('store_id', storeId)
      .not('deleted_at', 'is', null)
      .order('deleted_at', { ascending: false });
    if (!error && data) {
      setDeletedProducts(data);
    }
    setDeletedLoading(false);
  };

  const loadTransferHistory = async () => {
    if (!storeId) {
      setTransferHistory([]);
      setTransferHistoryError('当前门店未选择，无法加载调货记录');
      return;
    }

    setTransferHistoryLoading(true);
    setTransferHistoryError('');

    const [transfersRes, storesRes] = await Promise.all([
      supabase
        .from('stock_transfers')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500),
      supabase
        .from('stores')
        .select('id,name')
        .is('deleted_at', null)
    ]);

    if (!transfersRes.error && transfersRes.data) {
      const normalized = transfersRes.data
        .map((item: any, index: number) => ({
          id: item.id ?? `legacy-${index}-${item.created_at ?? ''}`,
          product_name: item.product_name ?? item.product ?? item.name ?? '-',
          quantity: Number(item.quantity ?? item.qty ?? 0),
          source_store_id: item.source_store_id ?? item.from_store_id ?? '',
          target_store_id: item.target_store_id ?? item.to_store_id ?? '',
          created_at: item.created_at ?? item.createdAt ?? item.time ?? null
        }))
        .filter((item: any) => item.source_store_id === storeId || item.target_store_id === storeId);

      setTransferHistory(normalized);
    } else {
      setTransferHistory([]);
      setTransferHistoryError(transfersRes.error?.message || '调货记录加载失败');
    }

    if (!storesRes.error && storesRes.data) {
      const map = storesRes.data.reduce((acc: Record<string, string>, item: any) => {
        acc[item.id] = item.name;
        return acc;
      }, {});
      setStoreNameMap(map);
    } else {
      setStoreNameMap({});
    }

    setTransferHistoryLoading(false);
  };

  const loadInboundHistory = async () => {
    if (!storeId) {
      setInboundHistory([]);
      setInboundHistoryError('当前门店未选择，无法加载入库记录');
      return;
    }

    setInboundHistoryLoading(true);
    setInboundHistoryError('');

    const [transfersRes, storesRes] = await Promise.all([
      supabase
        .from('stock_transfers')
        .select('*')
        .eq('target_store_id', storeId)
        .order('created_at', { ascending: false })
        .limit(500),
      supabase
        .from('stores')
        .select('id,name')
        .is('deleted_at', null)
    ]);

    const localStoreMap: Record<string, string> = {};
    if (!storesRes.error && storesRes.data) {
      storesRes.data.forEach((item: any) => {
        localStoreMap[item.id] = item.name;
      });
      setStoreNameMap(localStoreMap);
    }

    const transferInboundItems = (!transfersRes.error && transfersRes.data
      ? transfersRes.data.map((item: any, index: number) => ({
          id: item.id ?? `transfer-${index}-${item.created_at ?? ''}`,
          time: item.created_at ?? item.createdAt ?? new Date().toISOString(),
          source: 'transfer_in' as const,
          productName: item.product_name ?? item.product ?? item.name ?? '-',
          qty: Number(item.quantity ?? item.qty ?? 0),
          note: `调货调入：${localStoreMap[item.source_store_id] || item.source_store_id || '-'}`
        }))
      : []
    ).filter((item: any) => Number.isFinite(item.qty) && item.qty > 0);

    const localInboundItems = getInboundLogsByStore(storeId).map((item) => ({
      id: item.id,
      time: item.time,
      source: item.source,
      productName: item.productName,
      qty: Number(item.qty || 0),
      note: item.note || ''
    }));

    const merged = [...transferInboundItems, ...localInboundItems]
      .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
      .slice(0, 1000);

    setInboundHistory(merged);
    if (transfersRes.error) {
      setInboundHistoryError(transfersRes.error.message || '调货入库记录加载失败');
    }

    setInboundHistoryLoading(false);
  };

  const filteredTransferHistory = useMemo(() => {
    return transferHistory.filter((item) => {
      if (!item?.created_at) return !transferHistoryStart && !transferHistoryEnd;
      const created = new Date(item.created_at);
      if (Number.isNaN(created.getTime())) return false;

      const start = transferHistoryStart ? new Date(`${transferHistoryStart}T00:00:00`) : null;
      const end = transferHistoryEnd ? new Date(`${transferHistoryEnd}T23:59:59`) : null;

      if (start && created < start) return false;
      if (end && created > end) return false;
      return true;
    });
  }, [transferHistory, transferHistoryStart, transferHistoryEnd]);

  const filteredInboundHistory = useMemo(() => {
    return inboundHistory.filter((item) => {
      if (inboundSourceFilter !== 'all' && item.source !== inboundSourceFilter) return false;

      if (!item?.time) return !inboundHistoryStart && !inboundHistoryEnd;
      const created = new Date(item.time);
      if (Number.isNaN(created.getTime())) return false;

      const start = inboundHistoryStart ? new Date(`${inboundHistoryStart}T00:00:00`) : null;
      const end = inboundHistoryEnd ? new Date(`${inboundHistoryEnd}T23:59:59`) : null;

      if (start && created < start) return false;
      if (end && created > end) return false;
      return true;
    });
  }, [inboundHistory, inboundSourceFilter, inboundHistoryStart, inboundHistoryEnd]);

  const getInboundSourceLabel = (source: string) => {
    if (source === 'transfer_in') return '调货调入';
    if (source === 'batch_restock') return '批量补库存';
    if (source === 'excel_import') return 'Excel导入';
    if (source === 'manual_add') return '手动入库';
    return source || '-';
  };

  const handleClearFilters = () => {
    setInboundStart('');
    setInboundEnd('');
    setCategoryFilter('all');
    setDwellFilter('all');
    setStockStatusFilter('all');
  };

  const handleExportNegativeStock = () => {
    const negativeProducts = products.filter((p: any) => Number(p.stock) < 0);
    if (negativeProducts.length === 0) {
      alert('当前没有负库存商品');
      return;
    }

    const rows = negativeProducts.map((item: any) => ({
      商品名称: item.name,
      分类: getCategoryName(item.category_id),
      当前库存: item.stock,
      成本价: item.cost_price ?? '',
      入库时间: formatInboundDate(item.time),
      滞留时间: formatDwellDays(item.time)
    }));

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, '负库存清单');
    const now = new Date();
    const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
    XLSX.writeFile(wb, `负库存清单_${stamp}.xlsx`);
  };

  const isTimeOnly = (value: string) => /^\d{2}:\d{2}(:\d{2})?$/.test(value);

  const getInboundDate = (value?: string) => {
    if (!value || isTimeOnly(value)) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date;
  };

  const getDwellDays = (value?: string) => {
    const date = getInboundDate(value);
    if (!date) return null;
    const diffMs = Date.now() - date.getTime();
    if (diffMs <= 0) return 0;
    return Math.floor(diffMs / (24 * 60 * 60 * 1000));
  };

  const formatInboundDate = (value?: string) => {
    const date = getInboundDate(value);
    if (!date) return '-';
    return date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
  };

  const formatDwellDays = (value?: string) => {
    const days = getDwellDays(value);
    if (days === null) return '-';
    return `${days}天`;
  };

  const formatCostPrice = (value?: number) => {
    if (value === null || value === undefined || Number.isNaN(Number(value))) return '-';
    return Number(value).toFixed(2);
  };

  const getCategoryName = (categoryId?: string) => {
    if (!categoryId) return '未分类';
    return categories.find(c => c.id === categoryId)?.name || '未分类';
  };

  // 搜索过滤
  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      const matchesSearch = (p.name || '').toLowerCase().includes(searchTerm.toLowerCase());

      const productCategoryId = (p.category_id ?? '').toString().trim();
      const selectedCategory = categoryFilter.toString().trim();
      const matchesCategory = (() => {
        if (selectedCategory === 'all') return true;
        if (selectedCategory === 'uncategorized') return !productCategoryId;
        return productCategoryId === selectedCategory;
      })();

      const inboundDate = getInboundDate(p.time);
      const dwellDays = getDwellDays(p.time);

      const matchesTime = (() => {
        if (!inboundStart && !inboundEnd) return true;
        if (!inboundDate) return false;
        const start = inboundStart ? new Date(`${inboundStart}T00:00:00`) : null;
        const end = inboundEnd ? new Date(`${inboundEnd}T23:59:59`) : null;
        if (start && inboundDate < start) return false;
        if (end && inboundDate > end) return false;
        return true;
      })();

      const matchesDwell = (() => {
        if (dwellFilter === 'all') return true;
        if (dwellDays === null) return false;
        if (dwellFilter === '0-7') return dwellDays <= 7;
        if (dwellFilter === '8-30') return dwellDays >= 8 && dwellDays <= 30;
        return dwellDays > 30;
      })();

      const matchesStockStatus = (() => {
        if (stockStatusFilter === 'all') return true;
        return Number(p.stock) < 0;
      })();

      return matchesSearch && matchesCategory && matchesTime && matchesDwell && matchesStockStatus;
    });
  }, [products, searchTerm, categoryFilter, inboundStart, inboundEnd, dwellFilter, stockStatusFilter]);

  // 行内编辑逻辑
  const startEditing = (p: any) => {
    setEditingId(p.id);
    setEditFormData({ ...p, category_id: p.category_id || '' });
  };

  const handleSaveEdit = async () => {
    if (!editingId || !updateProduct) return;
    const payload = {
      ...editFormData,
      stock: Number.isFinite(Number(editFormData?.stock)) ? Number(editFormData.stock) : 0,
      category_id: editFormData?.category_id || undefined
    };
    const success = await updateProduct(editingId, payload);
    if (success) {
      setEditingId(null);
      setEditFormData(null);
    }
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditFormData(null);
  };

  const handleAddProduct = async () => {
    if (!addProduct || !updateProduct) return;
    const name = addFormData.name.trim();
    if (!name) return;
    const normalize = (value: string) => value.trim().toLowerCase();
    const costPrice = Number(addFormData.cost_price) || 0;
    const hasCostPrice = addFormData.cost_price.toString().trim() !== '';
    const stock = Number(addFormData.stock) || 0;
    let category_id = addFormData.category_id || undefined;

    // 未手动选择分类时，自动归入“未分类”
    if (!category_id && storeId) {
      const defaultCategoryName = '未分类';

      const existingCategory = categories.find(c => normalize(c.name) === normalize(defaultCategoryName));
      if (existingCategory) {
        category_id = existingCategory.id;
      } else {
        const { data: newCategory, error: createCategoryError } = await supabase
          .from('categories')
          .insert([{ name: defaultCategoryName, store_id: storeId }])
          .select('id,name')
          .single();

        if (!createCategoryError && newCategory) {
          category_id = newCategory.id;
        } else if ((createCategoryError as any)?.code === '23505' || (createCategoryError as any)?.status === 409) {
          const { data: duplicatedCategory } = await supabase
            .from('categories')
            .select('id,name')
            .eq('store_id', storeId)
            .ilike('name', defaultCategoryName)
            .is('deleted_at', null)
            .limit(1);

          if (duplicatedCategory && duplicatedCategory[0]) {
            category_id = duplicatedCategory[0].id;
          }
        }
      }
    }

    const existingProduct = products.find((p: any) => normalize(p.name || '') === normalize(name));
    if (existingProduct) {
      const updates: any = {
        stock: (Number(existingProduct.stock) || 0) + stock
      };

      if (hasCostPrice) {
        updates.cost_price = costPrice;
        updates.price = costPrice;
      }
      if (category_id) {
        updates.category_id = category_id;
      }

      const ok = await updateProduct(existingProduct.id, updates);
      if (ok) {
        appendInboundLogs([
          {
            storeId,
            source: 'manual_add',
            productName: name,
            qty: stock,
            note: '库存中心新增商品（合并到现有商品）'
          }
        ]);
        setAddFormData({ name: '', cost_price: '', stock: '', category_id: '' });
        setIsAddOpen(false);
      }
      return;
    }

    const { error } = await addProduct({
      name,
      price: costPrice,
      cost_price: costPrice,
      stock,
      category_id
    });

    if (!error) {
      appendInboundLogs([
        {
          storeId,
          source: 'manual_add',
          productName: name,
          qty: stock,
          note: '库存中心新增商品'
        }
      ]);
      setAddFormData({ name: '', cost_price: '', stock: '', category_id: '' });
      setIsAddOpen(false);
    }
  };

  const handleOpenTransfer = () => {
    setTransferForm({ productId: '', targetStoreId: '', quantity: '1' });
    setTransferMode('manual');
    setManualProductName('');
    setTransferImageError(null);
    setTransferImageRows([]);
    setIsTransferOpen(true);
  };

  const resolveProductIdByModel = (model: string) => {
    const text = String(model || '').trim();
    if (!text) return { productId: '', score: 0 };
    const ranked = products
      .map((p: any) => ({ id: p.id, score: scoreModelSimilarity(text, String(p.name || '')) }))
      .sort((a, b) => b.score - a.score);
    const best = ranked[0];
    if (!best || best.score < 0.7) return { productId: '', score: best?.score || 0 };
    return { productId: best.id, score: best.score };
  };

  const handleTransferImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setTransferImageLoading(true);
    setTransferImageError(null);
    setTransferImageRows([]);
    try {
      const dataUrl = await toJpegDataUrlIfNeeded(file);
      const payloadDataUrl = await compressImageDataUrl(dataUrl, 'image/jpeg', { maxWidth: 1400, jpegQuality: 0.82 });

      const response = await fetch('/api/analyze-stock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          base64Data: payloadDataUrl,
          mimeType: payloadDataUrl.startsWith('data:image/png') ? 'image/png' : 'image/jpeg'
        })
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload) {
        throw new Error(payload?.error || `HTTP ${response.status}`);
      }

      const items = Array.isArray(payload.items) ? payload.items : [];
      const parsedRows = items
        .map((item: any) => ({
          model: String(item?.model || '').trim(),
          quantity: Number(item?.quantity || 0)
        }))
        .filter((item: any) => item.model && Number.isFinite(item.quantity) && item.quantity > 0)
        .map((item: any) => {
          const matched = resolveProductIdByModel(item.model);
          return {
            ...item,
            matchedProductId: matched.productId,
            score: matched.score
          };
        });

      if (!parsedRows.length) {
        setTransferImageError('未识别到可用于调货的商品与数量');
      }
      setTransferImageRows(parsedRows);
    } catch (error: any) {
      const msg = String(error?.message || error || '识别失败');
      setTransferImageError(msg);
    } finally {
      setTransferImageLoading(false);
      if (e.target) e.target.value = '';
    }
  };

  const handleTransferSubmit = async () => {
    if (!transferStock) return;

    if (!transferForm.targetStoreId) {
      alert('请选择目标门店');
      return;
    }

    if (transferMode === 'manual') {
      const quantity = Number(transferForm.quantity);
      const fallback = resolveProductIdByModel(manualProductName);
      const productId = transferForm.productId || fallback.productId;

      if (!productId) {
        alert('请选择商品或手动输入可匹配的商品名称');
        return;
      }
      if (!Number.isFinite(quantity) || quantity <= 0) {
        alert('调货数量必须大于 0');
        return;
      }

      setTransferSubmitting(true);
      const result = await transferStock(productId, transferForm.targetStoreId, quantity);
      setTransferSubmitting(false);

      if (!result?.success) {
        alert(result?.message || '调货失败，请稍后重试');
        return;
      }

      alert(result?.message || '调货成功，已完成库存加减');
      setIsTransferOpen(false);
      await fetchData?.();
      return;
    }

    if (!transferImageRows.length) {
      alert('请先上传并识别调货图片');
      return;
    }

    const executableRows = transferImageRows.filter((row) => row.matchedProductId && Number(row.quantity) > 0);
    if (!executableRows.length) {
      alert('识别结果暂无可执行项，请先匹配商品');
      return;
    }

    setTransferSubmitting(true);
    let successCount = 0;
    const failMessages: string[] = [];

    for (const row of executableRows) {
      const result = await transferStock(row.matchedProductId, transferForm.targetStoreId, row.quantity);
      if (result?.success) {
        successCount++;
      } else {
        failMessages.push(`${row.model}: ${result?.message || '失败'}`);
      }
    }
    setTransferSubmitting(false);

    await fetchData?.();
    if (failMessages.length === 0) {
      alert(`图片调货完成，共成功 ${successCount} 条`);
      setIsTransferOpen(false);
      return;
    }

    alert(`已成功 ${successCount} 条，失败 ${failMessages.length} 条\n${failMessages.slice(0, 3).join('\n')}`);
  };

  const exportTransferImageRows = () => {
    if (!transferImageRows.length) {
      alert('当前没有可导出的识别结果');
      return;
    }

    const targetStoreName = transferStores.find(item => item.id === transferForm.targetStoreId)?.name || '';
    const rows = transferImageRows.map((row) => {
      const matchedProduct = products.find((p: any) => p.id === row.matchedProductId);
      return {
        目标门店: targetStoreName || transferForm.targetStoreId || '未选择',
        识别型号: row.model,
        数量: row.quantity,
        匹配商品: matchedProduct?.name || '',
        匹配度: `${(row.score * 100).toFixed(1)}%`,
        状态: row.matchedProductId ? '可执行' : '待匹配'
      };
    });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(wb, ws, '调货识别结果');

    const now = new Date();
    const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
    XLSX.writeFile(wb, `调货识别结果_${stamp}.xlsx`);
  };

  const deletedTotalPages = Math.max(1, Math.ceil(deletedProducts.length / DELETED_PAGE_SIZE));
  const safeDeletedPage = Math.min(deletedPage, deletedTotalPages);
  const pagedDeletedProducts = deletedProducts.slice(
    (safeDeletedPage - 1) * DELETED_PAGE_SIZE,
    safeDeletedPage * DELETED_PAGE_SIZE
  );

  // 如果正在加载且没数据，显示占位符防止白屏
  if (loading && products.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-20 text-slate-400">
        <div className="animate-spin rounded-full h-10 w-10 border-4 border-emerald-500 border-t-transparent mb-4"></div>
        <p>正在同步云端库存...</p>
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-in fade-in duration-500">
      {/* 顶部工具栏 */}
      <div className="bg-white p-4 md:p-6 rounded-2xl shadow-sm border border-slate-100 space-y-4">
        <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
          <div className="p-3 bg-emerald-500 text-white rounded-2xl shadow-lg shadow-emerald-200">
            <Layers className="w-6 h-6" />
          </div>
          <div className="min-w-0">
            <h2 className="text-2xl font-black text-slate-900 tracking-tight">库存中心</h2>
            <p className="text-slate-500 text-sm">当前共管理 {products.length} 项商品</p>
          </div>
        </div>

          <div className="w-full xl:w-auto">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-3">
            <button
              onClick={async () => {
                setDeletedPage(1);
                setShowDeleted(true);
                await loadDeletedProducts();
              }}
              className="w-full h-11 px-4 bg-slate-900 text-white hover:bg-slate-800 rounded-xl font-bold transition-all inline-flex items-center justify-center gap-2 border border-slate-900 shadow-sm text-sm"
            >
              查看删除记录
            </button>

            <button
              onClick={() => setIsScanOpen(true)}
              className="w-full h-11 px-4 bg-indigo-50 text-indigo-600 hover:bg-indigo-100 rounded-xl font-bold transition-all inline-flex items-center justify-center gap-2 border border-indigo-100 shadow-sm text-sm"
            >
              <ScanLine className="w-5 h-5" /> AI 小票扫描
            </button>

            <button
              onClick={async () => {
                setTransferHistoryStart('');
                setTransferHistoryEnd('');
                setShowTransferHistory(true);
                await loadTransferHistory();
              }}
              className="w-full h-11 px-4 bg-sky-50 text-sky-700 hover:bg-sky-100 rounded-xl font-bold transition-all inline-flex items-center justify-center gap-2 border border-sky-100 shadow-sm text-sm"
            >
              <ArrowRightLeft className="w-5 h-5" /> 调货记录
            </button>

            <button
              onClick={async () => {
                setInboundHistoryStart('');
                setInboundHistoryEnd('');
                setInboundSourceFilter('all');
                setShowInboundHistory(true);
                await loadInboundHistory();
              }}
              className="w-full h-11 px-4 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded-xl font-bold transition-all inline-flex items-center justify-center gap-2 border border-emerald-100 shadow-sm text-sm"
            >
              <History className="w-5 h-5" /> 入库记录
            </button>

            <button
              onClick={() => setIsAddOpen(true)}
              className="w-full h-11 px-4 bg-slate-900 text-white hover:bg-slate-800 rounded-xl font-bold transition-all inline-flex items-center justify-center gap-2 border border-slate-900 shadow-sm text-sm"
            >
              <Plus className="w-5 h-5" /> 新增商品
            </button>

            <button
              onClick={handleOpenTransfer}
              className="w-full h-11 px-4 bg-amber-50 text-amber-700 hover:bg-amber-100 rounded-xl font-bold transition-all inline-flex items-center justify-center gap-2 border border-amber-100 shadow-sm text-sm"
            >
              <ArrowRightLeft className="w-5 h-5" /> 店铺调货
            </button>

            <ExcelImporter store={store} />
            <StockBatchImporter store={store} storeId={storeId} />
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-100 bg-slate-50/60 p-3 md:p-4">
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-12 gap-3">
          <div className="relative md:col-span-2 xl:col-span-3">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input 
              type="text"
              placeholder="搜索商品..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full h-11 pl-10 pr-4 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-emerald-500 text-sm transition-all"
            />
          </div>

          <div className="flex items-center gap-2 min-w-0 md:col-span-2 xl:col-span-3">
            <input
              type="date"
              value={inboundStart}
              onChange={(e) => setInboundStart(e.target.value)}
              className="h-11 flex-1 min-w-0 px-3 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-500"
            />
            <span className="text-xs text-slate-400">-</span>
            <input
              type="date"
              value={inboundEnd}
              onChange={(e) => setInboundEnd(e.target.value)}
              className="h-11 flex-1 min-w-0 px-3 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="w-full h-11 px-3 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-500 xl:col-span-2"
          >
            <option value="all">产品类型：全部</option>
            <option value="uncategorized">产品类型：未分类</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>

          <select
            value={dwellFilter}
            onChange={(e) => setDwellFilter(e.target.value as typeof dwellFilter)}
            className="w-full h-11 px-3 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-500 xl:col-span-2"
          >
            <option value="all">滞留天数：全部</option>
            <option value="0-7">0-7 天</option>
            <option value="8-30">8-30 天</option>
            <option value="30+">30 天以上</option>
          </select>

          <button
            onClick={handleClearFilters}
            className="w-full h-11 px-3 bg-slate-100 text-slate-600 hover:bg-slate-200 rounded-xl font-bold transition-all inline-flex items-center justify-center gap-2 border border-slate-200 shadow-sm text-sm xl:col-span-2"
          >
            清空筛选
          </button>

          <select
            value={stockStatusFilter}
            onChange={(e) => setStockStatusFilter(e.target.value as 'all' | 'negative')}
            className="w-full h-11 px-3 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-emerald-500 xl:col-span-2"
          >
            <option value="all">库存状态：全部</option>
            <option value="negative">库存状态：负库存</option>
          </select>

          <button
            onClick={handleExportNegativeStock}
            className="w-full h-11 px-3 bg-rose-50 text-rose-600 hover:bg-rose-100 rounded-xl font-bold transition-all inline-flex items-center justify-center gap-2 border border-rose-100 shadow-sm text-sm xl:col-span-2"
          >
            导出负库存
          </button>
          </div>
        </div>
      </div>

      {/* 移动端卡片 */}
      <div className="md:hidden space-y-3">
        {filteredProducts.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-100 p-8 text-center">
            <div className="flex flex-col items-center gap-2 text-slate-400">
              <AlertTriangle className="w-5 h-5" />
              <p className="text-sm">未找到符合条件的商品</p>
              <p className="text-xs text-slate-400">可以调整筛选条件或清空筛选后重试</p>
            </div>
          </div>
        ) : (
          filteredProducts.map(product => (
            <div key={product.id} className={`rounded-2xl p-4 space-y-3 shadow-sm border ${Number(product.stock) < 0 ? 'bg-rose-50/40 border-rose-200' : 'bg-white border-slate-100'}`}>
              <div className="flex items-start justify-between gap-3">
                {editingId === product.id ? (
                  <div className="flex-1 space-y-2">
                    <input
                      className="border border-slate-200 rounded-lg px-2 py-1 w-full text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                      value={editFormData.name}
                      onChange={e => setEditFormData({ ...editFormData, name: e.target.value })}
                    />
                    <select
                      value={editFormData.category_id || ''}
                      onChange={e => setEditFormData({ ...editFormData, category_id: e.target.value })}
                      className="border border-slate-200 rounded-lg px-2 py-1 w-full text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                    >
                      <option value="">未分类</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <>
                    <div className="min-w-0">
                      <p className="font-bold text-slate-800 truncate">{product.name}</p>
                      <p className="text-xs text-slate-500 mt-1">分类：{getCategoryName(product.category_id)}</p>
                    </div>
                  </>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="bg-slate-50 rounded-lg p-2 text-center">
                  <p className="text-[11px] text-slate-500">库存</p>
                  {editingId === product.id ? (
                    <input
                      type="number"
                      value={editFormData.stock ?? ''}
                      onChange={(e) => setEditFormData({ ...editFormData, stock: e.target.value })}
                      className="mt-1 w-full px-2 py-1 border border-slate-200 rounded-lg text-center font-mono font-bold text-slate-700"
                    />
                  ) : (
                    <p className={`font-mono font-bold mt-1 ${Number(product.stock) < 0 ? 'text-rose-600' : 'text-slate-700'}`}>{product.stock}</p>
                  )}
                </div>
                <div className="bg-slate-50 rounded-lg p-2 text-center">
                  <p className="text-[11px] text-slate-500">成本价</p>
                  <p className="font-mono font-bold text-slate-700 mt-1">{formatCostPrice(product.cost_price)}</p>
                </div>
                <div className="bg-slate-50 rounded-lg p-2 text-center">
                  <p className="text-[11px] text-slate-500">入库时间</p>
                  <p className="text-slate-700 mt-1">{formatInboundDate(product.time)}</p>
                </div>
                <div className="bg-slate-50 rounded-lg p-2 text-center">
                  <p className="text-[11px] text-slate-500">滞留时间</p>
                  <p className="font-mono text-slate-700 mt-1">{formatDwellDays(product.time)}</p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {editingId === product.id ? (
                  <>
                    <button
                      onClick={handleSaveEdit}
                      className="flex-1 px-3 py-2 bg-emerald-500 text-white rounded-lg font-bold text-xs"
                    >
                      保存
                    </button>
                    <button
                      onClick={handleCancelEdit}
                      className="flex-1 px-3 py-2 bg-slate-100 text-slate-700 rounded-lg font-bold text-xs"
                    >
                      取消
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={() => startEditing(product)}
                      className="flex-1 px-3 py-2 bg-slate-900 text-white rounded-lg font-bold text-xs"
                    >
                      编辑
                    </button>
                    <button
                      onClick={() => {
                        if (!deleteProduct) return;
                        if (window.confirm(`确定要删除商品 "${product.name}" 吗？此操作不可恢复。`)) {
                          deleteProduct(product.id);
                        }
                      }}
                      className="px-3 py-2 text-rose-600 bg-rose-50 rounded-lg"
                      title="删除商品"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      {/* 桌面端表格 */}
      <div className="hidden md:block bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left text-sm table-fixed">
            <thead>
              <tr className="bg-slate-50 text-slate-500 font-bold border-b border-slate-100">
                <th className="px-6 py-4 w-[240px]">商品名称</th>
                <th className="px-6 py-4 w-[160px]">分类</th>
                <th className="px-6 py-4 w-[110px] text-center">库存</th>
                <th className="px-6 py-4 w-[130px] text-center">成本价</th>
                <th className="px-6 py-4 w-[140px] text-center">入库时间</th>
                <th className="px-6 py-4 w-[120px] text-center">滞留时间</th>
                <th className="px-6 py-4 w-[160px] text-center">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filteredProducts.map(product => (
                <tr key={product.id} className={`transition-colors group ${Number(product.stock) < 0 ? 'bg-rose-50/30 hover:bg-rose-50/60' : 'hover:bg-slate-50/50'}`}>
                  <td className="px-6 py-4">
                    {editingId === product.id ? (
                      <div className="flex items-center gap-2">
                        <input 
                          className="border border-slate-200 rounded-lg px-2 py-1 w-full text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                          value={editFormData.name}
                          onChange={e => setEditFormData({ ...editFormData, name: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveEdit();
                            if (e.key === 'Escape') handleCancelEdit();
                          }}
                        />
                        <button
                          onClick={handleSaveEdit}
                          className="p-2 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition-all"
                          title="保存"
                        >
                          <Check className="w-4 h-4" />
                        </button>
                        <button
                          onClick={handleCancelEdit}
                          className="p-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-all"
                          title="取消"
                        >
                          <RotateCcw className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <span className="font-bold text-slate-700 truncate block max-w-[180px]" title={product.name}>{product.name}</span>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    {editingId === product.id ? (
                      <select
                        value={editFormData.category_id || ''}
                        onChange={(e) => setEditFormData({ ...editFormData, category_id: e.target.value })}
                        className="w-full px-2 py-1 border border-slate-200 rounded-lg text-xs outline-none focus:ring-2 focus:ring-emerald-500"
                      >
                        <option value="">未分类</option>
                        {categories.map((c) => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-slate-500 whitespace-nowrap truncate block max-w-[120px]" title={getCategoryName(product.category_id)}>
                        {getCategoryName(product.category_id)}
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-center">
                    {editingId === product.id ? (
                      <div className="flex justify-center">
                        <input
                          type="number"
                          value={editFormData.stock ?? ''}
                          onChange={(e) => setEditFormData({ ...editFormData, stock: e.target.value })}
                          className="w-24 px-2 py-1 border border-slate-200 rounded-lg text-sm text-center focus:ring-2 focus:ring-emerald-500 outline-none"
                        />
                      </div>
                    ) : (
                      <span className={`font-mono font-bold ${Number(product.stock) < 0 ? 'text-rose-600' : 'text-slate-700'}`}>{product.stock}</span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-center">
                    <span className="font-mono font-bold text-slate-700 inline-block">
                      {formatCostPrice(product.cost_price)}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-center">
                    <span className="text-slate-500 whitespace-nowrap inline-block">
                      {formatInboundDate(product.time)}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-center">
                    <span className="text-slate-500 whitespace-nowrap inline-block">
                      {formatDwellDays(product.time)}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-center">
                    {editingId === product.id ? (
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={handleSaveEdit}
                          className="px-3 py-1.5 bg-emerald-500 text-white rounded-lg font-bold text-xs hover:bg-emerald-600 transition-all border border-emerald-500 shadow-sm"
                        >
                          保存
                        </button>
                        <button
                          onClick={handleCancelEdit}
                          className="px-3 py-1.5 bg-slate-100 text-slate-700 rounded-lg font-bold text-xs hover:bg-slate-200 transition-all border border-slate-200 shadow-sm"
                        >
                          取消
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center justify-center gap-2 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => startEditing(product)}
                          className="px-3 py-1.5 bg-slate-900 text-white rounded-lg font-bold text-xs hover:bg-slate-800 transition-all border border-slate-900 shadow-sm"
                        >
                          编辑
                        </button>
                        <button
                          onClick={() => {
                            if (!deleteProduct) return;
                            if (window.confirm(`确定要删除商品 "${product.name}" 吗？此操作不可恢复。`)) {
                              deleteProduct(product.id);
                            }
                          }}
                          className="p-2 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-all"
                          title="删除商品"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}

              {filteredProducts.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center">
                    <div className="flex flex-col items-center gap-2 text-slate-400">
                      <AlertTriangle className="w-5 h-5" />
                      <p className="text-sm">未找到符合条件的商品</p>
                      <p className="text-xs text-slate-400">可以调整筛选条件或清空筛选后重试</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* 新增商品 Modal */}
      {isAddOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto border border-slate-100 animate-in fade-in zoom-in-95 duration-200">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900">新增商品</h3>
              <button
                onClick={() => setIsAddOpen(false)}
                className="p-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-all"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 md:p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">商品名称</label>
                <input
                  value={addFormData.name}
                  onChange={(e) => setAddFormData({ ...addFormData, name: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                  placeholder="例如：A4 复印纸"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">成本价</label>
                  <input
                    type="number"
                    value={addFormData.cost_price}
                    onChange={(e) => setAddFormData({ ...addFormData, cost_price: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                    placeholder="0"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">库存数量</label>
                  <input
                    type="number"
                    value={addFormData.stock}
                    onChange={(e) => setAddFormData({ ...addFormData, stock: e.target.value })}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                    placeholder="0"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">商品分类</label>
                <select
                  value={addFormData.category_id}
                  onChange={(e) => setAddFormData({ ...addFormData, category_id: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                >
                  <option value="">未分类</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="p-4 md:p-6 pt-0 flex items-center justify-end gap-3">
              <button
                onClick={() => setIsAddOpen(false)}
                className="px-4 py-2 bg-slate-100 text-slate-700 rounded-xl font-bold text-sm hover:bg-slate-200 transition-all"
              >
                取消
              </button>
              <button
                onClick={handleAddProduct}
                className="px-4 py-2 bg-emerald-500 text-white rounded-xl font-bold text-sm hover:bg-emerald-600 transition-all"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 店铺调货 Modal */}
      {isTransferOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-[100] flex items-end sm:items-center justify-center sm:p-4">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-lg max-h-[90vh] overflow-y-auto border border-slate-100 animate-in fade-in zoom-in-95 duration-200">
            <div className="p-4 sm:p-6 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-base sm:text-lg font-bold text-slate-900">店铺间调货</h3>
              <button
                onClick={() => setIsTransferOpen(false)}
                className="p-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-all"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 sm:p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">调入门店</label>
                <select
                  value={transferForm.targetStoreId}
                  onChange={(e) => setTransferForm(prev => ({ ...prev, targetStoreId: e.target.value }))}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                >
                  <option value="">请选择门店</option>
                  {transferStores.map((item) => (
                    <option key={item.id} value={item.id}>{item.name}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2 bg-slate-100 p-1 rounded-xl">
                <button
                  onClick={() => setTransferMode('manual')}
                  className={`px-3 py-2 text-sm rounded-lg font-bold transition-all ${transferMode === 'manual' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
                >
                  手动输入
                </button>
                <button
                  onClick={() => setTransferMode('image')}
                  className={`px-3 py-2 text-sm rounded-lg font-bold transition-all ${transferMode === 'image' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
                >
                  识别图片
                </button>
              </div>

              {transferMode === 'manual' ? (
                <>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">调出商品（可选择）</label>
                    <select
                      value={transferForm.productId}
                      onChange={(e) => setTransferForm(prev => ({ ...prev, productId: e.target.value }))}
                      className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                    >
                      <option value="">请选择商品</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}（库存: {p.stock}）</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">或手动输入商品名</label>
                    <input
                      type="text"
                      value={manualProductName}
                      onChange={(e) => setManualProductName(e.target.value)}
                      placeholder="例如：M-2504"
                      className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">调货数量</label>
                    <input
                      type="number"
                      min="1"
                      value={transferForm.quantity}
                      onChange={(e) => setTransferForm(prev => ({ ...prev, quantity: e.target.value }))}
                      className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                      placeholder="请输入数量"
                    />
                  </div>
                </>
              ) : (
                <>
                  <input
                    ref={transferImageInputRef}
                    type="file"
                    accept="image/*,.heic,.heif"
                    onChange={handleTransferImageUpload}
                    className="hidden"
                  />
                  <button
                    onClick={() => transferImageInputRef.current?.click()}
                    disabled={transferImageLoading}
                    className="w-full px-4 py-3 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 rounded-xl font-bold transition-all border border-indigo-100 shadow-sm text-sm flex items-center justify-center gap-2 disabled:opacity-60"
                  >
                    {transferImageLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImageUp className="w-4 h-4" />}
                    {transferImageLoading ? '识别中...' : '上传图片识别商品与数量'}
                  </button>

                  {transferImageRows.length > 0 && (
                    <button
                      onClick={exportTransferImageRows}
                      className="w-full px-4 py-2.5 bg-slate-100 text-slate-700 hover:bg-slate-200 rounded-xl font-bold transition-all border border-slate-200 shadow-sm text-sm"
                    >
                      导出识别结果
                    </button>
                  )}

                  {transferImageError && (
                    <div className="text-xs text-rose-600 bg-rose-50 border border-rose-100 rounded-lg p-2.5">
                      {transferImageError}
                    </div>
                  )}

                  {transferImageRows.length > 0 && (
                    <div className="space-y-2 max-h-[35vh] overflow-y-auto pr-1">
                      {transferImageRows.map((row, idx) => (
                        <div key={`${row.model}_${idx}`} className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2">
                          <div className="text-xs text-slate-500">识别型号：<span className="font-semibold text-slate-700">{row.model}</span></div>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="block text-[11px] text-slate-500 mb-1">数量</label>
                              <input
                                type="number"
                                min="1"
                                value={row.quantity}
                                onChange={(e) => {
                                  const qty = Number(e.target.value);
                                  setTransferImageRows(prev => prev.map((item, i) => i === idx ? { ...item, quantity: Number.isFinite(qty) && qty > 0 ? qty : 1 } : item));
                                }}
                                className="w-full px-2.5 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-500"
                              />
                            </div>
                            <div>
                              <label className="block text-[11px] text-slate-500 mb-1">匹配商品</label>
                              <select
                                value={row.matchedProductId}
                                onChange={(e) => setTransferImageRows(prev => prev.map((item, i) => i === idx ? { ...item, matchedProductId: e.target.value } : item))}
                                className="w-full px-2.5 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-500"
                              >
                                <option value="">请选择商品</option>
                                {products.map((p) => (
                                  <option key={p.id} value={p.id}>{p.name}（库存: {p.stock}）</option>
                                ))}
                              </select>
                            </div>
                          </div>
                          <div className="text-[11px] text-slate-400">匹配度：{(row.score * 100).toFixed(1)}%</div>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}

              <p className="text-xs text-slate-400">调货只会变更两家门店库存，不会计入销售额和热销商品。</p>
            </div>
            <div className="p-4 sm:p-6 pt-0 grid grid-cols-2 gap-3">
              <button
                onClick={() => setIsTransferOpen(false)}
                className="w-full px-4 py-2.5 bg-slate-100 text-slate-700 rounded-xl font-bold text-sm hover:bg-slate-200 transition-all"
              >
                取消
              </button>
              <button
                onClick={handleTransferSubmit}
                disabled={transferSubmitting}
                className="w-full px-4 py-2.5 bg-amber-500 text-white rounded-xl font-bold text-sm hover:bg-amber-600 disabled:bg-amber-300 transition-all"
              >
                {transferSubmitting ? '调货中...' : '确认调货'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI 扫描 Modal */}
      {isScanOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-[100] flex items-end sm:items-center justify-center sm:p-4">
          <div className="bg-slate-50 rounded-t-2xl sm:rounded-3xl md:rounded-[2.5rem] shadow-2xl w-full sm:max-w-5xl max-h-[92vh] overflow-hidden relative flex flex-col border border-white/20">
            <button 
              onClick={() => { setIsScanOpen(false); fetchData?.(); }}
              className="absolute top-3 right-3 sm:top-4 sm:right-4 md:top-6 md:right-6 p-2 bg-white text-slate-900 rounded-full shadow-lg z-[110] hover:scale-110 transition-transform"
            >
              <X className="w-5 h-5 sm:w-6 sm:h-6" />
            </button>
            <div className="p-2 sm:p-3 md:p-8 overflow-y-auto custom-scrollbar">
               <ReceiptScanner store={store} />
            </div>
          </div>
        </div>
      )}

      {/* 删除记录 Modal */}
      {showDeleted && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-[110] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl overflow-hidden border border-slate-100">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900">删除记录 - 商品</h3>
              <button
                onClick={() => setShowDeleted(false)}
                className="p-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-all"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-6">
              {deletedLoading ? (
                <div className="text-slate-400 text-sm">加载中...</div>
              ) : deletedProducts.length === 0 ? (
                <div className="text-slate-400 text-sm">暂无删除记录</div>
              ) : (
                <div className="space-y-4">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
                          <th className="px-6 py-3">商品名称</th>
                          <th className="px-6 py-3">删除时间</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {pagedDeletedProducts.map((item) => (
                          <tr key={item.id}>
                            <td className="px-6 py-3 font-medium text-slate-700">{item.name}</td>
                            <td className="px-6 py-3 text-slate-500">
                              {formatZhDateTime(item.deleted_at)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-500">
                      第 {safeDeletedPage} / {deletedTotalPages} 页 · 共 {deletedProducts.length} 条
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setDeletedPage(prev => Math.max(1, prev - 1))}
                        disabled={safeDeletedPage <= 1}
                        className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 disabled:text-slate-300 disabled:bg-slate-50 disabled:cursor-not-allowed hover:bg-slate-50 transition-all"
                      >
                        上一页
                      </button>
                      <button
                        onClick={() => setDeletedPage(prev => Math.min(deletedTotalPages, prev + 1))}
                        disabled={safeDeletedPage >= deletedTotalPages}
                        className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 disabled:text-slate-300 disabled:bg-slate-50 disabled:cursor-not-allowed hover:bg-slate-50 transition-all"
                      >
                        下一页
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 调货记录 Modal */}
      {showInboundHistory && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-[110] flex items-end sm:items-center justify-center sm:p-4">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-5xl max-h-[90vh] overflow-hidden border border-slate-100 flex flex-col">
            <div className="p-4 sm:p-6 border-b border-slate-100 flex items-center justify-between shrink-0">
              <h3 className="text-base sm:text-lg font-bold text-slate-900">入库记录（当前门店）</h3>
              <button
                onClick={() => setShowInboundHistory(false)}
                className="p-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-all"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 sm:p-6 overflow-y-auto flex-1">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 mb-4">
                <div>
                  <label className="block text-[11px] text-slate-500 mb-1">开始日期</label>
                  <input
                    type="date"
                    value={inboundHistoryStart}
                    onChange={(e) => setInboundHistoryStart(e.target.value)}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-500 mb-1">结束日期</label>
                  <input
                    type="date"
                    value={inboundHistoryEnd}
                    onChange={(e) => setInboundHistoryEnd(e.target.value)}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                <div className="sm:col-span-2 lg:col-span-1">
                  <label className="block text-[11px] text-slate-500 mb-1">来源</label>
                  <select
                    value={inboundSourceFilter}
                    onChange={(e) => setInboundSourceFilter(e.target.value as typeof inboundSourceFilter)}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="all">全部来源</option>
                    <option value="transfer_in">调货调入</option>
                    <option value="batch_restock">批量补库存</option>
                    <option value="excel_import">Excel导入</option>
                    <option value="manual_add">手动入库</option>
                  </select>
                </div>
                <div className="sm:col-span-2 lg:col-span-1">
                  <label className="block text-[11px] text-transparent mb-1">操作</label>
                  <button
                    onClick={async () => {
                      await loadInboundHistory();
                    }}
                    className="w-full px-3 py-2.5 bg-slate-100 text-slate-700 hover:bg-slate-200 rounded-lg text-sm font-semibold transition-all"
                  >
                    刷新记录
                  </button>
                </div>
              </div>

              {inboundHistoryLoading ? (
                <div className="text-slate-400 text-sm">加载中...</div>
              ) : inboundHistoryError ? (
                <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-rose-600 text-sm">{inboundHistoryError}</div>
              ) : filteredInboundHistory.length === 0 ? (
                <div className="text-slate-400 text-sm">暂无入库记录</div>
              ) : (
                <>
                  <div className="sm:hidden space-y-2">
                    {filteredInboundHistory.map((item) => (
                      <div key={item.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs space-y-1.5">
                        <div className="font-semibold text-slate-800 break-words">{item.productName || '-'}</div>
                        <div className="text-slate-600">来源：{getInboundSourceLabel(item.source)}</div>
                        <div className="text-slate-600">数量：+{item.qty}</div>
                        <div className="text-slate-600">备注：{item.note || '-'}</div>
                        <div className="text-slate-500">{formatZhDateTime(item.time)}</div>
                      </div>
                    ))}
                  </div>

                  <div className="hidden sm:block overflow-x-auto">
                    <table className="w-full text-left text-sm">
                      <thead>
                        <tr className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
                          <th className="px-4 py-3">时间</th>
                          <th className="px-4 py-3">来源</th>
                          <th className="px-4 py-3">商品</th>
                          <th className="px-4 py-3">数量</th>
                          <th className="px-4 py-3">备注</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {filteredInboundHistory.map((item) => (
                          <tr key={item.id}>
                            <td className="px-4 py-3 text-slate-500">{formatZhDateTime(item.time)}</td>
                            <td className="px-4 py-3 text-slate-600">{getInboundSourceLabel(item.source)}</td>
                            <td className="px-4 py-3 font-medium text-slate-700">{item.productName || '-'}</td>
                            <td className="px-4 py-3 text-emerald-600 font-semibold">+{item.qty}</td>
                            <td className="px-4 py-3 text-slate-500">{item.note || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 调货记录 Modal */}
      {showTransferHistory && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-[110] flex items-end sm:items-center justify-center sm:p-4">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-4xl max-h-[90vh] overflow-hidden border border-slate-100 flex flex-col">
            <div className="p-4 sm:p-6 border-b border-slate-100 flex items-center justify-between shrink-0">
              <h3 className="text-base sm:text-lg font-bold text-slate-900">调货记录（当前门店）</h3>
              <button
                onClick={() => setShowTransferHistory(false)}
                className="p-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-all"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 sm:p-6 overflow-y-auto flex-1">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4">
                <div>
                  <label className="block text-[11px] text-slate-500 mb-1">开始日期</label>
                  <input
                    type="date"
                    value={transferHistoryStart}
                    onChange={(e) => setTransferHistoryStart(e.target.value)}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-500 mb-1">结束日期</label>
                  <input
                    type="date"
                    value={transferHistoryEnd}
                    onChange={(e) => setTransferHistoryEnd(e.target.value)}
                    className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </div>

              {transferHistoryLoading ? (
                <div className="text-slate-400 text-sm">加载中...</div>
              ) : transferHistoryError ? (
                <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-rose-600 text-sm">{transferHistoryError}</div>
              ) : filteredTransferHistory.length === 0 ? (
                <div className="text-slate-400 text-sm">暂无调货记录</div>
              ) : (
                <>
                  <div className="sm:hidden space-y-2">
                    {filteredTransferHistory.map((item) => (
                      <div key={item.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs space-y-1.5">
                        <div className="font-semibold text-slate-800 break-words">{item.product_name || '-'}</div>
                        <div className="text-slate-600">数量：{item.quantity}</div>
                        <div className="text-slate-600">调出：{storeNameMap[item.source_store_id] || item.source_store_id || '-'}</div>
                        <div className="text-slate-600">调入：{storeNameMap[item.target_store_id] || item.target_store_id || '-'}</div>
                        <div className="text-slate-500">{formatZhDateTime(item.created_at)}</div>
                      </div>
                    ))}
                  </div>

                <div className="hidden sm:block overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="bg-slate-50 text-slate-500 text-xs uppercase tracking-wider">
                        <th className="px-4 py-3">商品</th>
                        <th className="px-4 py-3">数量</th>
                        <th className="px-4 py-3">调出门店</th>
                        <th className="px-4 py-3">调入门店</th>
                        <th className="px-4 py-3">时间</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredTransferHistory.map((item) => (
                        <tr key={item.id}>
                          <td className="px-4 py-3 font-medium text-slate-700">{item.product_name || '-'}</td>
                          <td className="px-4 py-3 text-slate-600">{item.quantity}</td>
                          <td className="px-4 py-3 text-slate-600">{storeNameMap[item.source_store_id] || item.source_store_id || '-'}</td>
                          <td className="px-4 py-3 text-slate-600">{storeNameMap[item.target_store_id] || item.target_store_id || '-'}</td>
                          <td className="px-4 py-3 text-slate-500">{formatZhDateTime(item.created_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}