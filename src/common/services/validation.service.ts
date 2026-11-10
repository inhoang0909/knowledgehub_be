import {
  Injectable,
  ForbiddenException,
  BadRequestException,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "@/modules/prisma/prisma.service";
import { User, UserRole, DatasetRole } from "@prisma/client";

/**
 * Các loại hành động (Action) trên Dataset được phân quyền chi tiết:
 * - READ: Đọc dữ liệu Dataset/Document/Segment
 * - WRITE_SEGMENT: Thêm, sửa, xóa Segment/Chunk dữ liệu (Phân quyền cho Viewer trở lên)
 * - WRITE_DOCUMENT: Thêm, xóa File Document (Yêu cầu Editor trở lên)
 * - MANAGE: Quản lý thành viên, cấu hình phân quyền phòng ban (Yêu cầu Manager)
 * - DELETE_DATASET: Xóa toàn bộ Dataset (Yêu cầu Creator, Dept Manager hoặc Super Admin)
 */
export type DatasetAction = 
  | 'READ' 
  | 'WRITE_SEGMENT'   
  | 'WRITE_DOCUMENT'  
  | 'MANAGE'          
  | 'DELETE_DATASET'; 

/**
 * @class ValidationService
 * @description Engine phân quyền trung tâm (RBAC & ABAC Gatekeeper) và Kiểm tra Schema dữ liệu.
 * 
 * Chức năng chính:
 * 1. Tính toán Context & Vai trò của Người dùng đối với từng Dataset dựa trên:
 *    - System Role (SUPER_ADMIN, DEPT_MANAGER, MEMBER)
 *    - Dataset Home Department (Dataset thuộc sở hữu phòng ban nào)
 *    - Global Category Access (Dataset công khai thuộc bộ mục GLOBAL)
 *    - Explicit User Permission (Được mời trực tiếp)
 *    - Department Permission (Phòng ban được phân quyền)
 * 2. Phán quyết quyền truy cập (Gatekeeper) theo ma trận trọng số (ROLE_WEIGHT).
 * 3. Kiểm tra JSON Metadata Schema của Dataset trước khi lưu dữ liệu Segment/Document.
 */
@Injectable()
export class ValidationService {
  constructor(private prisma: PrismaService) {}
  private readonly logger = new Logger(ValidationService.name);

  /** Trọng số phân cấp vai trò trên Dataset (MANAGER = 3 > EDITOR = 2 > VIEWER = 1 > NULL = 0) */
  private readonly ROLE_WEIGHT = {
    [DatasetRole.MANAGER]: 3,
    [DatasetRole.EDITOR]: 2,
    [DatasetRole.VIEWER]: 1,
    'NULL': 0,
  };

  /**
   * Tính toán bối cảnh (Context) & Vai trò thực tế của User trên một Dataset cụ thể.
   * 
   * @param datasetId ID của Dataset cần kiểm tra
   * @param user Thông tin User đang thực hiện request
   * @returns Bối cảnh phân quyền `{ role, isCreator, isMyDeptDataset, isGlobal }`
   */
  async getDatasetContext(datasetId: number, user: User) {
    // [Cấp 1] SUPER_ADMIN có toàn quyền God Mode trên tất cả Dataset
    if (user.role === UserRole.SUPER_ADMIN) {
      return { role: DatasetRole.MANAGER, isCreator: true, isMyDeptDataset: true, isGlobal: false };
    }

    const dataset = await this.prisma.dataset.findUnique({
      where: { id: datasetId },
      include: {
        owner: true,
        category: { include: { department: true } },
        departmentPermissions: {
          include: { department: true }
        }
      }
    });

    if (!dataset) throw new NotFoundException('Dataset không tồn tại');

    const isCreator = dataset.createdById === user.id;
    
    // Dataset này có thuộc phòng ban của User đang công tác hay không?
    const isMyDeptDataset = dataset.owner?.departmentCode === user.departmentCode;
    
    // Dataset có thuộc danh mục GLOBAL (dùng chung toàn công ty) hay không?
    const isGlobal = dataset.category?.department?.code === 'GLOBAL';

    // [Cấp 2] Xử lý Dataset thuộc PHÒNG MÌNH (Home Department): Mọi thành viên đều có vai trò MANAGER nội bộ
    if (isMyDeptDataset) {
      return { role: DatasetRole.MANAGER, isCreator, isMyDeptDataset, isGlobal };
    }

    // [Cấp 3] Xử lý Dataset thuộc PHÒNG KHÁC: Phụ thuộc vào Quyền cá nhân hoặc Quyền phòng ban được gán
    const memberPerm = await this.prisma.datasetMember.findUnique({
      where: { datasetId_userId: { datasetId, userId: user.id } },
    });

    const deptPerm = dataset.departmentPermissions.find(
      dp => dp.department.code === user.departmentCode
    );

    const memberWeight = this.ROLE_WEIGHT[memberPerm?.role || 'NULL'];
    const deptWeight = this.ROLE_WEIGHT[deptPerm?.role || 'NULL'];

    // Chọn quyền có trọng số cao nhất giữa Quyền cá nhân được gán và Quyền đại diện phòng ban
    let calculatedRole: DatasetRole | null = null;
    if (memberWeight > 0 || deptWeight > 0) {
      calculatedRole = memberWeight >= deptWeight ? memberPerm!.role : deptPerm!.role;
    }

    return { role: calculatedRole, isCreator, isMyDeptDataset, isGlobal };
  }

  /**
   * Chốt phán quyết (Gatekeeper): Cho phép hoặc Từ chối (Ném ForbiddenException) đối với một Hành động cụ thể.
   * 
   * @param datasetId ID của Dataset
   * @param user Object User đang truy cập
   * @param action Hành động muốn thực hiện (READ, WRITE_SEGMENT, WRITE_DOCUMENT, MANAGE, DELETE_DATASET)
   * @returns `true` nếu hợp lệ; Ném `ForbiddenException` nếu vi phạm
   */
  async validateDatasetAccess(
    datasetId: number,
    user: User,
    action: DatasetAction
  ) {
    if (user.role === UserRole.SUPER_ADMIN) return true;

    const ctx = await this.getDatasetContext(datasetId, user);

    // Quyền GLOBAL READ: Mọi user đều có quyền READ nếu Dataset nằm trong danh mục GLOBAL
    if (ctx.isGlobal && action === 'READ') {
      return true;
    }

    // Nếu không có role và không phải Global READ -> Chặn lập tức
    if (!ctx.role) {
      throw new ForbiddenException("Bạn không có quyền truy cập Dataset này.");
    }

    const weight = this.ROLE_WEIGHT[ctx.role];

    switch (action) {
      // 1. Đọc và Thao tác Segment -> VIEWER trở lên (Trọng số >= 1)
      case 'READ':
      case 'WRITE_SEGMENT':
        if (weight >= this.ROLE_WEIGHT[DatasetRole.VIEWER]) return true;
        break;

      // 2. Thao tác File Document -> Yêu cầu EDITOR trở lên (Trọng số >= 2)
      case 'WRITE_DOCUMENT':
        if (weight >= this.ROLE_WEIGHT[DatasetRole.EDITOR]) return true;
        throw new ForbiddenException("Bạn cần quyền Editor để Thêm/Xóa File tài liệu.");

      // 3. Quản lý thành viên & Cấu hình -> Yêu cầu MANAGER (Trọng số >= 3)
      case 'MANAGE':
        if (weight >= this.ROLE_WEIGHT[DatasetRole.MANAGER]) return true;
        throw new ForbiddenException("Bạn cần quyền Manager để thực hiện thao tác này.");

      // 4. Xóa Dataset -> Logic kiểm tra đặc biệt
      case 'DELETE_DATASET':
        if (ctx.isCreator) return true; // Người tạo ra Dataset luôn có quyền xóa

        if (ctx.isMyDeptDataset) {
           if (user.role === UserRole.DEPT_MANAGER) return true; // Trưởng phòng có quyền xóa Dataset của phòng
           throw new ForbiddenException("Chỉ Trưởng phòng hoặc Người tạo mới được phép Xóa Dataset của bộ phận.");
        }

        if (weight >= this.ROLE_WEIGHT[DatasetRole.MANAGER]) return true;
        throw new ForbiddenException("Bạn không có quyền Xóa Dataset này.");
    }

    return true;
  }

  /**
   * Validate dữ liệu JSON động dựa trên Schema Config đã thiết lập cho Dataset
   * 
   * @param schemaConfig Mảng cấu hình các trường dữ liệu bắt buộc/kiểu dữ liệu
   * @param data Dữ liệu JSON thực tế gửi lên
   * @returns `true` nếu hợp lệ; Ném `BadRequestException` nếu sai kiểu hoặc thiếu trường bắt buộc
   */
  validateJsonSchema(schemaConfig: any[], data: Record<string, any>) {
    if (!schemaConfig || schemaConfig.length === 0) return true; 

    for (const fieldConfig of schemaConfig) {
      const { field, key, required, type } = fieldConfig;
      const fieldName = key || field; 
      const value = data[fieldName];

      if (required && (value === undefined || value === null || value === '')) {
        throw new BadRequestException(`Trường "${fieldName}" là bắt buộc`);
      }

      if (value !== undefined && value !== null && value !== '') {
        switch (type) {
          case 'number':
            if (isNaN(Number(value))) throw new BadRequestException(`Trường "${fieldName}" phải là số`);
            break;
          case 'text':       
          case 'longtext':   
          case 'paragraph':  
          case 'dictionary': 
            if (typeof value !== 'string') throw new BadRequestException(`Trường "${fieldName}" phải là văn bản`);
            break;
        }
      }
    }
    return true;
  }
}