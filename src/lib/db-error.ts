/**
 * Database Error Handler
 *
 * Converts Prisma/SQLite errors into user-friendly messages
 */

import { Prisma } from '@prisma/client';

export interface DbErrorResponse {
  error: string;
  code: string;
  userMessage: string;
  isDbError: boolean;
}

/**
 * Check if an error is a database connection error
 */
export function isDatabaseConnectionError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientInitializationError) {
    return true;
  }

  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return (
      message.includes('unable to open the database file') ||
      message.includes('error code 14') ||
      message.includes('sqlite_cantopen') ||
      message.includes('connection refused') ||
      message.includes('database') && message.includes('not found')
    );
  }

  return false;
}

/**
 * Parse a database error and return a user-friendly response
 */
export function parseDbError(error: unknown): DbErrorResponse {
  // Database connection errors
  if (isDatabaseConnectionError(error)) {
    return {
      error: error instanceof Error ? error.message : 'Database connection error',
      code: 'DB_CONNECTION_ERROR',
      userMessage: 'Database not available. Please check if the database is set up correctly. Run "npx prisma db push" to initialize.',
      isDbError: true,
    };
  }

  // Prisma known errors
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    switch (error.code) {
      case 'P2002':
        return {
          error: error.message,
          code: 'UNIQUE_CONSTRAINT',
          userMessage: 'A record with this identifier already exists.',
          isDbError: true,
        };
      case 'P2025':
        return {
          error: error.message,
          code: 'RECORD_NOT_FOUND',
          userMessage: 'The requested record was not found.',
          isDbError: true,
        };
      default:
        return {
          error: error.message,
          code: error.code,
          userMessage: `Database error: ${error.code}. Please try again.`,
          isDbError: true,
        };
    }
  }

  // Prisma validation errors
  if (error instanceof Prisma.PrismaClientValidationError) {
    return {
      error: error.message,
      code: 'VALIDATION_ERROR',
      userMessage: 'Invalid data provided. Please check your input.',
      isDbError: true,
    };
  }

  // Generic error
  return {
    error: error instanceof Error ? error.message : 'Unknown error',
    code: 'UNKNOWN',
    userMessage: error instanceof Error ? error.message : 'An unexpected error occurred.',
    isDbError: false,
  };
}

/**
 * Create a JSON response for database errors
 */
export function createDbErrorResponse(error: unknown, context?: string) {
  const parsed = parseDbError(error);

  return {
    success: false,
    error: parsed.userMessage,
    errorCode: parsed.code,
    context,
    // Include technical details only in development
    ...(process.env.NODE_ENV === 'development' && {
      technicalError: parsed.error,
    }),
  };
}
