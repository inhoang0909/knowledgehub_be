import { Controller, Get, Post, Put, Delete, Body, Param, ParseIntPipe, UseGuards, Query, ForbiddenException } from '@nestjs/common';
import { CategoriesService } from './services/categories.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { AuthGuard } from '@common/guards/auth.guard';
import { ActiveUser } from '@common/decorators/active-user.decorator';
import { User } from '@prisma/client';
import { ApiBearerAuth, ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { SemanticRouterService } from './services/semantic-router.service'; 

/**
 * @class CategoriesController
 * @description Controller quản lý Danh mục (Categories) & Định tuyến ngữ nghĩa (Semantic Vector Routing).
 * 
 * Các nhóm API chính:
 * 1. CRUD Category (Tạo, Đọc danh sách phẳng, Đọc cây thư mục 2 tầng, Sửa, Xóa).
 * 2. Semantic Vector Routing Test Endpoint: Định tuyến câu hỏi người dùng đến đúng thư mục chứa tri thức tương ứng.
 * 3. Utility Tools: Đồng bộ Vector Embedding cho toàn bộ danh mục cũ trong hệ thống.
 */
@ApiTags('Categories')
@ApiBearerAuth()
@Controller('api/categories')
@UseGuards(AuthGuard)
export class CategoriesController {
  constructor(
    private readonly categoriesService: CategoriesService,
    private readonly semanticRouterService: SemanticRouterService
  ) {}

  /**
   * API Thử nghiệm Định tuyến Ngữ nghĩa (Semantic Router Test) qua Ollama Vector Similarity Search
   * 
   * @param query Câu hỏi thử nghiệm từ người dùng (vd: "Làm sao để đăng ký nghỉ phép?")
   * @param user Object User đang truy cập (dùng để lọc theo phòng ban)
   * @returns Kết quả đường dẫn Category match tương đồng cao nhất
   */
  @Get('test-router')
  @ApiOperation({ summary: 'Test Semantic Router with Local LLM (Ollama)' })
  @ApiQuery({ name: 'q', required: true, description: 'User query to test' })
  async testRouter(@Query('q') query: string, @ActiveUser() user: User) {
    console.log(`[Test Router] Query: "${query}", Department: ${user.departmentCode}`);
    
    const departmentId = (user as any).departmentId ?? undefined;
    const matchedPath = await this.semanticRouterService.findSuitableCategory(query, departmentId);
    
    return {
      success: true,
      query: query,
      matched_category_path: matchedPath || 'NONE (No match found)',
    };
  }

  /**
   * Tạo Category mới & Tự động tạo Vector Embedding chạy ngầm (Background Task)
   * 
   * @param dto Dữ liệu tạo Category (name, description, departmentId, parentId)
   * @param user User tạo Category
   */
  @Post()
  @ApiOperation({ summary: 'Create a new category' })
  async create(@Body() dto: CreateCategoryDto, @ActiveUser() user: User) {
    const category = await this.categoriesService.create(dto, user);
    
    // Tự động tạo Vector Embedding chạy ngầm (Fire and Forget) để tối ưu thời gian phản hồi API
    this.semanticRouterService.updateCategoryEmbedding(category.id, category.name, category.description).catch(console.error);
    
    return category;
  }

  /**
   * Lấy danh sách phẳng (Flat List) tất cả Category mà User có quyền truy cập
   */
  @Get()
  @ApiOperation({ summary: 'Get all categories (flat list)' })
  findAll(@ActiveUser() user: User) {
    return this.categoriesService.findAll(user);
  }

  /**
   * Lấy danh mục dưới dạng Cây Phân Cấp (Hierarchical Tree) đã ghép kèm các Dataset hợp lệ
   */
  @Get('tree')
  @ApiOperation({ summary: 'Get categories as hierarchical tree' })
  getTree(@ActiveUser() user: User) {
    return this.categoriesService.getTree(user);
  }

  /**
   * Công cụ đồng bộ lại toàn bộ Vector Embeddings cho tất cả Category cũ trong DB
   * Đòi hỏi quyền SUPER_ADMIN
   */
  @Get('sync-vectors')
  @ApiOperation({ summary: 'Đồng bộ Vector Embeddings cho toàn bộ Categories cũ' })
  async syncVectors(@ActiveUser() user: User) {
    if (user.role !== 'SUPER_ADMIN') {
      throw new ForbiddenException('Chỉ Super Admin mới được quyền chạy đồng bộ Vector!');
    }
    
    return this.semanticRouterService.syncAllCategories();
  }

  /**
   * Lấy thông tin chi tiết một Category theo ID kèm danh sách Sub-categories & Datasets
   */
  @Get(':id')
  @ApiOperation({ summary: 'Get category by ID with datasets' })
  findOne(@Param('id', ParseIntPipe) id: number, @ActiveUser() user: User) {
    return this.categoriesService.findOne(id, user);
  }

  /**
   * Cập nhật thông tin Category (Tên, Mô tả, Đổi thư mục cha) & Cập nhật lại Vector Embedding
   */
  @Put(':id')
  @ApiOperation({ summary: 'Update category' })
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCategoryDto,
    @ActiveUser() user: User
  ) {
    const category = await this.categoriesService.update(id, dto, user);
    
    // Cập nhật lại Vector Embedding khi thông tin Category thay đổi
    this.semanticRouterService.updateCategoryEmbedding(category.id, category.name, category.description).catch(console.error);
    
    return category;
  }

  /**
   * Xóa Category (Kiểm tra ràng buộc không chứa Sub-category hoặc Dataset trước khi xóa)
   */
  @Delete(':id')
  @ApiOperation({ summary: 'Delete category' })
  remove(@Param('id', ParseIntPipe) id: number, @ActiveUser() user: User) {
    return this.categoriesService.remove(id, user);
  }
}