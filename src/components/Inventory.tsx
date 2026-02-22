import * as XLSX from 'xlsx'; // 确保顶部引入了库

const handleExcelImport = async (e) => {
  const file = e.target.files[0];
  const reader = new FileReader();

  reader.onload = async (evt) => {
    const data = evt.target.result;
    const workbook = XLSX.read(data, { type: 'binary' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet);

    // 遍历处理每一行数据
    for (const row of rows) {
      const { 商品名称, 类目, 销售价, 成本价, 库存数量 } = row;

      // 1. 先处理类目：查找是否存在，不存在则创建
      let categoryId = null;
      if (类目) {
        const { data: catData } = await supabase
          .from('categories')
          .select('id')
          .eq('name', 类目)
          .single();
        
        if (catData) {
          categoryId = catData.id;
        } else {
          const { data: newCat } = await supabase
            .from('categories')
            .insert({ name: 类目 })
            .select()
            .single();
          categoryId = newCat?.id;
        }
      }

      // 2. 智能更新商品：如果名称相同，则累加库存，更新价格
      const { data: existingProduct } = await supabase
        .from('products')
        .select('*')
        .eq('name', 商品名称)
        .single();

      if (existingProduct) {
        await supabase.from('products').update({
          price: 销售价 || existingProduct.price,
          cost_price: 成本价 || existingProduct.cost_price,
          stock: existingProduct.stock + (库存数量 || 0),
          category_id: categoryId
        }).eq('id', existingProduct.id);
      } else {
        await supabase.from('products').insert({
          name: 商品名称,
          price: 销售价,
          cost_price: 成本价,
          stock: 库存数量,
          category_id: categoryId
        });
      }
    }
    alert('批量导入完成！');
    fetchData(); // 刷新页面数据
  };
  reader.readAsBinaryString(file);
};