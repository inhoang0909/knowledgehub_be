ARCHITECTURE AND IMPLEMENTATION OF CHATBOT LOGS & ANNOTATION FEATURE

1. Problem Analysis & System Architecture (Dual Database)
Because you are hosting Dify locally and want to query the Dify DB directly, your Backend system will operate on a Dual Database Connection model:

Local DB (Prisma - PostgreSQL): Contains your current Schema. Manages users, permissions, Dataset structure, and stores bug fixes (Annotations).

Dify DB (PostgreSQL): Contains Dify's raw data (conversations, messages, app_annotations tables).

Why query the Dify DB directly?
Performance: Bypasses the overhead of the HTTP API; direct SQL queries are many times faster.

Aggregations: Easily perform GROUP BY, JOIN to count messages, calculate Like/Dislike ratios that the Dify API does not readily support.

Synchronization Strategy
Based on the Schema you designed, you are storing Conversation and Message data in the Local DB. Therefore, the standard process will be:

Read: Backend queries the Dify DB directly to retrieve new logs -> Save (Upsert) into the Local DB (Conversation, Message).

Write/Bug Fix: Admin creates Annotation in the Local DB -> When Publishing, call the Dify API to push this data as a Q&A Document into the Dataset (Do not write directly to the Dify DB to avoid breaking Dify's Vector Index structure).

2. Backend Connection Setup (Node.js/NestJS)
You should not use Prisma to connect directly to the Dify DB because Prisma requires a standard Schema, while Dify's structure changes with updates. Use the pg (node-postgres) library to query raw SQL to the Dify DB.

JavaScript

// dify-db.service.ts
import { Pool } from 'pg';

const difyPool = new Pool({
  host: process.env.DIFY_DB_HOST,
  port: process.env.DIFY_DB_PORT,
  user: process.env.DIFY_DB_USER,
  password: process.env.DIFY_DB_PASSWORD,
  database: 'dify', // Dify's default DB name
});

export const queryDifyDB = (text, params) => difyPool.query(text, params);

3. API Design (Backend Endpoints)
Group 1: Synchronization & Log Display
1. API: GET /api/chatbots/:chatbotId/sync-logs (Can be run with Cronjob)
Task: Pull data from Dify DB to Local DB.

Logic (Raw SQL query to Dify DB):

SQL

-- Find new messages in Dify based on dify_app_id
SELECT m.id as message_id, c.id as conversation_id, m.query, m.answer,
       m.message_tokens, m.answer_tokens, m.created_at
FROM messages m
JOIN conversations c ON m.conversation_id = c.id
WHERE c.app_id = $1 AND m.created_at > $2;

Prisma Handling: Map the retrieved data and use prisma.message.createMany() to save to the Message and Conversation tables in the Local DB.

2. API: GET /api/chatbots/:chatbotId/conversations (Display Left Column)
Task: Get a list of chat sessions for a Bot (already saved in the Local DB).

Prisma Query:

JavaScript

prisma.conversation.findMany({
  where: { chatbotId: chatbotId },
  include: {
    user: { select: { name: true, email: true } },
    messages: {
      orderBy: { createdAt: 'desc' },
      take: 1 // Get the latest message as a Preview
    }
  },
  orderBy: { updatedAt: 'desc' }
});

3. API: GET /api/conversations/:id/messages (Display Middle Column)
Task: Get all messages in a conversation.

Prisma Query:

JavaScript

prisma.message.findMany({
  where: { conversationId: id },
  include: { annotation: true }, // Include to know which messages have been corrected
  orderBy: { createdAt: 'asc' }
});

Group 2: Annotation Management (Bug Fixing)
4. API: POST /api/messages/:messageId/annotations (Save Draft - Right Column)
Task: Admin fills in the standard answer (expectedAnswer) and saves it.

Prisma Query:

JavaScript

prisma.annotation.upsert({
  where: { messageId: req.params.messageId },
  update: {
    expectedAnswer: req.body.expectedAnswer,
    targetDatasetId: req.body.targetDatasetId,
    status: 'DRAFT'
  },
  create: {
    messageId: req.params.messageId,
    expectedAnswer: req.body.expectedAnswer,
    targetDatasetId: req.body.targetDatasetId,
    createdById: req.user.id,
    status: 'DRAFT'
  }
});

5. API: POST /api/annotations/:id/publish (Push data to Dify Knowledge Base)
Task: Change Annotation from DRAFT to PUBLISHED and push to Dify.

Process (Workflow):

Get Annotation & Message information from Prisma.

Format the data into Q&A text: Question: {message.query} \n\n Answer: {annotation.expectedAnswer}.

Get difyDatasetId from targetDatasetId.

Call Dify's API (POST /v1/datasets/{dataset_id}/document/create_by_text) to create a new Document.

Update status in Local DB: prisma.annotation.update({ data: { status: 'PUBLISHED' } }).

4. UI/UX Mapping (3-Column Interface)
Based on the designed API, the Frontend will work as follows:

Column 1 (Sessions List): Call API GET /api/chatbots/:id/conversations. Display the list, add a filter to filter Conversations that have Messages containing feedback = DISLIKE.

Column 2 (Chat Thread): When clicking on a Session, call API GET /api/conversations/:id/messages. Display chat bubbles. Under each AI bubble, check if message.annotation exists:

If it doesn't exist: Display the "Annotate" button (Gray).

If status == DRAFT: "Edit Annotation" button (Orange).

If status == PUBLISHED: "Published" button (Green, view-only).

Column 3 (Inspector Panel): When clicking the Annotate button, open the panel on the right. Call API POST /api/messages/:id/annotations when clicking Save.