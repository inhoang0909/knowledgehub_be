import { Injectable } from '@nestjs/common';

/**
 * @class CategoryTreeService
 * @description Service chuyển đổi mảng phẳng Danh mục (Flat Array) thành Cây phân cấp 2 tầng / n tầng (Hierarchical Tree Structure).
 * 
 * Thuật toán sử dụng:
 * 1. Pass 1: Duyệt qua mảng phẳng, nạp vào HashMap (`Map<id, CategoryNode>`) với $O(1)$ lookup time, tính toán lại số đếm Dataset thực tế theo quyền của User.
 * 2. Pass 2: Duyệt qua mảng phẳng, kết nối node con (`children`) vào node cha dựa trên `parentId`. Tối ưu payload JSON bằng cách xóa các trường thừa (`parent`, `department`) ở node con.
 */
@Injectable()
export class CategoryTreeService {
  /**
   * Chuyển đổi danh sách Category dạng Mảng phẳng thành Cây thư mục Phân cấp
   * 
   * @param categories Mảng danh mục phẳng đã bao gồm mảng `datasets` phù hợp quyền User
   * @returns Danh sách các Root Category (Thư mục gốc) đã chứa cây `children` con cháu bên trong
   */
  buildTreeStructure(categories: any[]) {
    const categoryMap = new Map();
    const rootCategories: any[] = [];

    // -----------------------------------------------------------------
    // LẦN LẶP 1: Khởi tạo Map & Format Data ($O(N)$)
    // -----------------------------------------------------------------
    categories.forEach(cat => {
      // Bóc tách _count ra, giữ lại mảng 'datasets' đã được lọc quyền người dùng
      const { _count, ...rest } = cat;
      
      categoryMap.set(cat.id, { 
        ...rest, 
        hasChildren: _count?.subCategories > 0, // Cờ báo hiệu có thư mục con hay không
        datasetCount: cat.datasets?.length || 0, // Đếm số lượng dataset thực tế mà User có quyền truy cập
        children: [] 
      });
    });

    // -----------------------------------------------------------------
    // LẦN LẶP 2: Ghép Node con vào Node cha ($O(N)$)
    // -----------------------------------------------------------------
    categories.forEach(cat => {
      const currentCategory = categoryMap.get(cat.id);
      
      if (cat.parentId && categoryMap.has(cat.parentId)) {
        // Tối ưu Payload API: Xóa trường `parent` và `department` ở cấp con để giảm kích thước JSON response
        delete currentCategory.parent;
        delete currentCategory.department;
        
        categoryMap.get(cat.parentId).children.push(currentCategory);
      } else {
        rootCategories.push(currentCategory);
      }
    });

    return rootCategories;
  }
}