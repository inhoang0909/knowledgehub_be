# TÀI LIỆU YÊU CẦU PHẦN MỀM (SRS - SOFTWARE REQUIREMENTS SPECIFICATION)
## HỆ THỐNG DIFY WRAPPER BACKEND

---

## 1. TỔNG QUAN HỆ THỐNG (SYSTEM OVERVIEW)

### 1.1. Giới thiệu
**Dify Wrapper Backend** (`dify_backend`) là hệ thống máy chủ dịch vụ (Backend Service) được xây dựng trên nền tảng **NestJS**, đóng vai trò là lớp trung gian (Wrapper & Management Layer) mở rộng tính năng cho nền tảng **Dify AI Platform**.

Hệ thống bổ sung các năng lực doanh nghiệp cao cấp bao gồm:
- **Phân quyền doanh nghiệp đa cấp (Enterprise RBAC)**: Quản lý người dùng, phòng ban, và phân quyền truy cập tập dữ liệu (Dataset) chi tiết theo cá nhân/phòng ban.
- **Quản lý danh mục cây phân cấp (Hierarchical Category Tree)**: Tổ chức tập dữ liệu tri thức theo thư mục vô hạn cấp.
- **Xử lý tài liệu nâng cao (VLM / OCR Document Parsing)**: Sử dụng mô hình thị giác máy tính (Vision Language Model) để bóc tách PDF, bảng biểu, tài liệu phức tạp trước khi nạp vào Dify.
- **Xử lý bất đồng bộ (Background Job Processing)**: Quản lý hàng đợi xử lý file qua `pg-boss`.
- **Đánh giá & Tinh chỉnh phản hồi (Feedback & Annotations)**: Cho phép người dùng đánh giá LIKE/DISLIKE và Admin hiệu chỉnh câu trả lời của AI để huấn luyện ngược lại vào Dataset.

---

### 1.2. Kiến trúc Kỹ thuật (Technical Stack)
- **Framework**: NestJS (TypeScript, Node.js)
- **Database**: PostgreSQL (kèm extension `pgvector` phục vụ lưu trữ & truy vấn Vector Embedding)
- **ORM**: Prisma ORM
- **Caching**: Redis
- **Background Queue**: `pg-boss` (Job queue chạy trên PostgreSQL)
- **External Integration**: Dify API & Dify PostgreSQL DB Cross-Query, Ollama Local LLM/Embedding
- **Documentation**: Swagger / OpenAPI Specs

---

## 2. HỆ THỐNG VAI TRÒ & PHÂN QUYỀN (ROLES & PERMISSIONS)

### 2.1. Vai trò Người dùng Hệ thống (System User Roles)
1. **SUPER_ADMIN (Quản trị viên tối cao)**:
   - Toàn quyền xem, tạo, sửa, xóa tất cả phòng ban, người dùng, danh mục và tập dữ liệu trong hệ thống.
   - Có quyền thực hiện các thao tác quản trị như đồng bộ Vector (`sync-vectors`).
2. **DEPT_MANAGER (Trưởng phòng ban)**:
   - Quản lý thông tin và người dùng thuộc phòng ban do mình phụ trách.
   - Quyền quản trị tối cao đối với các Dataset thuộc sở hữu của phòng ban mình (`MANAGER`).
3. **MEMBER (Thành viên / Nhân viên)**:
   - Sử dụng các tính năng tra cứu, chat với AI Bot được phân quyền.
   - Truy cập các Dataset được chia sẻ đích danh hoặc chia sẻ cho phòng ban.

### 2.2. Mức quyền trên Tập dữ liệu (Dataset Roles)
1. **MANAGER**: Toàn quyền thêm/sửa/xóa tài liệu, phân quyền thành viên khác trên Dataset.
2. **EDITOR**: Được phép tải lên tài liệu, chỉnh sửa/xóa tài liệu và các đoạn trích (Segments).
3. **VIEWER**: Chỉ được phép đọc/tìm kiếm nội dung tri thức trong Dataset.

---

## 3. DANH SÁCH TÍNH NĂNG CHI TIẾT (FEATURE LIST BY MODULE)

---

### 3.1. Auth & User Management (Quản lý Xác thực & Người dùng)
- **F-AUTH-01: Đăng nhập SSO & JWT**: Hỗ trợ đăng nhập qua hệ thống SSO doanh nghiệp (CASO) hoặc JWT Local Authentication.
- **F-AUTH-02: Phân quyền truy cập (Auth Guard)**: Bảo vệ các API bằng `AuthGuard` và trích xuất thông tin người dùng đang hoạt động (`@ActiveUser`).
- **F-USER-01: Quản lý Danh sách Người dùng**: Tra cứu, lọc danh sách người dùng theo tên, email, phòng ban, vai trò.
- **F-USER-02: Đồng bộ & Quản lý Tài khoản**: Tạo mới, cập nhật thông tin cá nhân, gán vai trò (`UserRole`) và phòng ban (`departmentCode`).
- **F-USER-03: Bật/Tắt Tài khoản**: Vô hiệu hóa (`isActive = false`) hoặc kích hoạt lại tài khoản người dùng.

---

### 3.2. Department Management (Quản lý Cơ cấu Phòng ban)
- **F-DEPT-01: Quản lý Danh mục Phòng ban**: Tạo mới, cập nhật tên, mã phòng ban (`code`), mô tả.
- **F-DEPT-02: Gán Trưởng phòng (Department Manager)**: Chỉ định một người dùng làm Trưởng phòng ban.
- **F-DEPT-03: Quản lý Thành viên Phòng ban**: Xem danh sách nhân viên thuộc phòng ban và thống kê số lượng thành viên.

---

### 3.3. Categories Management (Quản lý Cây Danh mục Tri thức)
- **F-CAT-01: Cây Thư mục Vô hạn cấp (Hierarchical Category Tree)**: Tạo danh mục đa cấp (Parent-Child) hỗ trợ sắp xếp Dataset như cấu trúc cây thư mục.
- **F-CAT-02: Phân vùng Danh mục theo Phòng ban**: Danh mục có thể thuộc riêng về một phòng ban hoặc chung cho toàn công ty (`GLOBAL`).
- **F-CAT-03: Tự động tạo Vector Embedding**: Tự động gọi Ollama (`embeddinggemma`) để chuyển đổi tên & mô tả danh mục thành vector khi tạo/sửa.
- **F-CAT-04: Định tuyến Ngữ nghĩa (Semantic Router - POC)**: Phân tích ngữ nghĩa câu hỏi người dùng bằng `pgvector` để gợi ý/tìm danh mục phù hợp nhất.
- **F-CAT-05: Đồng bộ Vector Hàng loạt**: Cho phép Super Admin chạy tiến trình quét và đồng bộ lại vector cho toàn bộ danh mục trong hệ thống.

---

### 3.4. Datasets Management (Quản lý Tập dữ liệu Tri thức)
- **F-DS-01: Dify Dataset Wrapper**: Đồng bộ và bọc API tạo/sửa/xóa Dataset trên Dify AI Platform.
- **F-DS-02: Phân loại Tập dữ liệu vào Danh mục**: Gán Dataset vào các danh mục cây (`categoryId`).
- **F-DS-03: Phân quyền theo Phòng ban (Department Permissions)**: Gán quyền truy cập (VIEWER/EDITOR/MANAGER) của Dataset cho từng phòng ban.
- **F-DS-04: Phân quyền cá nhân (Dataset Members)**: Thêm/sửa/xóa quyền truy cập cá nhân từng người dùng vào Dataset.
- **F-DS-05: Hợp nhất Quyền truy cập (Cascading Access Resolution)**: Tự động tính toán quyền cao nhất của người dùng dựa trên Vai trò hệ thống, Quyền phòng ban và Quyền cá nhân.
- **F-DS-06: Xóa mềm Dataset**: Đánh dấu xóa mềm (`isDeleted = true`) mà không làm mất dữ liệu gốc trên Dify khi chưa cần thiết.

---

### 3.5. Documents & File Processing (Quản lý & Xử lý Tài liệu Nâng cao)
- **F-DOC-01: Tải lên Tài liệu**: Hỗ trợ tải lên các định dạng tài liệu (PDF, DOCX, XLSX, JPG, PNG...).
- **F-DOC-02: Đọc & Bóc tách Tài liệu bằng AI (VLM Parser)**: Sử dụng mô hình thị giác AI (Vision Language Model) để nhận diện văn bản, bóc tách bảng biểu, công thức và chuyển đổi sang định dạng Markdown chuẩn.
- **F-DOC-03: Quản lý Trạng thái Xử lý Tài liệu**: Quy trình xử lý đa bước với các trạng thái: `UPLOADED` -> `PARSING` -> `PARSED` -> `PROCESSING_AI` -> `COMPLETED` / `FAILED`.
- **F-DOC-04: Hàng đợi Xử lý Bất đồng bộ (Pg-Boss Background Queue)**: Đưa tài liệu dung lượng lớn vào hàng đợi xử lý ngầm, không gây nghẽn API response.
- **F-DOC-05: Đồng bộ Tài liệu với Dify**: Đẩy dữ liệu văn bản đã bóc tách vào Dify Dataset qua Dify Document API.
- **F-DOC-06: Quản lý & Tải về File Gốc**: Lưu trữ và truy xuất file gốc qua `/uploads` hoặc bộ nhớ lưu trữ.

---

### 3.6. Segments Management (Quản lý Phân đoạn Văn bản)
- **F-SEG-01: Truy xuất Danh sách Segments**: Xem danh sách các đoạn trích văn bản (chunks/segments) của từng tài liệu trong Dataset.
- **F-SEG-02: Thêm mới / Chỉnh sửa Segment**: Cho phép Editor/Manager chỉnh sửa nội dung đoạn trích trực tiếp.
- **F-SEG-03: Đồng bộ Segment với Dify**: Cập nhật trực tiếp nội dung phân đoạn lên Dify Segment API.

---

### 3.7. Chatbot & Conversations (Quản lý Trợ lý AI & Lịch sử Chat)
- **F-CHAT-01: Khám phá Chatbot Dify (On-the-fly Discovery)**: Tự động đọc và liệt kê các App Chatbot trên Dify mà người dùng được phép dùng (thông qua liên kết Dataset).
- **F-CHAT-02: Quản lý Phiên Hội thoại (Conversations)**: Tạo mới, lưu trữ và xem lại danh sách các cuộc hội thoại theo từng người dùng và từng Bot.
- **F-CHAT-03: Trả lời thời gian thực (Streaming Response)**: Kết nối với Dify Chat API hỗ trợ Stream dữ liệu theo thời gian thực (Server-Sent Events).
- **F-CHAT-04: Lưu trữ Lịch sử Tin nhắn (Messages)**: Lưu chi tiết câu hỏi (`query`), câu trả lời (`answer`) và mốc thời gian của từng lượt chat.
- **F-CHAT-05: Đánh giá Phản hồi (Feedback)**: Người dùng có thể bấm `LIKE` hoặc `DISLIKE` cho mỗi câu trả lời của Chatbot.

---

### 3.8. Annotations (Tinh chỉnh & Huấn luyện lại AI)
- **F-ANO-01: Tạo Bản Hiệu chỉnh (Annotation Draft)**: Khi Chatbot trả lời sai hoặc chưa tối ưu, Admin/Editor có thể tạo bản sửa lỗi (`expectedAnswer`).
- **F-ANO-02: Quản lý Trạng thái Annotation**: Theo dõi trạng thái hiệu chỉnh (`DRAFT`, `PUBLISHED`, `DELETED`).
- **F-ANO-03: Đưa Bản Hiệu chỉnh vào Dataset Target**: Cho phép chọn Dataset mục tiêu (`targetDatasetId`) để nạp câu trả lời chuẩn vào tập tri thức, giúp AI học và trả lời đúng trong các lần sau.

---

## 4. CÁC YÊU CẦU PHI CHỨC NĂNG (NON-FUNCTIONAL REQUIREMENTS)

1. **Hiệu năng & Tải (Performance & Scalability)**:
   - Sử dụng Redis cache để tăng tốc các truy vấn kiểm tra quyền người dùng và lấy cây danh mục.
   - Sử dụng hàng đợi `pg-boss` xử lý đọc file OCR/VLM ngầm để không làm timeout HTTP Request.
2. **Bảo mật (Security)**:
   - Mã hóa và xác thực tất cả API bằng JWT Bearer Token.
   - Kiểm tra phân quyền đa lớp (Guards & Custom Decorators) ngăn chặn truy cập trái phép giữa các phòng ban (Data Isolation).
3. **Khả năng Mở rộng & Tích hợp (Extensibility)**:
   - Thiết kế dạng Modular NestJS dễ dàng mở rộng thêm tính năng mới.
   - Chuẩn hóa Swagger API Specs (`/api/docs`) hỗ trợ Frontend tích hợp dễ dàng.
