# ToolTrace - Image to SVG Outline Converter

## Overview

ToolTrace is a web application that converts raster images (PNG, JPG) into SVG outlines. The application allows users to upload images, detect edges using threshold-based processing, generate simplified vector outlines, and export results in various formats (SVG, DXF, DWG, STL). It includes features like ruler calibration for real-world measurements, cropping, margin adjustment, and interactive editing of detected outlines.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture

**Framework**: React with TypeScript, built using Vite as the build tool.

**UI Component Library**: Radix UI primitives with shadcn/ui components for a consistent, accessible design system. TailwindCSS handles styling with a customizable theme system via `theme.json`.

**State Management**: 
- React hooks (useState, useRef, useEffect) for local component state
- TanStack Query (React Query) for server state management and API caching
- Wouter for lightweight client-side routing

**Key Design Patterns**:
- Component composition with Radix UI primitives
- Custom hooks for reusable logic (use-toast, use-mobile)
- File-based organization separating UI components, pages, and utilities

**Image Processing**: Client-side canvas-based edge detection and SVG generation. The application uses convex hull algorithms (Gift Wrapping/Jarvis March) for point simplification to create clean outlines from detected edges.

**Session Management**: Client-generated session IDs stored in headers to track user images without requiring authentication.

### Backend Architecture

**Runtime**: Node.js with Express.js framework

**Architecture Pattern**: RESTful API with simple in-memory storage

**API Structure**:
- POST `/api/images` - Save processed image data
- GET `/api/images/:id` - Retrieve specific image by ID
- GET `/api/images` - List all images for current session

**Storage Strategy**: 
- Development/Default: In-memory storage using Map data structures
- Production-ready: Drizzle ORM configured for PostgreSQL (Neon serverless)
- Storage abstraction layer (IStorage interface) allows easy swapping between implementations

**Session Handling**: Custom middleware adds session tracking via `x-session-id` headers, enabling stateless user sessions without cookies or authentication.

**Error Handling**: Centralized error middleware with status code normalization and JSON error responses.

### Data Storage Solutions

**Database ORM**: Drizzle ORM with PostgreSQL dialect configured for Neon serverless database.

**Schema Design**: Single `images` table containing:
- Image metadata (original filename, dimensions, file size)
- SVG data as text
- Optional calibration data (pixels per mm, physical dimensions)
- Session ID for user isolation

**Migration Strategy**: Drizzle Kit manages schema migrations with files output to `./migrations` directory.

**Development Mode**: In-memory storage (MemStorage class) for rapid prototyping without database dependencies. This allows the application to run immediately while still maintaining the same interface for future database integration.

### Authentication and Authorization

**Current State**: No authentication required - sessionless architecture using client-generated UUIDs.

**Access Control**: Images are isolated by session ID, preventing cross-session data access. Each client generates a random session ID on first load.

**Security Model**: Simple session-based isolation suitable for prototype/demo purposes. Not designed for multi-tenant production use without additional authentication layer.

### Build and Deployment

**Build Process**: 
- Frontend: Vite bundles React application to `dist/public`
- Backend: esbuild compiles TypeScript server to `dist/index.js` as ESM bundle
- Single production build creates both static assets and server bundle

**Development Mode**: Vite dev server with HMR, middleware mode integration with Express, and runtime error overlay plugin for enhanced DX on Replit.

**Environment Configuration**: Database URL required via `DATABASE_URL` environment variable for PostgreSQL connection.

## External Dependencies

### Third-Party Services

**Database**: Neon Serverless PostgreSQL - configured via `@neondatabase/serverless` driver for edge-compatible database access.

**Advertising**: Google AdSense integration (ca-pub-5836736537976040) via `ads.txt` and script tag in HTML.

### Key Libraries

**Frontend**:
- `@tanstack/react-query` - Server state management and caching
- `wouter` - Lightweight routing (~1.2KB)
- `react-dropzone` - File upload with drag-and-drop
- `date-fns` - Date formatting utilities
- `zod` - Runtime type validation
- Full Radix UI component suite for accessible primitives

**Backend**:
- `express` - Web server framework
- `drizzle-orm` - Type-safe ORM
- `drizzle-zod` - Zod schema generation from Drizzle schemas

**Development**:
- `tsx` - TypeScript execution for dev server
- `esbuild` - Fast JavaScript bundler
- `vite` - Frontend build tool and dev server
- Replit-specific plugins for error handling and theme integration

### API Integrations

No external API integrations beyond Google AdSense for monetization. The application is fully self-contained with all processing happening client-side and server-side.