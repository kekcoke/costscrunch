# Changelog — 2026-03-26

## 🚀 Features: Export & Scalable Pagination

### 📥 Multi-Format Export
- **Backend**: Implemented `GET /expenses/export` in `ExpensesFunction` with automatic S3 overflow for large datasets.
- **Frontend**: Added "Export As" dropdown supporting CSV and JSON.
- **Infrastructure**: Configured CORS to expose `Content-Disposition`, enabling browser-native file downloads.

### 📄 Cursor-based Pagination
- **DynamoDB Integration**: Refactored list queries to use `LastEvaluatedKey` for stateless pagination.
- **Frontend State**: Integrated `nextToken` into Zustand store with "Load More" appending logic.
- **Resiliency**: Implemented `validateQuery` middleware to sanitize incoming proxy metadata against strict Zod schemas.

### 🧪 Quality Assurance
- **Unit Testing**: Added comprehensive test suite for `ExpensesPage` covering fetch cycles, limit changes, and append logic.
- **CORS Validation**: Expanded integration tests to verify header exposure across SAM and LocalStack environments.

**Co-Authored-By**: AdaL <adal@sylph.ai>
