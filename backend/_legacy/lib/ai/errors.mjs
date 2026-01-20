/**
 * AI-specific error classes
 * @module lib/ai/errors
 */

/**
 * Base AI error
 */
export class AIError extends Error {
    constructor(message, context = {}) {
        super(message);
        this.name = 'AIError';
        this.context = context;
        this.timestamp = new Date().toISOString();
        
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, this.constructor);
        }
    }

    toJSON() {
        return {
            name: this.name,
            message: this.message,
            context: this.context,
            timestamp: this.timestamp,
        };
    }
}

/**
 * External AI service error (OpenAI API failure)
 * HTTP 502 Bad Gateway
 */
export class AIServiceError extends AIError {
    constructor(service, message, context = {}) {
        super(`${service}: ${message}`, { service, ...context });
        this.name = 'AIServiceError';
        this.service = service;
        this.httpStatus = 502;
        this.retryable = true;
    }

    /**
     * Create from an Axios error
     * @param {string} service - Service name
     * @param {Error} axiosError - Axios error
     * @returns {AIServiceError}
     */
    static fromAxiosError(service, axiosError) {
        const context = {
            statusCode: axiosError.response?.status,
            statusText: axiosError.response?.statusText,
            url: axiosError.config?.url,
            method: axiosError.config?.method,
        };
        
        const message = axiosError.response?.data?.error?.message 
            || axiosError.response?.data?.message 
            || axiosError.message;
        
        return new AIServiceError(service, message, context);
    }
}

/**
 * Rate limit error - too many requests to AI service
 * HTTP 429 Too Many Requests
 */
export class AIRateLimitError extends AIError {
    constructor(service, retryAfter = 60, context = {}) {
        const message = retryAfter 
            ? `Rate limit exceeded for ${service}. Retry after ${retryAfter}s`
            : `Rate limit exceeded for ${service}`;
        
        super(message, { service, retryAfter, ...context });
        this.name = 'AIRateLimitError';
        this.service = service;
        this.retryAfter = retryAfter;
        this.httpStatus = 429;
        this.retryable = true;
    }
}

/**
 * Timeout error - AI operation timed out
 * HTTP 504 Gateway Timeout
 */
export class AITimeoutError extends AIError {
    constructor(operation, timeoutMs, context = {}) {
        super(`AI operation timed out after ${timeoutMs}ms: ${operation}`, { 
            operation, 
            timeoutMs, 
            ...context 
        });
        this.name = 'AITimeoutError';
        this.operation = operation;
        this.timeoutMs = timeoutMs;
        this.httpStatus = 504;
        this.retryable = true;
    }
}

/**
 * Type guards
 */
export function isAIError(error) {
    return error instanceof AIError;
}

export function isAIServiceError(error) {
    return error instanceof AIServiceError;
}

export function isAIRateLimitError(error) {
    return error instanceof AIRateLimitError;
}

export function isAITimeoutError(error) {
    return error instanceof AITimeoutError;
}

export function isRetryableAIError(error) {
    return isAIError(error) && error.retryable === true;
}

export default {
    AIError,
    AIServiceError,
    AIRateLimitError,
    AITimeoutError,
    isAIError,
    isAIServiceError,
    isAIRateLimitError,
    isAITimeoutError,
    isRetryableAIError,
};
