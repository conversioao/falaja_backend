import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
    CallToolRequestSchema,
    ListToolsRequestSchema,
    Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { query, getClient } from "./db.js";
import fs from "fs";
import path from "path";

// Define tools
const QUERY_DATABASE_TOOL: Tool = {
    name: "query_database",
    description: "Execute a read-only SQL query against the database",
    inputSchema: {
        type: "object",
        properties: {
            sql: { type: "string", description: "The SQL query to execute" },
            params: { type: "array", description: "Optional query parameters", items: { type: "string" } },
        },
        required: ["sql"],
    },
};

const EXECUTE_MIGRATION_TOOL: Tool = {
    name: "execute_migration",
    description: "Execute a SQL migration file",
    inputSchema: {
        type: "object",
        properties: {
            migrationName: { type: "string", description: "The name of the migration file (without extension)" },
            sqlContent: { type: "string", description: "The SQL content of the migration" },
        },
        required: ["migrationName", "sqlContent"],
    },
};

const GET_SCHEMA_TOOL: Tool = {
    name: "get_schema",
    description: "Get the schema of a table",
    inputSchema: {
        type: "object",
        properties: {
            tableName: { type: "string", description: "The name of the table to inspect" },
        },
        required: ["tableName"],
    },
};

// Server implementation
const server = new Server(
    {
        name: "postgres-mcp-server",
        version: "1.0.0",
    },
    {
        capabilities: {
            tools: {},
        },
    }
);

// List tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [QUERY_DATABASE_TOOL, EXECUTE_MIGRATION_TOOL, GET_SCHEMA_TOOL],
    };
});

// Handle tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
        if (name === "query_database") {
            const { sql, params } = args as { sql: string; params?: any[] };
            const result = await query(sql, params);
            return {
                content: [{ type: "text", text: JSON.stringify(result.rows, null, 2) }],
            };
        }

        if (name === "execute_migration") {
            const { migrationName, sqlContent } = args as { migrationName: string; sqlContent: string };

            // Save migration file
            const migrationsDir = path.join(__dirname, "../migrations");
            if (!fs.existsSync(migrationsDir)) {
                fs.mkdirSync(migrationsDir);
            }

            const timestamp = new Date().toISOString().replace(/[-:T.]/g, "").slice(0, 14);
            const fileName = `${timestamp}_${migrationName}.sql`;
            const filePath = path.join(migrationsDir, fileName);

            fs.writeFileSync(filePath, sqlContent);

            // Execute migration
            const result = await query(sqlContent);

            return {
                content: [{ type: "text", text: `Migration ${fileName} executed successfully. Result: ${JSON.stringify(result, null, 2)}` }],
            };
        }

        if (name === "get_schema") {
            const { tableName } = args as { tableName: string };
            const sql = `
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_name = $1;
       `;
            const result = await query(sql, [tableName]);
            return {
                content: [{ type: "text", text: JSON.stringify(result.rows, null, 2) }],
            };
        }

        throw new Error(`Tool not found: ${name}`);
    } catch (error: any) {
        return {
            content: [{ type: "text", text: `Error: ${error.message}` }],
            isError: true,
        };
    }
});

// Start server
const runServer = async () => {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Postgres MCP Server running on stdio");
};

runServer().catch((error) => {
    console.error("Fatal error running server:", error);
    process.exit(1);
});
